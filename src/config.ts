import { z } from 'zod';
import { lerPrecos, type TabelaPrecos } from './conectores/llm.js';
import { lerContaServico, type ContaServico } from './conectores/planilhas.js';

const esquema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  APP_SECRET: z.string().min(32, 'APP_SECRET precisa ter pelo menos 32 caracteres'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD precisa ter pelo menos 8 caracteres'),
  PORT: z.coerce.number().int().default(3000),
  COOKIE_SEGURO: z.enum(['true', 'false']).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  PAPEIS: z.string().default('web,worker,agenda'),
  LLM_PRECOS_JSON: z.string().optional(),
  /** Protege /tarefas/tick. Na Vercel, o cron manda esse valor no cabeçalho Authorization. */
  CRON_SECRET: z.string().min(16, 'CRON_SECRET precisa ter pelo menos 16 caracteres').optional(),
  PG_POOL_MAX: z.coerce.number().int().min(1).optional(),
  /** Quanto tempo cada tick pode trabalhar antes de pausar (o limite da função na Vercel é maior) */
  TICK_ORCAMENTO_SEG: z.coerce.number().int().min(10).default(240),
  VERCEL: z.string().optional(),
});

export interface Config {
  databaseUrl: string;
  appSecret: string;
  adminPassword: string;
  porta: number;
  cookieSeguro: boolean;
  contaServicoGoogle: ContaServico | null;
  papeis: Set<'web' | 'worker' | 'agenda'>;
  precos: TabelaPrecos;
  cronSecret: string | null;
  poolMax: number;
  tickOrcamentoSeg: number;
  /** Rodando na Vercel (sem processo contínuo: worker e agenda viram o tick do cron) */
  serverless: boolean;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const vazioComoAusente = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const r = esquema.safeParse(vazioComoAusente);
  if (!r.success) {
    const erros = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${erros}`);
  }
  const e = r.data;
  const papeis = new Set(
    e.PAPEIS.split(',')
      .map((p) => p.trim())
      .filter((p): p is 'web' | 'worker' | 'agenda' => p === 'web' || p === 'worker' || p === 'agenda'),
  );
  return {
    databaseUrl: e.DATABASE_URL,
    appSecret: e.APP_SECRET,
    adminPassword: e.ADMIN_PASSWORD,
    porta: e.PORT,
    // Na Vercel sempre há HTTPS; fora dela, só com COOKIE_SEGURO=true
    cookieSeguro: e.COOKIE_SEGURO ? e.COOKIE_SEGURO === 'true' : Boolean(e.VERCEL),
    contaServicoGoogle: e.GOOGLE_SERVICE_ACCOUNT_JSON ? lerContaServico(e.GOOGLE_SERVICE_ACCOUNT_JSON) : null,
    papeis,
    precos: lerPrecos(e.LLM_PRECOS_JSON),
    cronSecret: e.CRON_SECRET ?? null,
    poolMax: e.PG_POOL_MAX ?? (e.VERCEL ? 3 : 10),
    tickOrcamentoSeg: e.TICK_ORCAMENTO_SEG,
    serverless: Boolean(e.VERCEL),
  };
}
