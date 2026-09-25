import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CanalSimulado } from '../src/conectores/canal.js';
import { ErroLLMDefinitivo, PRECOS_PADRAO } from '../src/conectores/llm.js';
import { PlanilhasEmMemoria } from '../src/conectores/planilhas.js';
import type { Db } from '../src/db/pool.js';
import { aleatorioComSemente } from '../src/lib/aleatorio.js';
import { cifrar } from '../src/lib/cripto.js';
import { dataNoFuso, partesNoFuso } from '../src/lib/tempo.js';
import { executar, type Dependencias } from '../src/motor/execucao.js';
import { cicloAgenda } from '../src/worker/agenda.js';
import { recuperarTravadas, reivindicar } from '../src/worker/fila.js';
import { bancoDisponivel, configTeste, dadosPlanilha, LLMFalso, prepararBanco, type Resposta } from './ajuda.js';

const SEGREDO = 's'.repeat(32);
const SP = 'America/Sao_Paulo';
// Quarta-feira, 30/09/2026, 10:00 em São Paulo
const AGORA = dataNoFuso(2026, 9, 30, 10, 0, SP);

const disponivel = await bancoDisponivel();

describe.skipIf(!disponivel)('execução (Postgres)', () => {
  let db: Db;
  let workspaceId: string;
  let planilhas: PlanilhasEmMemoria;

  beforeAll(async () => {
    db = await prepararBanco('teste_execucao');
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE workspaces CASCADE');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO workspaces (slug, nome, llm_chave_cifrada) VALUES ('teste', 'Teste', $1) RETURNING id`,
      [cifrar('sk-teste', SEGREDO)],
    );
    workspaceId = rows[0]!.id;
    planilhas = new PlanilhasEmMemoria(dadosPlanilha());
  });

  function deps(llm: LLMFalso): Dependencias {
    return {
      db,
      planilhas,
      criarLLM: () => llm,
      canais: { simulado: new CanalSimulado() },
      segredo: SEGREDO,
      precos: PRECOS_PADRAO,
      agora: () => AGORA,
      aleatorio: aleatorioComSemente(42),
    };
  }

  async function criarAutomacao(config: unknown = configTeste(), extra: { ativa?: boolean; cron?: string } = {}) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO automacoes (workspace_id, nome, receita, config, ativa, ativada_em, agenda_cron)
       VALUES ($1, 'Disparo', 'disparo_recorrente_ia', $2, $3, $4, $5) RETURNING id`,
      [workspaceId, config, extra.ativa ?? true, extra.ativa === false ? null : new Date('2026-01-01'), extra.cron ?? null],
    );
    return rows[0]!.id;
  }

  async function rodar(automacaoId: string, tipo: 'manual' | 'previa' | 'agendada', llm: LLMFalso) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO execucoes (automacao_id, tipo, status) VALUES ($1, $2, 'preparando') RETURNING id`,
      [automacaoId, tipo],
    );
    await executar(rows[0]!.id, deps(llm));
    return carregar(rows[0]!.id);
  }

  async function carregar(execucaoId: string) {
    const { rows: [execucao] } = await db.query('SELECT * FROM execucoes WHERE id = $1', [execucaoId]);
    const { rows: mensagens } = await db.query('SELECT * FROM mensagens WHERE execucao_id = $1 ORDER BY linha', [execucaoId]);
    return { execucao, mensagens, por: (nome: string) => mensagens.find((m: any) => m.nome === nome) };
  }

  it('processa a planilha de ponta a ponta no modo sombra', async () => {
    const llm = new LLMFalso();
    const r = await rodar(await criarAutomacao(), 'manual', llm);

    expect(r.execucao.status).toBe('concluida');
    expect(r.execucao.funil.etapas).toEqual([
      { rotulo: 'lidos da planilha', ativos: 7 },
      { rotulo: 'com número válido', ativos: 5 },
      { rotulo: 'sem números repetidos', ativos: 4 },
      { rotulo: 'com produto da semana nas preferências', ativos: 3 },
      { rotulo: 'não recebeu nesta semana', ativos: 3 },
    ]);
    expect(r.execucao.funil.status).toEqual({ pulada: 4, simulada: 3 });
    expect(r.execucao.funil.motivos).toEqual({
      sem_telefone: 1,
      telefone_invalido: 1,
      duplicado: 1,
      'sem produto da semana nas preferências': 1,
    });

    expect(r.por('Carla Dias')).toMatchObject({ status: 'pulada', motivo: 'sem número na planilha' });
    expect(r.por('Diego Reis')).toMatchObject({ status: 'pulada', motivo: 'número repetido (mesmo da linha 2)' });

    const ana = r.por('Ana Souza');
    expect(ana).toMatchObject({ status: 'simulada', telefone: '5531912345678', chave_idempotencia: expect.stringContaining(':2026-W40:5531912345678') });
    expect(ana.entrada.apelido).toBe('Aninha');
    expect(ana.entrada.produtos_match).toEqual(['Bombom de morango', 'Bolo de Cenoura']);
    expect(ana.texto).toMatch(/^(Oi|Ei|Oieee) Aninha! Bom dia! Tudo bem\? 😊/);
    expect(r.por('Bruno Lima')).toMatchObject({ status: 'simulada', telefone: '5531998765432' });
    expect(r.por('Fábio Nunes').telefone).toBe('5521966661111');

    // Horários previstos: dentro da janela e com intervalo mínimo entre eles
    const horarios = r.mensagens.filter((m: any) => m.agendada_para).map((m: any) => m.agendada_para.getTime()).sort();
    expect(horarios).toHaveLength(3);
    for (let i = 1; i < horarios.length; i++) expect(horarios[i] - horarios[i - 1]).toBeGreaterThanOrEqual(40_000);

    // Custo: 3 chamadas × (1000 entrada × $2 + 100 saída × $8) / 1M
    expect(llm.pedidos).toHaveLength(3);
    expect(Number(r.execucao.custo_usd)).toBeCloseTo(3 * 0.0028, 6);
    expect(r.execucao.tokens_entrada).toBe(3000);
    expect(llm.pedidos[0]!.mensagens[0]!.conteudo).toBe('Você é uma confeitaria de teste. Hoje é quarta-feira.');
  });

  it('não reenvia no mesmo período e não paga a IA de novo', async () => {
    const automacao = await criarAutomacao();
    await rodar(automacao, 'manual', new LLMFalso());
    const llm = new LLMFalso();
    const r = await rodar(automacao, 'manual', llm);
    expect(llm.pedidos).toHaveLength(0);
    expect(r.execucao.funil.motivos.ja_processado).toBe(3);
    expect(r.por('Ana Souza')).toMatchObject({ status: 'pulada', motivo: 'já recebeu neste período' });
  });

  it('prévia não consome o período e respeita o limite', async () => {
    const automacao = await criarAutomacao(configTeste({ previaLimite: 2 }));
    const previa = await rodar(automacao, 'previa', new LLMFalso());
    expect(previa.execucao.funil.status.gerada).toBe(2);
    expect(previa.execucao.funil.previaLimitada).toBe(2);
    expect(previa.mensagens.every((m: any) => m.chave_idempotencia === null)).toBe(true);

    const real = await rodar(automacao, 'manual', new LLMFalso());
    expect(real.execucao.funil.status.simulada).toBe(3);
  });

  it('pede correção à IA quando a validação reprova', async () => {
    const llm = new LLMFalso((pedido, n) => {
      const ultima = pedido.mensagens.at(-1)!.conteudo;
      if (ultima.startsWith('Essa mensagem não pode ser enviada')) {
        return 'Oieee Aninha! Bom dia! Tudo bem? 😊\n\nTemos bombom de morango!\n\n💚';
      }
      return 'Oieee Aninha — 😊😍🥰 temos torta de limão';
    });
    const config = configTeste();
    (config.composicao.variacoes as any).cumprimento.opcoes = ['Oieee {{apelido}}! {{saudacao}} Tudo bem?'];
    const r = await rodar(await criarAutomacao(config), 'manual', llm);

    const ana = r.por('Ana Souza');
    expect(ana.status).toBe('simulada');
    expect(ana.tentativas).toHaveLength(2);
    expect(ana.tentativas[0].problemas).toEqual([
      'usa 3 emojis (máximo 2)',
      'contém "—", que é proibido',
      'não começa com "Oieee Aninha! Bom dia! Tudo bem?"',
      'menciona item fora da lista permitida: torta de limao',
    ]);
    // Bruno só pode falar de torta de limão, então a correção (que cita bombom) também reprova
    expect(r.por('Bruno Lima')).toMatchObject({ status: 'precisa_revisao', motivo: expect.stringContaining('bombom de morango') });
    expect(r.execucao.tokens_entrada).toBe(6000);
  });

  it('quem precisou de revisão é tentado de novo numa nova execução do período', async () => {
    const automacao = await criarAutomacao();
    await rodar(automacao, 'manual', new LLMFalso('Oi — texto ruim'));
    const llm = new LLMFalso();
    const r = await rodar(automacao, 'manual', llm);
    expect(llm.pedidos).toHaveLength(3);
    expect(r.execucao.funil.status.simulada).toBe(3);
  });

  it('respeita o liga/desliga da planilha', async () => {
    planilhas.dados = dadosPlanilha('OFF');
    const llm = new LLMFalso();
    const r = await rodar(await criarAutomacao(), 'manual', llm);
    expect(r.execucao).toMatchObject({ status: 'abortada', motivo: expect.stringContaining('não está "ON"') });
    expect(r.mensagens).toHaveLength(0);
    expect(llm.pedidos).toHaveLength(0);
  });

  it('prévia ignora o liga/desliga (é teste)', async () => {
    planilhas.dados = dadosPlanilha('OFF');
    const r = await rodar(await criarAutomacao(), 'previa', new LLMFalso());
    expect(r.execucao.status).toBe('concluida');
  });

  it('aborta com mensagem clara se a planilha mudou', async () => {
    const dados = dadosPlanilha();
    dados['planilha-teste'].Clientes[0] = ['', 'Nome', 'Telefone', 'Preferências', 'Observação'];
    planilhas.dados = dados;
    const r = await rodar(await criarAutomacao(), 'manual', new LLMFalso());
    expect(r.execucao).toMatchObject({ status: 'abortada', motivo: expect.stringContaining('"Número"') });
  });

  it('aborta de uma vez se a chave da IA é inválida', async () => {
    const llm = new LLMFalso(new ErroLLMDefinitivo('Chave da OpenAI inválida ou revogada.'));
    const r = await rodar(await criarAutomacao(), 'manual', llm);
    expect(r.execucao).toMatchObject({ status: 'abortada', motivo: 'IA: Chave da OpenAI inválida ou revogada.' });
    expect(llm.pedidos.length).toBeLessThanOrEqual(3);
  });

  it('erro temporário da IA marca só aquele contato', async () => {
    const llm = new LLMFalso((p, n) => (n === 1 ? new Error('timeout') : 'Oi'));
    const config = configTeste({ composicao: { ...configTeste().composicao, paralelismo: 1, variacoes: {} } });
    const r = await rodar(await criarAutomacao(config), 'manual', llm);
    expect(r.por('Ana Souza')).toMatchObject({ status: 'falhou', motivo: 'falha na IA: timeout' });
    expect(r.execucao.status).toBe('concluida');
  });

  it('varia o cumprimento em relação ao histórico importado do n8n', async () => {
    await db.query(
      `INSERT INTO mensagens (workspace_id, origem, telefone, status, texto, criado_em) VALUES
         ($1, 'importada_n8n', '5531912345678', 'enviada', 'Ei Aninha! Bom dia! Tudo bem? 😊 ...', now() - interval '14 days'),
         ($1, 'importada_n8n', '5531912345678', 'enviada', 'Oi Aninha! Bom dia! Tudo bem? 🥰 ...', now() - interval '7 days')`,
      [workspaceId],
    );
    const llm = new LLMFalso();
    const r = await rodar(await criarAutomacao(), 'manual', llm);
    const ana = r.por('Ana Souza');
    expect(ana.texto.startsWith('Oieee Aninha!')).toBe(true);
    const pedido = llm.pedidos.find((p) => p.mensagens[1]!.conteudo.includes('Cliente: Aninha'))!;
    expect(pedido.mensagens[1]!.conteudo).toContain('Mensagem anterior 1 (mais recente):\nOi Aninha!');
  });

  it('retoma sem refazer o que já foi gerado', async () => {
    const automacao = await criarAutomacao();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO execucoes (automacao_id, tipo, status, periodo) VALUES ($1, 'manual', 'preparando', '2026-W40') RETURNING id`,
      [automacao],
    );
    const id = rows[0]!.id;
    await db.query(
      `INSERT INTO mensagens (workspace_id, automacao_id, execucao_id, linha, nome, telefone, status, texto, chave_idempotencia, agendada_para)
       VALUES ($1, $2, $3, 2, 'Ana Souza', '5531912345678', 'gerada', 'Oi Aninha!', $4, $5)`,
      [workspaceId, automacao, id, `${automacao}:2026-W40:5531912345678`, AGORA],
    );
    const llm = new LLMFalso();
    await executar(id, deps(llm));
    const r = await carregar(id);
    expect(llm.pedidos).toHaveLength(2);
    expect(r.execucao.funil.status.simulada).toBe(3);
    const planejados = r.mensagens.filter((m: any) => m.agendada_para && m.nome !== 'Ana Souza');
    for (const m of planejados) expect(m.agendada_para.getTime()).toBeGreaterThan(AGORA.getTime());
  });

  it('execução agendada de automação pausada é abortada', async () => {
    const r = await rodar(await criarAutomacao(configTeste(), { ativa: false }), 'agendada', new LLMFalso());
    expect(r.execucao).toMatchObject({ status: 'abortada', motivo: 'A automação está pausada.' });
  });

  describe('fila e agenda', () => {
    it('reivindica a mais antiga e recupera travadas', async () => {
      const automacao = await criarAutomacao();
      await db.query(`INSERT INTO execucoes (automacao_id, tipo) VALUES ($1, 'manual'), ($1, 'manual')`, [automacao]);
      const a = await reivindicar(db);
      const b = await reivindicar(db);
      expect(a && b && a !== b).toBeTruthy();
      expect(await reivindicar(db)).toBeNull();

      await db.query(`UPDATE execucoes SET heartbeat_em = now() - interval '10 minutes' WHERE id = $1`, [a]);
      expect(await recuperarTravadas(db, 5, 3)).toBe(1);
      expect(await reivindicar(db)).toBe(a);

      await db.query(`UPDATE execucoes SET heartbeat_em = now() - interval '10 minutes', tentativas = 3 WHERE id = $1`, [a]);
      await recuperarTravadas(db, 5, 3);
      const { rows } = await db.query('SELECT status FROM execucoes WHERE id = $1', [a]);
      expect(rows[0].status).toBe('falhou');
    });

    it('cria a execução agendada uma única vez, com o período certo', async () => {
      const automacao = await criarAutomacao(configTeste(), { cron: '0 10 * * 3' });
      const depois = new Date(AGORA.getTime() + 60_000);
      expect(await cicloAgenda(db, depois)).toBe(1);
      expect(await cicloAgenda(db, depois)).toBe(0);
      const { rows } = await db.query('SELECT tipo, agendada_para, periodo FROM execucoes WHERE automacao_id = $1', [automacao]);
      expect(rows).toEqual([{ tipo: 'agendada', agendada_para: AGORA, periodo: '2026-W40' }]);
    });

    it('não dispara horário antigo nem anterior à ativação', async () => {
      await criarAutomacao(configTeste(), { cron: '0 10 * * 3' });
      // 8 horas depois: fora da tolerância de 6h
      expect(await cicloAgenda(db, new Date(AGORA.getTime() + 8 * 3_600_000))).toBe(0);
      await db.query(`UPDATE automacoes SET ativada_em = $1`, [new Date(AGORA.getTime() + 60_000)]);
      expect(await cicloAgenda(db, new Date(AGORA.getTime() + 120_000))).toBe(0);
    });

    it('ignora automações pausadas', async () => {
      await criarAutomacao(configTeste(), { cron: '0 10 * * 3', ativa: false });
      expect(await cicloAgenda(db, new Date(AGORA.getTime() + 60_000))).toBe(0);
    });
  });
});
