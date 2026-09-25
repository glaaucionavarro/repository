import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanalSimulado } from '../src/conectores/canal.js';
import { PRECOS_PADRAO } from '../src/conectores/llm.js';
import { PlanilhasEmMemoria } from '../src/conectores/planilhas.js';
import type { Db } from '../src/db/pool.js';
import { formPadrao } from '../src/motor/receitas.js';
import { criarApp } from '../src/web/app.js';
import { Worker } from '../src/worker/worker.js';
import { bancoDisponivel, dadosPlanilha, LLMFalso, PLANILHA, prepararBanco } from './ajuda.js';

const SENHA = 'senha-de-teste';
const SEGREDO = 'z'.repeat(32);
const disponivel = await bancoDisponivel();

describe.skipIf(!disponivel)('painel', () => {
  let db: Db;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';

  beforeAll(async () => {
    db = await prepararBanco('teste_web');
    app = criarApp({ db, config: { adminPassword: SENHA, appSecret: SEGREDO, cookieSeguro: false } });
  });
  afterAll(async () => {
    await db?.end();
  });

  const pedir = (caminho: string, init: RequestInit = {}) =>
    app.request(caminho, { ...init, headers: { host: 'painel.local', cookie, ...(init.headers ?? {}) } });

  const postar = (caminho: string, campos: Record<string, string | string[]>, headers: Record<string, string> = {}) => {
    const corpo = new URLSearchParams();
    for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) corpo.append(k, x);
    return pedir(caminho, {
      method: 'POST',
      body: corpo,
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://painel.local', ...headers },
    });
  };

  it('exige login, menos na saúde', async () => {
    expect((await pedir('/saude')).status).toBe(200);
    const r = await pedir('/workspaces');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login?voltar=%2Fworkspaces');
  });

  it('recusa senha errada e aceita a certa', async () => {
    expect((await postar('/login', { senha: 'errada' })).status).toBe(401);
    const r = await postar('/login', { senha: SENHA, voltar: '/workspaces' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/workspaces');
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    expect((await pedir('/workspaces')).status).toBe(200);
  });

  it('bloqueia POST de outra origem', async () => {
    const r = await postar('/workspaces', { nome: 'X' }, { origin: 'https://site-malicioso.com' });
    expect(r.status).toBe(403);
    expect((await postar('/workspaces', { nome: 'X' }, { origin: 'null' })).status).toBe(403);
  });

  it('não usa no-referrer, que faria o navegador mandar Origin: null nos formulários', async () => {
    const r = await pedir('/login');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('cria cliente e guarda a chave cifrada', async () => {
    const r = await postar('/workspaces', { nome: 'Confeitaria Teste', slug: '', fuso: 'America/Sao_Paulo' });
    expect(r.headers.get('location')).toMatch(/^\/w\/confeitaria-teste\?ok=/);
    const dup = await postar('/workspaces', { nome: 'Outra', slug: 'confeitaria-teste', fuso: 'America/Sao_Paulo' });
    expect(dup.status).toBe(422);
    expect(await dup.text()).toContain('Já existe');

    await postar('/w/confeitaria-teste/ia', { chave: 'sk-segredo-1234' });
    const { rows } = await db.query('SELECT llm_chave_cifrada FROM workspaces WHERE slug = $1', ['confeitaria-teste']);
    expect(rows[0].llm_chave_cifrada).toMatch(/^v1:/);
    expect(rows[0].llm_chave_cifrada).not.toContain('sk-segredo');
    const pagina = await (await pedir('/w/confeitaria-teste')).text();
    expect(pagina).toContain('••••1234');
    expect(pagina).not.toContain('sk-segredo-1234');
  });

  let automacaoId = '';

  it('cria automação pelo formulário e mostra erros de validação', async () => {
    const f = formPadrao();
    const campos: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(f)) {
      if (Array.isArray(v)) campos[k] = v.map(String);
      else if (typeof v === 'boolean') {
        if (v) campos[k] = '1';
      } else campos[k] = v;
    }
    campos.nome = 'Disparo de quarta';
    campos.planilha = `https://docs.google.com/spreadsheets/d/${PLANILHA}/edit#gid=0`;
    campos.colPreferencias = 'Preferências';

    const invalido = await postar('/w/confeitaria-teste/automacoes', { ...campos, janelaInicio: '20:00', janelaFim: '08:00' });
    expect(invalido.status).toBe(422);
    expect(await invalido.text()).toContain('fim da janela');

    const r = await postar('/w/confeitaria-teste/automacoes', campos);
    expect(r.status).toBe(302);
    automacaoId = r.headers.get('location')!.split('?')[0]!.split('/').pop()!;
    const { rows } = await db.query('SELECT agenda_cron, ativa, config FROM automacoes WHERE id = $1', [automacaoId]);
    expect(rows[0]).toMatchObject({ agenda_cron: '0 10 * * 3', ativa: false });
    expect(rows[0].config.fontes.contatos.planilha).toBe(PLANILHA);

    const detalhe = await (await pedir(`/a/${automacaoId}`)).text();
    expect(detalhe).toContain('quarta às 10:00');
    expect(detalhe).toContain('modo sombra');
  });

  it('o formulário de edição volta com os mesmos valores', async () => {
    const html = await (await pedir(`/a/${automacaoId}/editar`)).text();
    expect(html).toContain('value="Disparo de quarta"');
    expect(html).toContain(`value="${PLANILHA}"`);
    expect(html).toMatch(/name="agendaDias" value="3" checked/);
  });

  it('liga, roda e mostra o resultado com o texto escapado', async () => {
    expect((await postar(`/a/${automacaoId}/ligar`, {})).headers.get('location')).toContain('ok=');
    const rodar = await postar(`/a/${automacaoId}/rodar`, {});
    const execucaoId = rodar.headers.get('location')!.split('/').pop()!;

    const dados = dadosPlanilha();
    dados[PLANILHA].Clientes.push(['', '<script>alert(1)</script>', '31 95555-4444', 'Bolo de cenoura', '']);
    const worker = new Worker({
      db,
      planilhas: new PlanilhasEmMemoria(dados),
      criarLLM: () => new LLMFalso(),
      canais: { simulado: new CanalSimulado() },
      segredo: SEGREDO,
      precos: PRECOS_PADRAO,
    });
    expect(await worker.ciclo()).toBe(true);

    const html = await (await pedir(`/e/${execucaoId}`)).text();
    expect(html).toContain('concluída');
    expect(html).toContain('lidos da planilha');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    const filtrado = await (await pedir(`/e/${execucaoId}?status=pulada`)).text();
    expect(filtrado).toContain('sem número na planilha');
  });

  it('editor JSON valida antes de salvar', async () => {
    const r = await postar(`/a/${automacaoId}/json`, { config: '{"fontes": {}}', cron: '0 10 * * 3' });
    expect(r.status).toBe(422);
    expect(await r.text()).toContain('Configuração inválida');
    const cronRuim = await postar(`/a/${automacaoId}/json`, { config: '{}', cron: 'toda hora' });
    expect(cronRuim.status).toBe(422);
  });

  it('pausa', async () => {
    await postar(`/a/${automacaoId}/pausar`, {});
    const { rows } = await db.query('SELECT ativa FROM automacoes WHERE id = $1', [automacaoId]);
    expect(rows[0].ativa).toBe(false);
    const { rows: acoes } = await db.query('SELECT acao FROM registro_acoes WHERE automacao_id = $1 ORDER BY id', [automacaoId]);
    expect(acoes.map((a: any) => a.acao)).toEqual(['criou_automacao', 'ligou_automacao', 'rodou_manualmente', 'pausou_automacao']);
  });

  it('404 para ids inexistentes ou malformados', async () => {
    expect((await pedir('/a/nao-e-uuid')).status).toBe(404);
    expect((await pedir('/e/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe.skipIf(!disponivel)('redirecionamento do login', () => {
  it('só aceita caminhos internos', async () => {
    const db = await prepararBanco('teste_web_login');
    const app = criarApp({ db, config: { adminPassword: SENHA, appSecret: SEGREDO, cookieSeguro: false } });
    const casos: [string, string][] = [
      ['/a/123', '/a/123'],
      ['//site-malicioso.com', '/'],
      ['/\\site-malicioso.com', '/'],
      ['https://site-malicioso.com', '/'],
    ];
    for (const [voltar, esperado] of casos) {
      const r = await app.request('/login', {
        method: 'POST',
        body: new URLSearchParams({ senha: SENHA, voltar }),
        headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'painel.local' },
      });
      expect(r.headers.get('location')).toBe(esperado);
    }
    await db.end();
  });
});
