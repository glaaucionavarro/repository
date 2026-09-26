import { MIGRACOES } from './migracoes/index.js';
import type { Db } from './pool.js';

/**
 * Aplica as migrações pendentes numa única transação.
 * O lock é de transação (pg_advisory_xact_lock), e não de sessão, para funcionar atrás de poolers
 * em modo transação (Neon, PgBouncer): um lock de sessão poderia nunca ser liberado.
 */
export async function migrar(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  const cliente = await db.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock(727001)');
    await cliente.query(
      'CREATE TABLE IF NOT EXISTS schema_migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM schema_migracoes');
    const feitas = new Set(rows.map((r) => r.nome));
    for (const m of MIGRACOES) {
      if (feitas.has(m.nome)) continue;
      try {
        await cliente.query(m.sql);
      } catch (e) {
        throw new Error(`Falha na migração ${m.nome}: ${(e as Error).message}`);
      }
      await cliente.query('INSERT INTO schema_migracoes (nome) VALUES ($1)', [m.nome]);
      aplicadas.push(m.nome);
    }
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
  for (const nome of aplicadas) log(`migração aplicada: ${nome}`);
  return aplicadas;
}
