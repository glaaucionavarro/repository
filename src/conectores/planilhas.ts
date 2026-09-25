import { createSign } from 'node:crypto';
import { normalizar, removerInvisiveis } from '../lib/texto.js';

/** Erro de dados/configuração de planilha: aborta a execução com mensagem legível. */
export class ErroPlanilha extends Error {}

export interface LeitorPlanilhas {
  /** Todas as células da aba, linha a linha (strings formatadas como aparecem na planilha). */
  lerAba(planilhaId: string, aba: string): Promise<string[][]>;
}

export interface Registro {
  /** Número da linha na planilha (1 = primeira linha) */
  linha: number;
  campos: Record<string, string>;
}

/** Aceita a URL completa da planilha ou só o ID. */
export function extrairIdPlanilha(urlOuId: string): string {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(urlOuId);
  return m ? m[1]! : urlOuId.trim();
}

/**
 * Converte as células em registros usando os nomes de coluna do cabeçalho.
 * O cabeçalho é procurado nas 10 primeiras linhas, então colunas ou linhas vazias antes dele não atrapalham.
 * `colunas` mapeia campo interno → nome da coluna na planilha.
 */
export function registrosPorCabecalho(
  valores: string[][],
  colunas: Record<string, string>,
  aba: string,
): Registro[] {
  const procuradas = Object.entries(colunas).map(([campo, titulo]) => ({ campo, titulo, chave: normalizar(titulo) }));

  let linhaCabecalho = -1;
  let indices = new Map<string, number>();
  let melhorFaltando: string[] = procuradas.map((p) => p.titulo);

  for (let l = 0; l < Math.min(valores.length, 10); l++) {
    const posicoes = new Map<string, number>();
    (valores[l] ?? []).forEach((celula, i) => {
      const chave = normalizar(celula ?? '');
      if (chave && !posicoes.has(chave)) posicoes.set(chave, i);
    });
    const faltando = procuradas.filter((p) => !posicoes.has(p.chave)).map((p) => p.titulo);
    if (faltando.length === 0) {
      linhaCabecalho = l;
      indices = new Map(procuradas.map((p) => [p.campo, posicoes.get(p.chave)!]));
      break;
    }
    if (faltando.length < melhorFaltando.length) melhorFaltando = faltando;
  }

  if (linhaCabecalho < 0) {
    throw new ErroPlanilha(
      `Aba "${aba}": coluna(s) não encontrada(s): ${melhorFaltando.map((c) => `"${c}"`).join(', ')}. ` +
        'Alguém renomeou ou apagou a coluna?',
    );
  }

  const registros: Registro[] = [];
  for (let l = linhaCabecalho + 1; l < valores.length; l++) {
    const linha = valores[l] ?? [];
    const campos: Record<string, string> = {};
    let algumPreenchido = false;
    for (const [campo, i] of indices) {
      const valor = removerInvisiveis(String(linha[i] ?? '')).trim();
      campos[campo] = valor;
      if (valor) algumPreenchido = true;
    }
    if (algumPreenchido) registros.push({ linha: l + 1, campos });
  }
  return registros;
}

export interface ContaServico {
  client_email: string;
  private_key: string;
}

/** Aceita o JSON da conta de serviço puro ou em base64. */
export function lerContaServico(bruto: string): ContaServico {
  const texto = bruto.trim().startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  let json: Partial<ContaServico>;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido (nem em base64)');
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON precisa ter client_email e private_key');
  }
  return { client_email: json.client_email, private_key: json.private_key };
}

const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function assinarJwt(conta: ContaServico, escopo: string, agora = Date.now()): string {
  const iat = Math.floor(agora / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: conta.client_email,
      scope: escopo,
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const assinatura = createSign('RSA-SHA256').update(`${cabecalho}.${corpo}`).sign(conta.private_key);
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

const ESCOPO_LEITURA = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export class GoogleSheets implements LeitorPlanilhas {
  private token: { valor: string; expira: number } | null = null;

  constructor(
    private readonly conta: ContaServico,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 60_000) return this.token.valor;
    const resposta = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assinarJwt(this.conta, ESCOPO_LEITURA),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resposta.ok) {
      throw new Error(`Google recusou a conta de serviço (${resposta.status}): ${await resposta.text()}`);
    }
    const json = (await resposta.json()) as { access_token: string; expires_in: number };
    this.token = { valor: json.access_token, expira: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async lerAba(planilhaId: string, aba: string): Promise<string[][]> {
    const token = await this.obterToken();
    const intervalo = encodeURIComponent(`'${aba.replace(/'/g, "''")}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(planilhaId)}/values/${intervalo}?valueRenderOption=FORMATTED_VALUE`;
    const resposta = await this.fetchFn(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (resposta.status === 403) {
      throw new ErroPlanilha(
        `Sem acesso à planilha. Compartilhe-a (como Leitor) com ${this.conta.client_email}.`,
      );
    }
    if (resposta.status === 404) throw new ErroPlanilha('Planilha não encontrada. Confira o link/ID.');
    if (resposta.status === 400) {
      const corpo = await resposta.text();
      if (/Unable to parse range/i.test(corpo)) throw new ErroPlanilha(`Aba "${aba}" não encontrada na planilha.`);
      throw new ErroPlanilha(`Google Sheets recusou a leitura: ${corpo}`);
    }
    if (!resposta.ok) throw new Error(`Falha ao ler a planilha (${resposta.status}): ${await resposta.text()}`);
    const json = (await resposta.json()) as { values?: string[][] };
    return json.values ?? [];
  }
}

/** Leitor sem credenciais: toda leitura falha com mensagem clara. */
export class PlanilhasNaoConfiguradas implements LeitorPlanilhas {
  async lerAba(): Promise<string[][]> {
    throw new ErroPlanilha('Conta de serviço do Google não configurada (GOOGLE_SERVICE_ACCOUNT_JSON).');
  }
}

/** Leitor em memória, para testes: { planilhaId: { aba: células } }. */
export class PlanilhasEmMemoria implements LeitorPlanilhas {
  constructor(public dados: Record<string, Record<string, string[][]>>) {}

  async lerAba(planilhaId: string, aba: string): Promise<string[][]> {
    const planilha = this.dados[planilhaId];
    if (!planilha) throw new ErroPlanilha('Planilha não encontrada. Confira o link/ID.');
    const valores = planilha[aba];
    if (!valores) throw new ErroPlanilha(`Aba "${aba}" não encontrada na planilha.`);
    return valores;
  }
}
