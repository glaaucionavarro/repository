import type { Db } from '../db/pool.js';
import type { Funil } from '../motor/execucao.js';

export interface Workspace {
  id: string;
  slug: string;
  nome: string;
  fuso: string;
  llm_chave_cifrada: string | null;
  criado_em: Date;
}

export interface Automacao {
  id: string;
  workspace_id: string;
  nome: string;
  receita: string;
  ativa: boolean;
  ativada_em: Date | null;
  agenda_cron: string | null;
  modo_envio: 'sombra' | 'real';
  config: any;
  atualizado_em: Date;
}

export interface Execucao {
  id: string;
  automacao_id: string;
  tipo: 'agendada' | 'manual' | 'previa';
  status: string;
  agendada_para: Date | null;
  periodo: string | null;
  iniciada_em: Date | null;
  finalizada_em: Date | null;
  motivo: string | null;
  funil: Partial<Funil>;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: number;
  criado_em: Date;
}

export interface Mensagem {
  id: string;
  linha: number | null;
  nome: string | null;
  telefone: string | null;
  status: string;
  motivo_codigo: string | null;
  motivo: string | null;
  texto: string | null;
  entrada: Record<string, unknown> | null;
  variacao: { textos?: Record<string, string> } | null;
  tentativas: { texto: string; problemas: string[] }[] | null;
  versao_prompt: string | null;
  modelo: string | null;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: number | null;
  agendada_para: Date | null;
}

export async function listarWorkspaces(db: Db) {
  const { rows } = await db.query<Workspace & { automacoes: number; ativas: number }>(
    `SELECT w.*, count(a.id)::int AS automacoes, count(a.id) FILTER (WHERE a.ativa)::int AS ativas
       FROM workspaces w LEFT JOIN automacoes a ON a.workspace_id = w.id
      GROUP BY w.id ORDER BY w.nome`,
  );
  return rows;
}

export async function workspacePorSlug(db: Db, slug: string) {
  const { rows } = await db.query<Workspace>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  return rows[0] ?? null;
}

export async function automacoesDoWorkspace(db: Db, workspaceId: string) {
  const { rows } = await db.query<Automacao & { ultima_status: string | null; ultima_em: Date | null; ultima_id: string | null }>(
    `SELECT a.*, u.status AS ultima_status, u.criado_em AS ultima_em, u.id AS ultima_id
       FROM automacoes a
       LEFT JOIN LATERAL (
         SELECT id, status, criado_em FROM execucoes e WHERE e.automacao_id = a.id ORDER BY criado_em DESC LIMIT 1
       ) u ON true
      WHERE a.workspace_id = $1 ORDER BY a.nome`,
    [workspaceId],
  );
  return rows;
}

export async function automacaoPorId(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<Automacao & { ws_slug: string; ws_nome: string; ws_fuso: string; ws_tem_chave: boolean }>(
    `SELECT a.*, w.slug AS ws_slug, w.nome AS ws_nome, w.fuso AS ws_fuso, (w.llm_chave_cifrada IS NOT NULL) AS ws_tem_chave
       FROM automacoes a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function execucoesDaAutomacao(db: Db, automacaoId: string, limite = 30) {
  const { rows } = await db.query<Execucao>(
    'SELECT * FROM execucoes WHERE automacao_id = $1 ORDER BY criado_em DESC LIMIT $2',
    [automacaoId, limite],
  );
  return rows;
}

export async function execucaoPorId(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<Execucao & { automacao_nome: string; ws_slug: string; ws_nome: string; ws_fuso: string }>(
    `SELECT e.*, a.nome AS automacao_nome, w.slug AS ws_slug, w.nome AS ws_nome, w.fuso AS ws_fuso
       FROM execucoes e JOIN automacoes a ON a.id = e.automacao_id JOIN workspaces w ON w.id = a.workspace_id
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function mensagensDaExecucao(db: Db, execucaoId: string) {
  const { rows } = await db.query<Mensagem>(
    'SELECT * FROM mensagens WHERE execucao_id = $1 ORDER BY linha NULLS LAST, criado_em',
    [execucaoId],
  );
  return rows;
}

export async function registrarAcao(
  db: Db,
  acao: string,
  alvo: { workspaceId?: string | null; automacaoId?: string | null },
  detalhe?: unknown,
): Promise<void> {
  await db.query(
    'INSERT INTO registro_acoes (workspace_id, automacao_id, acao, detalhe) VALUES ($1, $2, $3, $4)',
    [alvo.workspaceId ?? null, alvo.automacaoId ?? null, acao, detalhe === undefined ? null : JSON.stringify(detalhe)],
  );
}
