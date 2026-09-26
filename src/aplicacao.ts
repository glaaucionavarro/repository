import type { Hono } from 'hono';
import { CanalSimulado } from './conectores/canal.js';
import { OpenAI } from './conectores/llm.js';
import { GoogleSheets, PlanilhasNaoConfiguradas } from './conectores/planilhas.js';
import { carregarConfig, type Config } from './config.js';
import { migrar } from './db/migrar.js';
import { criarPool, type Db } from './db/pool.js';
import type { Dependencias } from './motor/execucao.js';
import { criarApp, criarAppDeErro } from './web/app.js';

export const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

export function criarDependencias(config: Config, db: Db): Dependencias {
  return {
    db,
    planilhas: config.contaServicoGoogle ? new GoogleSheets(config.contaServicoGoogle) : new PlanilhasNaoConfiguradas(),
    criarLLM: (chave) => new OpenAI(chave),
    canais: { simulado: new CanalSimulado() },
    segredo: config.appSecret,
    precos: config.precos,
    log,
  };
}

/**
 * App para ambientes serverless (Vercel): sem processo contínuo.
 * A agenda e a fila rodam em /tarefas/tick (cron a cada minuto), e "Rodar agora"/"Prévia"
 * começam na hora, em segundo plano, via `emSegundoPlano` (waitUntil).
 * Se as variáveis de ambiente estiverem erradas, o site mostra o que falta em vez de cair.
 */
export function criarAppServerless(env: NodeJS.ProcessEnv, emSegundoPlano?: (p: Promise<unknown>) => void): Hono {
  let config: Config;
  try {
    config = carregarConfig(env);
  } catch (e) {
    return criarAppDeErro((e as Error).message);
  }
  const db = criarPool(config.databaseUrl, config.poolMax);
  let migracao: Promise<unknown> | null = null;
  const preparar = async () => {
    migracao ??= migrar(db, log).catch((e) => {
      migracao = null; // tenta de novo na próxima requisição
      throw e;
    });
    await migracao;
  };
  return criarApp({
    db,
    config,
    deps: criarDependencias(config, db),
    preparar,
    emSegundoPlano,
  });
}
