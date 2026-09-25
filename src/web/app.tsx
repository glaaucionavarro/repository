import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { cifrar, decifrar } from '../lib/cripto.js';
import { chavePeriodo, fusoValido } from '../lib/tempo.js';
import { ErroConfig, lerConfig } from '../motor/config.js';
import { configParaForm, DISPARO_IA, formPadrao, formParaConfig, type FormDisparoIA } from '../motor/receitas.js';
import { lerCronSimples, montarCron, proximoHorario } from '../worker/agenda.js';
import { exigirLogin, loginBloqueado, ipDe, mesmaOrigem, sair, tentarLogin } from './auth.js';
import {
  automacaoPorId,
  automacoesDoWorkspace,
  execucaoPorId,
  execucoesDaAutomacao,
  listarWorkspaces,
  mensagensDaExecucao,
  registrarAcao,
  workspacePorSlug,
} from './consultas.js';
import { EditorJson, FormAutomacao, PaginaAutomacao } from './paginas/automacao.js';
import { PaginaExecucao } from './paginas/execucao.js';
import { Login } from './paginas/login.js';
import { ListaWorkspaces, PaginaWorkspace } from './paginas/workspaces.js';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'static', 'app.css'), 'utf8');

type Corpo = Record<string, string | File | (string | File)[]>;
const texto = (c: Corpo, nome: string) => {
  const v = c[nome];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : '';
};
const lista = (c: Corpo, nome: string) => {
  const v = c[nome];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === 'string');
};
const numeros = (c: Corpo, nome: string) => lista(c, nome).map(Number).filter((n) => Number.isInteger(n));

function lerFormDisparo(c: Corpo): FormDisparoIA {
  const base = formPadrao();
  const f = {} as FormDisparoIA;
  for (const chave of Object.keys(base) as (keyof FormDisparoIA)[]) {
    if (chave === 'agendaDias' || chave === 'diasEnvio') (f as any)[chave] = numeros(c, chave);
    else if (typeof base[chave] === 'boolean') (f as any)[chave] = texto(c, chave) === '1';
    else (f as any)[chave] = texto(c, chave).replace(/\r\n/g, '\n');
  }
  return f;
}

/** Valida o formulário e devolve config + cron, ou a mensagem de erro. */
function validarFormDisparo(f: FormDisparoIA, fuso: string): { config: unknown; cron: string | null } | { erro: string } {
  if (!f.nome.trim()) return { erro: 'Dê um nome para a automação.' };
  let cron: string | null = null;
  if (f.agendaDias.length > 0) {
    if (!/^\d{2}:\d{2}$/.test(f.agendaHora)) return { erro: 'Informe o horário da agenda.' };
    cron = montarCron(f.agendaDias, f.agendaHora);
    proximoHorario(cron, fuso);
  }
  const config = formParaConfig(f);
  try {
    lerConfig(config);
  } catch (e) {
    return { erro: (e as Error).message };
  }
  return { config, cron };
}

export interface OpcoesApp {
  db: Db;
  config: Pick<Config, 'adminPassword' | 'appSecret' | 'cookieSeguro'>;
}

