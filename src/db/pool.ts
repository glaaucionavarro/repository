import pg from 'pg';

// numeric chega como string por padrão; aqui só guardamos custos pequenos, então float basta
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool;

export function criarPool(url: string, max = 10): Db {
  return new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 10_000 });
}

export async function emTransacao<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await db.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}
