import { migrar } from '../db/migrar.js';
import { criarPool } from '../db/pool.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL');
  process.exit(1);
}
const db = criarPool(url);
const aplicadas = await migrar(db, console.log);
console.log(aplicadas.length ? `${aplicadas.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
await db.end();
