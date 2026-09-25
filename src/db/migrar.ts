import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

async function pastaMigracoes(): Promise<string> {
  // Funciona tanto com tsx (src/db) quanto compilado (dist/src/db)
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidato = join(dir, 'migrations');
    try {
      await readdir(candidato);
      return candidato;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('Pasta migrations/ não encontrada');
}

/** Aplica as migrações pendentes, em ordem, cada uma em sua transação. */
export async function migrar(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  const pasta = await pastaMigracoes();
  const arquivos = (await readdir(pasta)).filter((f) => f.endsWith('.sql')).sort();
  const cliente = await db.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query('SELECT pg_advisory_lock(727001)');
    await cliente.query(
      'CREATE TABLE IF NOT EXISTS schema_migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM schema_migracoes');
    const feitas = new Set(rows.map((r) => r.nome));
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = await readFile(join(pasta, arquivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migracoes (nome) VALUES ($1)', [arquivo]);
        await cliente.query('COMMIT');
      } catch (e) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falha na migração ${arquivo}: ${(e as Error).message}`);
      }
      aplicadas.push(arquivo);
      log(`migração aplicada: ${arquivo}`);
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    cliente.release();
  }
  return aplicadas;
}
