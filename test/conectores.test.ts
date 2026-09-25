import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calcularCusto, ErroLLMDefinitivo, OpenAI, PRECOS_PADRAO } from '../src/conectores/llm.js';
import {
  assinarJwt,
  ErroPlanilha,
  extrairIdPlanilha,
  GoogleSheets,
  lerContaServico,
  registrosPorCabecalho,
} from '../src/conectores/planilhas.js';

const resposta = (status: number, corpo: unknown) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });

describe('planilhas', () => {
  it('extrai o ID da URL', () => {
    expect(extrairIdPlanilha('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=1#gid=1')).toBe('abc_DEF-123');
    expect(extrairIdPlanilha(' abc123 ')).toBe('abc123');
  });

  it('acha o cabeçalho fora da primeira coluna e pula linhas vazias', () => {
    const valores = [
      [],
      ['', 'Nome', 'Número', 'Extra'],
      ['', 'Ana', '31 9999-0000'],
      ['', '', ''],
      ['', ' Bia ', '‪31 8888-0000‬', 'x'],
    ];
    expect(registrosPorCabecalho(valores, { nome: 'nome', telefone: 'NÚMERO' }, 'Clientes')).toEqual([
      { linha: 3, campos: { nome: 'Ana', telefone: '31 9999-0000' } },
      { linha: 5, campos: { nome: 'Bia', telefone: '31 8888-0000' } },
    ]);
  });

  it('erro legível quando falta coluna', () => {
    expect(() => registrosPorCabecalho([['Nome', 'Fone']], { nome: 'Nome', telefone: 'Número' }, 'Clientes')).toThrow(
      /Aba "Clientes": coluna\(s\) não encontrada\(s\): "Número"/,
    );
  });

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const conta = {
    client_email: 'dex@projeto.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  it('lê a conta de serviço em JSON ou base64', () => {
    const json = JSON.stringify({ ...conta, type: 'service_account' });
    expect(lerContaServico(json)).toEqual(conta);
    expect(lerContaServico(Buffer.from(json).toString('base64'))).toEqual(conta);
    expect(() => lerContaServico('{}')).toThrow(/client_email/);
  });

  it('assina o JWT com RS256', () => {
    const jwt = assinarJwt(conta, 'escopo', 1_700_000_000_000);
    const [cab, corpo, assinatura] = jwt.split('.');
    const ok = createVerify('RSA-SHA256').update(`${cab}.${corpo}`).verify(publicKey, Buffer.from(assinatura!, 'base64url'));
    expect(ok).toBe(true);
    expect(JSON.parse(Buffer.from(corpo!, 'base64url').toString())).toMatchObject({
      iss: conta.client_email,
      scope: 'escopo',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });

  it('busca token uma vez e lê a aba', async () => {
    const chamadas: string[] = [];
    const fetchFalso = (async (url: string) => {
      chamadas.push(url);
      if (url.includes('oauth2')) return resposta(200, { access_token: 'tk', expires_in: 3600 });
      return resposta(200, { values: [['Nome'], ['Ana']] });
    }) as typeof fetch;
    const sheets = new GoogleSheets(conta, fetchFalso);
    expect(await sheets.lerAba('id1', "Aba d'Ouro")).toEqual([['Nome'], ['Ana']]);
    await sheets.lerAba('id1', 'Outra');
    expect(chamadas.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    expect(chamadas[1]).toContain(encodeURIComponent("'Aba d''Ouro'"));
  });

  it('403 explica com qual e-mail compartilhar', async () => {
    const fetchFalso = (async (url: string) =>
      url.includes('oauth2') ? resposta(200, { access_token: 'tk', expires_in: 3600 }) : resposta(403, 'forbidden')) as typeof fetch;
    const erro = await new GoogleSheets(conta, fetchFalso).lerAba('id', 'A').catch((e) => e);
    expect(erro).toBeInstanceOf(ErroPlanilha);
    expect(erro.message).toContain(conta.client_email);
  });
});

describe('OpenAI', () => {
  const ok = {
    model: 'gpt-4.1-2025-04-14',
    choices: [{ message: { content: 'Oi!' } }],
    usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1024 } },
  };

  it('envia o pedido e lê o uso de tokens', async () => {
    let corpo: any;
    const fetchFalso = (async (_: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return resposta(200, ok);
    }) as typeof fetch;
    const r = await new OpenAI('sk', { fetchFn: fetchFalso }).gerar({
      modelo: 'gpt-4.1',
      mensagens: [{ papel: 'system', conteudo: 's' }, { papel: 'user', conteudo: 'u' }],
    });
    expect(corpo).toEqual({ model: 'gpt-4.1', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] });
    expect(r).toEqual({ texto: 'Oi!', modelo: 'gpt-4.1-2025-04-14', tokensEntrada: 1200, tokensSaida: 80, tokensEntradaCache: 1024 });
  });

  it('tenta de novo em erro temporário', async () => {
    let n = 0;
    const fetchFalso = (async () => (++n === 1 ? resposta(503, 'ocupado') : resposta(200, ok))) as typeof fetch;
    const r = await new OpenAI('sk', { fetchFn: fetchFalso, esperas: [0, 0] }).gerar({ modelo: 'gpt-4.1', mensagens: [] });
    expect(r.texto).toBe('Oi!');
    expect(n).toBe(2);
  });

  it('não insiste com chave inválida ou sem crédito', async () => {
    const f401 = (async () => resposta(401, 'nope')) as typeof fetch;
    await expect(new OpenAI('sk', { fetchFn: f401, esperas: [0] }).gerar({ modelo: 'x', mensagens: [] })).rejects.toBeInstanceOf(
      ErroLLMDefinitivo,
    );
    const fQuota = (async () => resposta(429, '{"error":{"code":"insufficient_quota"}}')) as typeof fetch;
    await expect(new OpenAI('sk', { fetchFn: fQuota, esperas: [0] }).gerar({ modelo: 'x', mensagens: [] })).rejects.toThrow(
      /sem créditos/,
    );
  });

  it('calcula custo pelo prefixo do modelo, com cache', () => {
    const custo = calcularCusto(
      { modelo: 'gpt-4.1-2025-04-14', tokensEntrada: 1_000_000, tokensSaida: 1_000_000, tokensEntradaCache: 500_000 },
      PRECOS_PADRAO,
    );
    expect(custo).toBeCloseTo(0.5 * 2 + 0.5 * 0.5 + 8);
    expect(calcularCusto({ modelo: 'desconhecido', tokensEntrada: 1, tokensSaida: 1, tokensEntradaCache: 0 }, PRECOS_PADRAO)).toBeNull();
  });
});
