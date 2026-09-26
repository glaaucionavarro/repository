// Entrada para processo contínuo (Docker, servidor próprio, desenvolvimento): painel + worker + agenda.
// Na Vercel a entrada é src/index.ts.
import { serve } from '@hono/node-server';
import { criarDependencias, log } from './aplicacao.js';
import { carregarConfig } from './config.js';
import { migrar } from './db/migrar.js';
import { criarPool } from './db/pool.js';
import { criarApp } from './web/app.js';
import { Agenda } from './worker/agenda.js';
import { Worker } from './worker/worker.js';

async function main() {
  const config = carregarConfig();
  const db = criarPool(config.databaseUrl, config.poolMax);
  await migrar(db, log);

  if (!config.contaServicoGoogle) log('AVISO: GOOGLE_SERVICE_ACCOUNT_JSON não configurada; nenhuma planilha poderá ser lida.');

  const deps = criarDependencias(config, db);
  const worker = config.papeis.has('worker') ? new Worker(deps) : null;
  const agenda = config.papeis.has('agenda') ? new Agenda(db, log) : null;
  worker?.iniciar();
  agenda?.iniciar();

  const servidor = config.papeis.has('web')
    ? serve({ fetch: criarApp({ db, config, deps }).fetch, port: config.porta }, (info) =>
        log(`painel em http://localhost:${info.port}`),
      )
    : null;

  log(`papéis ativos: ${[...config.papeis].join(', ')}`);

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    log(`${sinal} recebido, encerrando…`);
    agenda?.parar();
    servidor?.close();
    // Uma execução em andamento termina; se o processo for morto antes, ela é retomada no próximo início
    await worker?.parar();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
