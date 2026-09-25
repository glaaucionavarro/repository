import pg from 'pg';
import { emTransacao, criarPool } from '../db/pool.js';
import { normalizarTelefone } from '../lib/telefone.js';
import { lerArgumentos, obrigatorio } from './argumentos.js';

const USO = `npm run importar-n8n -- --workspace <slug> --origem <postgres-url-do-n8n> [--tabela n8n_chat_histories] [--prefixo disparo-] [--simular]

Copia as mensagens que o n8n já enviou (memória Postgres do AI Agent) para o histórico da Dex Automation.
Assim a primeira execução real já varia o texto em relação à última mensagem que o n8n mandou.
Reimportar substitui a importação anterior do mesmo cliente.`;

export interface LinhaMemoria {
  id: number;
  session_id: string;
  message: unknown;
}

export interface MensagemImportada {
  telefone: string;
  texto: string;
  ordem: number;
}

/** Extrai o texto de uma linha da memória do LangChain/n8n, se for mensagem da IA. */
export function textoDaIA(message: unknown): string | null {
  const m = (typeof message === 'string' ? JSON.parse(message) : message) as {
    type?: string;
    content?: unknown;
    data?: { content?: unknown };
  };
  if (m?.type !== 'ai') return null;
  const conteudo = m.content ?? m.data?.content;
  return typeof conteudo === 'string' && conteudo.trim() ? conteudo.trim() : null;
}

/**
 * Converte a memória do n8n em mensagens por telefone, na ordem em que foram gravadas.
 * O fluxo antigo gravava a mesma resposta duas vezes (Agent + Memory Manager): repetições seguidas viram uma só.
 */
export function converterMemoria(linhas: LinhaMemoria[], prefixo: string): { mensagens: MensagemImportada[]; ignoradas: number } {
  const mensagens: MensagemImportada[] = [];
  const ultimaPorTelefone = new Map<string, string>();
  let ignoradas = 0;
  for (const linha of [...linhas].sort((a, b) => a.id - b.id)) {
    const texto = textoDaIA(linha.message);
    if (!texto) continue;
    const bruto = linha.session_id.startsWith(prefixo) ? linha.session_id.slice(prefixo.length) : linha.session_id;
    const tel = normalizarTelefone(bruto);
    if (!tel.valido) {
      ignoradas++;
      continue;
    }
    if (ultimaPorTelefone.get(tel.numero) === texto) continue;
    ultimaPorTelefone.set(tel.numero, texto);
    mensagens.push({ telefone: tel.numero, texto, ordem: mensagens.length });
  }
  return { mensagens, ignoradas };
}

async function main() {
  const args = lerArgumentos();
  const slug = obrigatorio(args, 'workspace', USO);
  const origem = obrigatorio(args, 'origem', USO);
  // n8n_chat_histories é o nome padrão da memória Postgres no n8n; fluxos costumam usar outro (veja o nó de memória)
  const tabela = typeof args.tabela === 'string' ? args.tabela : 'n8n_chat_histories';
  const prefixo = typeof args.prefixo === 'string' ? args.prefixo : 'disparo-';
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(tabela)) throw new Error('Nome de tabela inválido');

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (banco da Dex Automation)');

  const n8n = new pg.Client({ connectionString: origem });
  await n8n.connect();
  const { rows } = await n8n.query<LinhaMemoria>(`SELECT id, session_id, message FROM ${tabela} ORDER BY id`);
  await n8n.end();

  const { mensagens, ignoradas } = converterMemoria(rows, prefixo);
  const contatos = new Set(mensagens.map((m) => m.telefone)).size;
  console.log(`${rows.length} linhas lidas → ${mensagens.length} mensagens de ${contatos} contatos (${ignoradas} com telefone inválido).`);
  if (args.simular) {
    console.log('--simular: nada foi gravado.');
    return;
  }

  const db = criarPool(url);
  const { rows: ws } = await db.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [slug]);
  if (!ws[0]) throw new Error(`Cliente "${slug}" não existe`);
  const workspaceId = ws[0].id;

  // Datas sintéticas em ordem crescente, todas anteriores a hoje, para o histórico ficar na ordem certa
  const base = Date.now() - 86_400_000 - mensagens.length * 1000;
  await emTransacao(db, async (cliente) => {
    await cliente.query(`DELETE FROM mensagens WHERE workspace_id = $1 AND origem = 'importada_n8n'`, [workspaceId]);
    for (const m of mensagens) {
      await cliente.query(
        `INSERT INTO mensagens (workspace_id, origem, telefone, status, texto, criado_em)
         VALUES ($1, 'importada_n8n', $2, 'enviada', $3, $4)`,
        [workspaceId, m.telefone, m.texto, new Date(base + m.ordem * 1000)],
      );
    }
  });
  await db.end();
  console.log(`Histórico importado para o cliente "${slug}".`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
