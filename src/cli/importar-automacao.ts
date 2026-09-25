import { readFile } from 'node:fs/promises';
import { criarPool } from '../db/pool.js';
import { cifrar } from '../lib/cripto.js';
import { fusoValido } from '../lib/tempo.js';
import { lerConfig } from '../motor/config.js';
import { proximoHorario } from '../worker/agenda.js';
import { lerArgumentos, obrigatorio } from './argumentos.js';

const USO = `npm run automacao:importar -- --arquivo seeds/local/cliente.json

Cria ou atualiza (pelo nome) um cliente e sua automação a partir de um arquivo JSON:
{
  "workspace": { "slug": "meu-cliente", "nome": "Meu Cliente", "fuso": "America/Sao_Paulo" },
  "automacao": { "nome": "Disparo semanal", "receita": "disparo_recorrente_ia", "agenda_cron": "0 10 * * 3", "config": { ... } }
}
A chave de IA pode vir em OPENAI_API_KEY (nunca no arquivo). A automação é criada pausada.`;

const args = lerArgumentos();
const arquivo = obrigatorio(args, 'arquivo', USO);
const url = process.env.DATABASE_URL;
const segredo = process.env.APP_SECRET;
if (!url) throw new Error('Defina DATABASE_URL');

const dados = JSON.parse(await readFile(arquivo, 'utf8')) as {
  workspace: { slug: string; nome: string; fuso?: string };
  automacao: { nome: string; receita?: string; agenda_cron?: string | null; config: unknown };
};
const fuso = dados.workspace.fuso ?? 'America/Sao_Paulo';
if (!fusoValido(fuso)) throw new Error(`Fuso inválido: ${fuso}`);
const config = lerConfig(dados.automacao.config);
if (dados.automacao.agenda_cron) proximoHorario(dados.automacao.agenda_cron, fuso);

const db = criarPool(url);
const { rows: ws } = await db.query<{ id: string }>(
  `INSERT INTO workspaces (slug, nome, fuso) VALUES ($1, $2, $3)
   ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, fuso = EXCLUDED.fuso RETURNING id`,
  [dados.workspace.slug, dados.workspace.nome, fuso],
);
const workspaceId = ws[0]!.id;

if (process.env.OPENAI_API_KEY) {
  if (!segredo) throw new Error('Defina APP_SECRET para cifrar a chave de IA');
  await db.query('UPDATE workspaces SET llm_chave_cifrada = $2 WHERE id = $1', [workspaceId, cifrar(process.env.OPENAI_API_KEY, segredo)]);
  console.log('Chave de IA salva (cifrada).');
}

const { rows: existente } = await db.query<{ id: string }>(
  'SELECT id FROM automacoes WHERE workspace_id = $1 AND nome = $2',
  [workspaceId, dados.automacao.nome],
);
const receita = dados.automacao.receita ?? 'disparo_recorrente_ia';
if (existente[0]) {
  await db.query('UPDATE automacoes SET receita = $2, agenda_cron = $3, config = $4, atualizado_em = now() WHERE id = $1', [
    existente[0].id,
    receita,
    dados.automacao.agenda_cron ?? null,
    config,
  ]);
  console.log(`Automação atualizada: ${existente[0].id}`);
} else {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO automacoes (workspace_id, nome, receita, agenda_cron, config) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [workspaceId, dados.automacao.nome, receita, dados.automacao.agenda_cron ?? null, config],
  );
  console.log(`Automação criada (pausada): ${rows[0]!.id}`);
}
await db.end();