export function criarApp({ db, config }: OpcoesApp): Hono {
  const app = new Hono();
  const auth = { senha: config.adminPassword, segredo: config.appSecret, cookieSeguro: config.cookieSeguro };

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] },
      // Com "no-referrer" o navegador manda Origin: null nos formulários e a checagem de origem recusaria o próprio painel
      referrerPolicy: 'same-origin',
      // O painel pode rodar sem HTTPS em rede interna; HSTS fica a cargo do proxy
      strictTransportSecurity: false,
    }),
  );
  app.use('*', mesmaOrigem());
  app.use('*', exigirLogin(auth));

  app.onError((e, c) => {
    console.error(e);
    return c.text(`Erro inesperado: ${e.message}`, 500);
  });

  app.get('/saude', async (c) => {
    await db.query('SELECT 1');
    return c.text('ok');
  });
  app.get('/static/app.css', (c) => {
    c.header('content-type', 'text/css; charset=utf-8');
    c.header('cache-control', 'public, max-age=3600');
    return c.body(CSS);
  });

  // ---- Login
  app.get('/login', (c) => c.html(<Login voltar={c.req.query('voltar')} />));
  app.post('/login', async (c) => {
    const corpo = await c.req.parseBody();
    const voltar = texto(corpo, 'voltar');
    // Só caminhos internos: "//site" e "/\site" levariam para outro domínio
    const destino = /^\/(?![/\\])/.test(voltar) ? voltar : '/';
    if (loginBloqueado(ipDe(c))) {
      return c.html(<Login erro="Muitas tentativas. Espere 15 minutos." voltar={destino} />, 429);
    }
    if (!(await tentarLogin(c, auth, texto(corpo, 'senha')))) {
      return c.html(<Login erro="Senha incorreta." voltar={destino} />, 401);
    }
    return c.redirect(destino);
  });
  app.post('/sair', (c) => {
    sair(c);
    return c.redirect('/login');
  });

  app.get('/', (c) => c.redirect('/workspaces'));

  // ---- Clientes (workspaces)
  app.get('/workspaces', async (c) =>
    c.html(<ListaWorkspaces workspaces={await listarWorkspaces(db)} ok={c.req.query('ok')} erro={c.req.query('erro')} />),
  );

  app.post('/workspaces', async (c) => {
    const corpo = await c.req.parseBody();
    const nome = texto(corpo, 'nome').trim();
    const fuso = texto(corpo, 'fuso').trim() || 'America/Sao_Paulo';
    const slug =
      texto(corpo, 'slug').trim().toLowerCase() ||
      nome
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const valores = { nome, slug, fuso };
    const falhar = async (erro: string) =>
      c.html(<ListaWorkspaces workspaces={await listarWorkspaces(db)} erro={erro} valores={valores} />, 422);
    if (!nome) return falhar('Informe o nome do cliente.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return falhar('Identificador inválido: use letras minúsculas, números e hífen.');
    if (!fusoValido(fuso)) return falhar(`Fuso horário desconhecido: ${fuso}`);
    if (await workspacePorSlug(db, slug)) return falhar(`Já existe um cliente com o identificador "${slug}".`);
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO workspaces (slug, nome, fuso) VALUES ($1, $2, $3) RETURNING id',
      [slug, nome, fuso],
    );
    await registrarAcao(db, 'criou_cliente', { workspaceId: rows[0]!.id });
    return c.redirect(`/w/${slug}?ok=${encodeURIComponent('Cliente criado. Agora cadastre a chave de IA.')}`);
  });

  app.get('/w/:slug', async (c) => {
    const ws = await workspacePorSlug(db, c.req.param('slug'));
    if (!ws) return c.notFound();
    let chave: string | null = null;
    let erro = c.req.query('erro');
    if (ws.llm_chave_cifrada) {
      try {
        chave = decifrar(ws.llm_chave_cifrada, config.appSecret);
      } catch {
        erro = 'A chave salva não abre com o APP_SECRET atual. Cadastre de novo.';
      }
    }
    return c.html(
      <PaginaWorkspace ws={ws} chave={chave} automacoes={await automacoesDoWorkspace(db, ws.id)} ok={c.req.query('ok')} erro={erro} />,
    );
  });

  app.post('/w/:slug/ia', async (c) => {
    const ws = await workspacePorSlug(db, c.req.param('slug'));
    if (!ws) return c.notFound();
    const chave = texto(await c.req.parseBody(), 'chave').trim();
    if (!chave) return c.redirect(`/w/${ws.slug}?erro=${encodeURIComponent('Informe a chave.')}`);
    await db.query('UPDATE workspaces SET llm_chave_cifrada = $2 WHERE id = $1', [ws.id, cifrar(chave, config.appSecret)]);
    await registrarAcao(db, 'trocou_chave_ia', { workspaceId: ws.id });
    return c.redirect(`/w/${ws.slug}?ok=${encodeURIComponent('Chave salva.')}`);
  });

  // ---- Automações
  app.get('/w/:slug/automacoes/nova', async (c) => {
    const ws = await workspacePorSlug(db, c.req.param('slug'));
    if (!ws) return c.notFound();
    return c.html(<FormAutomacao ws={ws} f={formPadrao()} acao={`/w/${ws.slug}/automacoes`} titulo="Nova automação" />);
  });

  app.post('/w/:slug/automacoes', async (c) => {
    const ws = await workspacePorSlug(db, c.req.param('slug'));
    if (!ws) return c.notFound();
    const f = lerFormDisparo(await c.req.parseBody({ all: true }));
    const r = validarFormDisparo(f, ws.fuso);
    if ('erro' in r) {
      return c.html(<FormAutomacao ws={ws} f={f} acao={`/w/${ws.slug}/automacoes`} titulo="Nova automação" erro={r.erro} />, 422);
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO automacoes (workspace_id, nome, receita, agenda_cron, config) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ws.id, f.nome.trim(), DISPARO_IA, r.cron, r.config],
    );
    await registrarAcao(db, 'criou_automacao', { workspaceId: ws.id, automacaoId: rows[0]!.id });
    return c.redirect(`/a/${rows[0]!.id}?ok=${encodeURIComponent('Automação criada (pausada). Rode uma prévia para testar.')}`);
  });

  app.get('/a/:id', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    let cfg = null;
    let erroConfig: string | undefined;
    try {
      cfg = lerConfig(a.config);
    } catch (e) {
      erroConfig = (e as Error).message;
    }
    let proximo: Date | null = null;
    try {
      proximo = a.agenda_cron ? proximoHorario(a.agenda_cron, a.ws_fuso) : null;
    } catch (e) {
      erroConfig = (e as Error).message;
    }
    return c.html(
      <PaginaAutomacao
        a={a}
        config={cfg}
        erroConfig={erroConfig}
        proximo={proximo}
        execucoes={await execucoesDaAutomacao(db, a.id)}
        ok={c.req.query('ok')}
        erro={c.req.query('erro')}
      />,
    );
  });

  app.get('/a/:id/editar', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    if (a.receita !== DISPARO_IA) return c.redirect(`/a/${a.id}/json`);
    const f = configParaForm(a.nome, lerConfig(a.config), lerCronSimples(a.agenda_cron));
    return c.html(
      <FormAutomacao ws={{ slug: a.ws_slug, nome: a.ws_nome }} f={f} acao={`/a/${a.id}/editar`} titulo={`Editar: ${a.nome}`} />,
    );
  });

  app.post('/a/:id/editar', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    const f = lerFormDisparo(await c.req.parseBody({ all: true }));
    const r = validarFormDisparo(f, a.ws_fuso);
    if ('erro' in r) {
      return c.html(
        <FormAutomacao ws={{ slug: a.ws_slug, nome: a.ws_nome }} f={f} acao={`/a/${a.id}/editar`} titulo={`Editar: ${a.nome}`} erro={r.erro} />,
        422,
      );
    }
    await db.query(
      'UPDATE automacoes SET nome = $2, agenda_cron = $3, config = $4, atualizado_em = now() WHERE id = $1',
      [a.id, f.nome.trim(), r.cron, r.config],
    );
    await registrarAcao(db, 'editou_automacao', { workspaceId: a.workspace_id, automacaoId: a.id });
    return c.redirect(`/a/${a.id}?ok=${encodeURIComponent('Alterações salvas.')}`);
  });

  app.get('/a/:id/json', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    return c.html(<EditorJson a={a} json={JSON.stringify(a.config, null, 2)} cron={a.agenda_cron ?? ''} />);
  });

  app.post('/a/:id/json', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    const corpo = await c.req.parseBody();
    const json = texto(corpo, 'config');
    const cron = texto(corpo, 'cron').trim() || null;
    const falhar = (erro: string) => c.html(<EditorJson a={a} json={json} cron={cron ?? ''} erro={erro} />, 422);
    let bruto: unknown;
    try {
      bruto = JSON.parse(json);
    } catch (e) {
      return falhar(`JSON inválido: ${(e as Error).message}`);
    }
    try {
      lerConfig(bruto);
      if (cron) proximoHorario(cron, a.ws_fuso);
    } catch (e) {
      return falhar((e as Error).message);
    }
    await db.query(
      `UPDATE automacoes SET config = $2, agenda_cron = $3, receita = 'personalizada', atualizado_em = now() WHERE id = $1`,
      [a.id, bruto, cron],
    );
    await registrarAcao(db, 'editou_automacao_json', { workspaceId: a.workspace_id, automacaoId: a.id });
    return c.redirect(`/a/${a.id}?ok=${encodeURIComponent('Configuração salva.')}`);
  });

  app.post('/a/:id/ligar', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    if (!a.agenda_cron) return c.redirect(`/a/${a.id}?erro=${encodeURIComponent('Defina os dias e o horário da agenda antes de ligar.')}`);
    try {
      lerConfig(a.config);
    } catch (e) {
      return c.redirect(`/a/${a.id}?erro=${encodeURIComponent((e as Error).message)}`);
    }
    await db.query('UPDATE automacoes SET ativa = true, ativada_em = now() WHERE id = $1', [a.id]);
    await registrarAcao(db, 'ligou_automacao', { workspaceId: a.workspace_id, automacaoId: a.id });
    return c.redirect(`/a/${a.id}?ok=${encodeURIComponent('Agenda ligada.')}`);
  });

  app.post('/a/:id/pausar', async (c) => {
    const a = await automacaoPorId(db, c.req.param('id'));
    if (!a) return c.notFound();
    await db.query('UPDATE automacoes SET ativa = false WHERE id = $1', [a.id]);
    await registrarAcao(db, 'pausou_automacao', { workspaceId: a.workspace_id, automacaoId: a.id });
    return c.redirect(`/a/${a.id}?ok=${encodeURIComponent('Automação pausada.')}`);
  });

  const enfileirar = async (c: Context, tipo: 'manual' | 'previa') => {
    const a = await automacaoPorId(db, c.req.param('id')!);
    if (!a) return c.notFound();
    let periodo: string | null = null;
    try {
      periodo = tipo === 'manual' ? chavePeriodo(new Date(), a.ws_fuso, lerConfig(a.config).periodo) : null;
    } catch (e) {
      if (!(e instanceof ErroConfig)) throw e;
    }
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO execucoes (automacao_id, tipo, periodo) VALUES ($1, $2, $3) RETURNING id',
      [a.id, tipo, periodo],
    );
    await registrarAcao(db, tipo === 'manual' ? 'rodou_manualmente' : 'rodou_previa', {
      workspaceId: a.workspace_id,
      automacaoId: a.id,
    });
    return c.redirect(`/e/${rows[0]!.id}`);
  };
  app.post('/a/:id/rodar', (c) => enfileirar(c, 'manual'));
  app.post('/a/:id/previa', (c) => enfileirar(c, 'previa'));

  // ---- Execuções
  app.get('/e/:id', async (c) => {
    const e = await execucaoPorId(db, c.req.param('id'));
    if (!e) return c.notFound();
    return c.html(<PaginaExecucao e={e} mensagens={await mensagensDaExecucao(db, e.id)} filtro={c.req.query('status')} />);
  });

  return app;
}
