import type { Db } from '../db/pool.js';

/** Pega a execução pendente mais antiga. SKIP LOCKED permite vários workers sem disputa. */
export async function reivindicar(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE execucoes
        SET status = 'preparando', iniciada_em = coalesce(iniciada_em, now()),
            heartbeat_em = now(), tentativas = tentativas + 1
      WHERE id = (SELECT id FROM execucoes WHERE status = 'pendente'
                   ORDER BY criado_em FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`,
  );
  return rows[0]?.id ?? null;
}

/**
 * Execuções sem batimento há `minutos` (processo caiu no meio) voltam para a fila e são retomadas.
 * Depois de `maxTentativas`, são marcadas como falha para não entrar em loop.
 */
export async function recuperarTravadas(db: Db, minutos = 5, maxTentativas = 3): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE execucoes
        SET status = CASE WHEN tentativas >= $2 THEN 'falhou' ELSE 'pendente' END,
            motivo = CASE WHEN tentativas >= $2 THEN 'Interrompida várias vezes (o servidor reiniciou no meio?)' ELSE motivo END,
            finalizada_em = CASE WHEN tentativas >= $2 THEN now() ELSE finalizada_em END
      WHERE status IN ('preparando', 'disparando')
        AND heartbeat_em < now() - make_interval(mins => $1)`,
    [minutos, maxTentativas],
  );
  return rowCount ?? 0;
}
