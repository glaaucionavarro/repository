import { executar, type Dependencias } from '../motor/execucao.js';
import { cicloAgenda } from './agenda.js';
import { recuperarTravadas, reivindicar } from './fila.js';

/** Margem para não começar uma execução que mal teria tempo de avançar. */
const MARGEM_MS = 30_000;

/**
 * Processa a fila até o prazo. Execuções que não terminam a tempo pausam e voltam para a fila.
 * É o "worker" do modo serverless: roda dentro de uma chamada HTTP com tempo máximo.
 */
export async function processarFila(deps: Dependencias, prazo: Date): Promise<number> {
  await recuperarTravadas(deps.db);
  let processadas = 0;
  const vistas = new Set<string>();
  while (Date.now() < prazo.getTime() - MARGEM_MS) {
    const id = await reivindicar(deps.db);
    if (!id) break;
    try {
      await executar(id, { ...deps, prazo });
    } catch (e) {
      deps.log?.(`erro inesperado na execução ${id}: ${(e as Error).stack ?? e}`);
    }
    processadas++;
    // Uma execução pausada volta para a fila; não adianta pegá-la de novo nesta mesma chamada
    if (vistas.has(id)) break;
    vistas.add(id);
  }
  return processadas;
}

/** Um ciclo completo do modo serverless: agenda + fila. Chamado pelo cron a cada minuto. */
export async function tick(deps: Dependencias, prazo: Date): Promise<{ agendadas: number; processadas: number }> {
  const agendadas = await cicloAgenda(deps.db, new Date(), 6, deps.log);
  const processadas = await processarFila(deps, prazo);
  return { agendadas, processadas };
}
