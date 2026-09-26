// Entrada da Vercel: ela procura o app Hono exportado por padrão em src/index.ts.
// Para rodar como processo contínuo (Docker, servidor próprio), a entrada é src/processo.ts.
import { waitUntil } from '@vercel/functions';
import { criarAppServerless } from './aplicacao.js';

const app = criarAppServerless(process.env, waitUntil);

export default app;
