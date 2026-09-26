/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';

export const Layout: FC<{ titulo: string; logado?: boolean; atualizarEm?: number; children?: Child }> = ({
  titulo,
  logado = true,
  atualizarEm,
  children,
}) => (
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {atualizarEm ? <meta http-equiv="refresh" content={String(atualizarEm)} /> : null}
      <title>{titulo} · Dex Automation</title>
      <link rel="stylesheet" href="/static/app.css" />
    </head>
    <body>
      {logado ? (
        <header class="topo">
          <a class="marca" href="/">
            Dex Automation
          </a>
          <nav>
            <a href="/workspaces">Clientes</a>
          </nav>
          <form method="post" action="/sair">
            <button type="submit">Sair</button>
          </form>
        </header>
      ) : null}
      <main>{children}</main>
    </body>
  </html>
);

const TONS: Record<string, [string, string]> = {
  // execução
  pendente: ['neutro', 'na fila'],
  preparando: ['info', 'preparando'],
  disparando: ['info', 'disparando'],
  concluida: ['ok', 'concluída'],
  abortada: ['alerta', 'abortada'],
  falhou: ['perigo', 'falhou'],
  // mensagem
  pulada: ['neutro', 'pulada'],
  gerada: ['info', 'gerada'],
  precisa_revisao: ['alerta', 'precisa revisão'],
  agendada: ['info', 'agendada'],
  simulada: ['ok', 'simulada'],
  enviada: ['ok', 'enviada'],
  // automação
  ativa: ['ok', 'ativa'],
  pausada: ['neutro', 'pausada'],
  sombra: ['info', 'modo sombra'],
  real: ['alerta', 'envio real'],
  // tipo de execução
  agendada_tipo: ['neutro', 'agendada'],
  manual: ['neutro', 'manual'],
  previa: ['info', 'prévia'],
};

export const Selo: FC<{ status: string }> = ({ status }) => {
  const [tom, texto] = TONS[status] ?? ['neutro', status];
  return <span class={`selo ${tom}`}>{texto}</span>;
};

export const Aviso: FC<{ tipo?: 'erro' | 'ok' | 'info'; children?: Child }> = ({ tipo = 'info', children }) => (
  <div class={`aviso ${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
    {children}
  </div>
);

/** Mensagem curta vinda de ?ok= ou ?erro= depois de um redirecionamento. */
export const Recado: FC<{ ok?: string; erro?: string }> = ({ ok, erro }) => (
  <>
    {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
    {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
  </>
);

export const Metrica: FC<{ rotulo: string; valor: Child }> = ({ rotulo, valor }) => (
  <div class="metrica">
    <div class="rotulo">{rotulo}</div>
    <div class="valor">{valor}</div>
  </div>
);

export function formatarUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return 'US$ 0';
  return `US$ ${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

export function formatarDuracao(inicio: Date | null, fim: Date | null): string {
  if (!inicio || !fim) return '—';
  const s = Math.round((fim.getTime() - inicio.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}min`;
}

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
