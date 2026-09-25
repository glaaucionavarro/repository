import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { iguaisSeguro } from '../lib/cripto.js';

const COOKIE = 'dex_sessao';
const DURACAO_MS = 7 * 24 * 3_600_000;
const LIVRES = ['/login', '/saude', '/static/'];

export interface OpcoesAuth {
  senha: string;
  segredo: string;
  cookieSeguro: boolean;
}

export function exigirLogin(o: OpcoesAuth): MiddlewareHandler {
  return async (c, next) => {
    if (LIVRES.some((p) => c.req.path === p || (p.endsWith('/') && c.req.path.startsWith(p)))) return next();
    const valor = await getSignedCookie(c, o.segredo, COOKIE);
    if (valor && Number(valor) > Date.now()) return next();
    if (c.req.method === 'GET') return c.redirect(`/login?voltar=${encodeURIComponent(c.req.path)}`);
    return c.text('Sessão expirada. Entre de novo.', 401);
  };
}

/** Bloqueia POSTs vindos de outro site (o cookie SameSite=Lax já cobre a maior parte). */
export function mesmaOrigem(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origem = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
      if (origem && host) {
        let hostOrigem: string;
        try {
          hostOrigem = new URL(origem).host;
        } catch {
          return c.text('Origem inválida', 403);
        }
        if (hostOrigem !== host) return c.text('Origem não permitida', 403);
      }
    }
    return next();
  };
}

const tentativas = new Map<string, { n: number; desde: number }>();

export function loginBloqueado(ip: string, agora = Date.now()): boolean {
  const t = tentativas.get(ip);
  if (!t || agora - t.desde > 15 * 60_000) return false;
  return t.n >= 10;
}

function registrarFalha(ip: string, agora = Date.now()): void {
  const t = tentativas.get(ip);
  if (!t || agora - t.desde > 15 * 60_000) tentativas.set(ip, { n: 1, desde: agora });
  else t.n++;
}

export function ipDe(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
}

export async function tentarLogin(c: Context, o: OpcoesAuth, senha: string): Promise<boolean> {
  const ip = ipDe(c);
  if (!iguaisSeguro(senha, o.senha)) {
    registrarFalha(ip);
    return false;
  }
  tentativas.delete(ip);
  await setSignedCookie(c, COOKIE, String(Date.now() + DURACAO_MS), o.segredo, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: o.cookieSeguro,
    path: '/',
    maxAge: DURACAO_MS / 1000,
  });
  return true;
}

export function sair(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/' });
}
