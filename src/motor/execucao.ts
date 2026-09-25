import type { CanalWhatsApp } from '../conectores/canal.js';
import { ErroLLMDefinitivo, type ProvedorLLM, type TabelaPrecos } from '../conectores/llm.js';
import { ErroPlanilha, registrosPorCabecalho, type LeitorPlanilhas, type Registro } from '../conectores/planilhas.js';
import type { Db } from '../db/pool.js';
import { emParalelo, type Aleatorio } from '../lib/aleatorio.js';
import { decifrar } from '../lib/cripto.js';
import { normalizarTelefone } from '../lib/telefone.js';
import {
  chavePeriodo,
  formatarData,
  nomeDiaSemana,
  partesNoFuso,
  planejarHorarios,
  saudacao,
} from '../lib/tempo.js';
import { dividirLista, normalizar } from '../lib/texto.js';
import { comporMensagem, type ResultadoComposicao } from './composicao.js';
import { ErroConfig, lerConfig, type AutomacaoConfig } from './config.js';
import { aplicarEtapa, rotuloEtapa } from './etapas.js';
import { ativos, pular, type Item } from './itens.js';
import { escolherVariacoes, type MensagemAnterior } from './variacoes.js';

export interface Dependencias {
  db: Db;
  planilhas: LeitorPlanilhas;
  criarLLM: (chave: string) => ProvedorLLM;
  canais: Record<string, CanalWhatsApp>;
  /** APP_SECRET, para abrir a chave de IA do workspace */
  segredo: string;
  precos: TabelaPrecos;
  agora?: () => Date;
  aleatorio?: Aleatorio;
  log?: (mensagem: string) => void;
}

/** Interrompe a execução sem ser um erro do sistema (guarda desligada, planilha quebrada, chave inválida…). */
export class ExecucaoAbortada extends Error {}

interface Contexto {
  id: string;
  tipo: 'agendada' | 'manual' | 'previa';
  agendada_para: Date | null;
  periodo: string | null;
  automacao_id: string;
  ativa: boolean;
  modo_envio: 'sombra' | 'real';
  config: unknown;
  workspace_id: string;
  fuso: string;
  llm_chave_cifrada: string | null;
}

export interface EtapaFunil {
  rotulo: string;
  ativos: number;
}

export interface Funil {
  etapas: EtapaFunil[];
  total: number;
  status: Record<string, number>;
  motivos: Record<string, number>;
  previaLimitada?: number;
}

export async function executar(execucaoId: string, deps: Dependencias): Promise<void> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const { rows } = await db.query<Contexto>(
    `SELECT e.id, e.tipo, e.agendada_para, e.periodo, e.automacao_id,
            a.ativa, a.modo_envio, a.config, a.workspace_id, w.fuso, w.llm_chave_cifrada
       FROM execucoes e
       JOIN automacoes a ON a.id = e.automacao_id
       JOIN workspaces w ON w.id = a.workspace_id
      WHERE e.id = $1`,
    [execucaoId],
  );
  const ctx = rows[0];
  if (!ctx) throw new Error(`Execução ${execucaoId} não encontrada`);

  const batimento = setInterval(() => {
    db.query('UPDATE execucoes SET heartbeat_em = now() WHERE id = $1', [execucaoId]).catch(() => {});
  }, 20_000);

  try {
    const etapas = await processar(ctx, deps);
    const funil = await montarFunil(db, execucaoId, etapas.etapas, etapas.previaLimitada);
    await db.query(
      `UPDATE execucoes SET status = 'concluida', finalizada_em = now(), funil = $2, motivo = NULL WHERE id = $1`,
      [execucaoId, funil],
    );
    log(`execução ${execucaoId} concluída`);
  } catch (e) {
    const abortada = e instanceof ExecucaoAbortada || e instanceof ErroPlanilha || e instanceof ErroConfig;
    const motivo = e instanceof ErroLLMDefinitivo ? `IA: ${e.message}` : (e as Error).message;
    const funil = await montarFunil(db, execucaoId, [], undefined).catch(() => ({}));
    await db.query(
      `UPDATE execucoes SET status = $2, finalizada_em = now(), motivo = $3, funil = $4 WHERE id = $1`,
      [execucaoId, abortada || e instanceof ErroLLMDefinitivo ? 'abortada' : 'falhou', motivo, funil],
    );
    log(`execução ${execucaoId} ${abortada ? 'abortada' : 'falhou'}: ${motivo}`);
    if (!abortada && !(e instanceof ErroLLMDefinitivo)) throw e;
  } finally {
    clearInterval(batimento);
  }
}

async function lerFontes(config: AutomacaoConfig, planilhas: LeitorPlanilhas): Promise<Record<string, Registro[]>> {
  const cache = new Map<string, Promise<string[][]>>();
  const ler = (planilha: string, aba: string) => {
    const chave = `${planilha}\u0000${aba}`;
    if (!cache.has(chave)) cache.set(chave, planilhas.lerAba(planilha, aba));
    return cache.get(chave)!;
  };
  const fontes: Record<string, Registro[]> = {};
  for (const [nome, fonte] of Object.entries(config.fontes)) {
    fontes[nome] = registrosPorCabecalho(await ler(fonte.planilha, fonte.aba), fonte.colunas, fonte.aba);
  }
  return fontes;
}

async function verificarChavePlanilha(config: AutomacaoConfig, planilhas: LeitorPlanilhas): Promise<void> {
  const chave = config.guardas.chavePlanilha;
  if (!chave) return;
  const registros = registrosPorCabecalho(await planilhas.lerAba(chave.planilha, chave.aba), { valor: chave.coluna }, chave.aba);
  const ligada = registros.some((r) => normalizar(r.campos.valor ?? '') === normalizar(chave.valor));
  if (!ligada) {
    throw new ExecucaoAbortada(
      `Desligada pela planilha: a coluna "${chave.coluna}" da aba "${chave.aba}" não está "${chave.valor}".`,
    );
  }
}

async function processar(ctx: Contexto, deps: Dependencias): Promise<{ etapas: EtapaFunil[]; previaLimitada?: number }> {
  const { db } = deps;
  const agora = deps.agora ?? (() => new Date());
  const aleatorio = deps.aleatorio ?? Math.random;
  const previa = ctx.tipo === 'previa';
  const config = lerConfig(ctx.config);

  // ---- Guardas
  if (ctx.tipo === 'agendada' && !ctx.ativa) throw new ExecucaoAbortada('A automação está pausada.');
  if (ctx.modo_envio === 'real' && !previa) {
    throw new ExecucaoAbortada('Envio real ainda não está disponível nesta versão (F1b). Use o modo sombra.');
  }
  if (!ctx.llm_chave_cifrada) throw new ExecucaoAbortada('O workspace não tem chave de IA cadastrada.');
  let chaveLLM: string;
  try {
    chaveLLM = decifrar(ctx.llm_chave_cifrada, deps.segredo);
  } catch {
    throw new ExecucaoAbortada('Não foi possível abrir a chave de IA (APP_SECRET mudou?). Cadastre a chave de novo.');
  }
  if (!previa) await verificarChavePlanilha(config, deps.planilhas);

  // ---- Leitura
  const fontes = await lerFontes(config, deps.planilhas);
  const itens: Item[] = (fontes[config.contatos] ?? []).map((r) => ({
    linha: r.linha,
    nome: r.campos.nome ?? '',
    telefone: null,
    campos: { ...r.campos },
    ativo: true,
  }));
  const etapas: EtapaFunil[] = [{ rotulo: 'lidos da planilha', ativos: itens.length }];
  const marcar = (rotulo: string) => etapas.push({ rotulo, ativos: ativos(itens).length });

  // ---- Limpeza embutida: telefone, repetidos, opt-out
  for (const item of itens) {
    const r = normalizarTelefone(String(item.campos.telefone ?? ''));
    if (r.valido) item.telefone = r.numero;
    else pular(item, r.motivo);
  }
  marcar('com número válido');

  const primeiraLinha = new Map<string, number>();
  for (const item of ativos(itens)) {
    const anterior = primeiraLinha.get(item.telefone!);
    if (anterior !== undefined) pular(item, 'duplicado', `número repetido (mesmo da linha ${anterior})`);
    else primeiraLinha.set(item.telefone!, item.linha);
  }
  marcar('sem números repetidos');

  const telefones = ativos(itens).map((i) => i.telefone!);
  if (telefones.length > 0) {
    const { rows } = await db.query<{ telefone: string }>(
      'SELECT telefone FROM opt_outs WHERE workspace_id = $1 AND telefone = ANY($2)',
      [ctx.workspace_id, telefones],
    );
    const bloqueados = new Set(rows.map((r) => r.telefone));
    for (const item of ativos(itens)) if (bloqueados.has(item.telefone!)) pular(item, 'opt_out');
    if (rows.length > 0) marcar('sem opt-out');
  }

  // ---- Etapas configuradas
  for (const etapa of config.etapas) {
    aplicarEtapa(itens, etapa, fontes);
    // Só filtros tiram contatos da fila; as outras etapas só enriquecem os dados
    if (etapa.tipo === 'filtrar') marcar(rotuloEtapa(etapa));
  }

  // ---- Idempotência
  const periodo = ctx.periodo ?? chavePeriodo(ctx.agendada_para ?? agora(), ctx.fuso, config.periodo);
  const chaveDe = (item: Item) => `${ctx.automacao_id}:${periodo}:${item.telefone}`;
  if (!previa) {
    const candidatos = ativos(itens);
    if (candidatos.length > 0) {
      const { rows } = await db.query<{ chave_idempotencia: string }>(
        `SELECT chave_idempotencia FROM mensagens
          WHERE chave_idempotencia = ANY($1)
            AND status IN ('gerada', 'agendada', 'simulada', 'enviada')
            AND execucao_id IS DISTINCT FROM $2`,
        [candidatos.map(chaveDe), ctx.id],
      );
      const feitas = new Set(rows.map((r) => r.chave_idempotencia));
      for (const item of candidatos) if (feitas.has(chaveDe(item))) pular(item, 'ja_processado');
    }
    marcar(`não recebeu ${{ dia: 'hoje', semana: 'nesta semana', mes: 'neste mês' }[config.periodo]}`);
  }

  // ---- Prévia processa só os primeiros contatos
  let previaLimitada: number | undefined;
  if (previa) {
    const excedentes = ativos(itens).slice(config.previaLimite);
    if (excedentes.length > 0) previaLimitada = config.previaLimite;
    for (const item of excedentes) item.ativo = false;
  }

  // ---- Retomada: o que esta execução já gravou não é refeito
  const { rows: gravadas } = await db.query<{ linha: number; agendada_para: Date | null }>(
    'SELECT linha, agendada_para FROM mensagens WHERE execucao_id = $1',
    [ctx.id],
  );
  const linhasGravadas = new Set(gravadas.map((g) => g.linha));

  const puladas = itens.filter((i) => !i.ativo && i.motivoCodigo && !linhasGravadas.has(i.linha));
  for (const item of puladas) {
    await inserirMensagem(db, ctx, {
      linha: item.linha,
      nome: item.nome,
      telefone: item.telefone,
      status: 'pulada',
      motivo_codigo: item.motivoCodigo!,
      motivo: item.motivo!,
      entrada: item.campos,
    });
  }

  const aCompor = ativos(itens).filter((i) => !linhasGravadas.has(i.linha));
  if (aCompor.length === 0) return { etapas, previaLimitada };

  // ---- Planejamento dos horários (a saudação usa o horário previsto de envio)
  const ultimoPlanejado = gravadas.reduce<number>((m, g) => Math.max(m, g.agendada_para?.getTime() ?? 0), 0);
  const inicio = new Date(Math.max(agora().getTime(), ultimoPlanejado + config.envio.intervaloSeg[0] * 1000));
  const horarios = planejarHorarios(inicio, aCompor.length, config.envio, ctx.fuso, aleatorio);

  // ---- Composição
  const llm = deps.criarLLM(chaveLLM);
  const referencia = agora();
  const globais = { data: formatarData(referencia, ctx.fuso), dia_semana: nomeDiaSemana(referencia, ctx.fuso) };
  const universo = (config.validacao.somenteItensDe?.universo ?? []).flatMap((u) =>
    (fontes[u.fonte] ?? []).flatMap((r) => {
      const v = r.campos[u.campo] ?? '';
      return u.lista ? dividirLista(v) : v.trim() ? [v.trim()] : [];
    }),
  );
  const precisaHistorico = config.composicao.historico > 0 || config.validacao.diferenteDaUltima;
  const qtdHistorico = Math.max(config.composicao.historico, config.validacao.diferenteDaUltima ? 1 : 0);

  let cancelar = false;
  await emParalelo(aCompor, config.composicao.paralelismo, async (item, i) => {
    if (cancelar) return;
    const horario = horarios[i]!;
    const historico = precisaHistorico ? await buscarHistorico(db, ctx.workspace_id, item.telefone!, qtdHistorico) : [];
    const p = partesNoFuso(horario, ctx.fuso);
    const vars: Record<string, unknown> = {
      ...item.campos,
      nome: item.nome,
      telefone: item.telefone,
      saudacao: saudacao(horario, ctx.fuso),
      hora: `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`,
      ...globais,
    };
    const variacao = escolherVariacoes(config.composicao.variacoes, historico, vars, aleatorio);
    const permitidosCampo = config.validacao.somenteItensDe?.permitidos;
    let resultado: ResultadoComposicao;
    try {
      resultado = await comporMensagem({
        llm,
        config: config.composicao,
        regras: config.validacao,
        vars,
        globais,
        historico: historico.slice(0, config.composicao.historico),
        variacao,
        contextoValidacao: permitidosCampo
          ? { universo, permitidos: (item.campos[permitidosCampo] as string[] | undefined) ?? [] }
          : {},
        precos: deps.precos,
      });
    } catch (e) {
      cancelar = true;
      throw e;
    }

    await inserirMensagem(db, ctx, {
      linha: item.linha,
      nome: item.nome,
      telefone: item.telefone,
      status: resultado.status,
      motivo_codigo: resultado.status === 'gerada' ? null : resultado.status === 'falhou' ? 'erro_ia' : 'validacao',
      motivo: resultado.motivo ?? null,
      texto: resultado.texto,
      entrada: vars,
      variacao,
      tentativas: resultado.tentativas,
      versao_prompt: config.composicao.versao,
      modelo: resultado.modelo,
      tokens_entrada: resultado.tokensEntrada,
      tokens_saida: resultado.tokensSaida,
      custo_usd: resultado.custo,
      chave_idempotencia: previa ? null : chaveDe(item),
      agendada_para: horario,
    });
    await db.query(
      `UPDATE execucoes
          SET tokens_entrada = tokens_entrada + $2, tokens_saida = tokens_saida + $3,
              custo_usd = custo_usd + $4, heartbeat_em = now()
        WHERE id = $1`,
      [ctx.id, resultado.tokensEntrada, resultado.tokensSaida, resultado.custo ?? 0],
    );
  });

  // ---- Disparo (modo sombra: nada sai, só registra)
  if (!previa) {
    await db.query(`UPDATE execucoes SET status = 'disparando', heartbeat_em = now() WHERE id = $1`, [ctx.id]);
    await db.query(`UPDATE mensagens SET status = 'simulada' WHERE execucao_id = $1 AND status = 'gerada'`, [ctx.id]);
  }
  return { etapas, previaLimitada };
}

async function buscarHistorico(db: Db, workspaceId: string, telefone: string, limite: number): Promise<MensagemAnterior[]> {
  const { rows } = await db.query<{ texto: string; variacao: { indices?: Record<string, number> } | null }>(
    `SELECT texto, variacao FROM mensagens
      WHERE workspace_id = $1 AND telefone = $2 AND status = 'enviada' AND texto IS NOT NULL
      ORDER BY coalesce(enviada_em, criado_em) DESC
      LIMIT $3`,
    [workspaceId, telefone, limite],
  );
  return rows.map((r) => ({ texto: r.texto, variacao: r.variacao?.indices ?? null }));
}

interface NovaMensagem {
  linha: number;
  nome: string;
  telefone: string | null;
  status: string;
  motivo_codigo?: string | null;
  motivo?: string | null;
  texto?: string | null;
  entrada?: unknown;
  variacao?: unknown;
  tentativas?: unknown;
  versao_prompt?: string;
  modelo?: string;
  tokens_entrada?: number;
  tokens_saida?: number;
  custo_usd?: number | null;
  chave_idempotencia?: string | null;
  agendada_para?: Date;
}

async function inserirMensagem(db: Db, ctx: Contexto, m: NovaMensagem): Promise<void> {
  const colunas = [
    'workspace_id', 'automacao_id', 'execucao_id', 'linha', 'nome', 'telefone', 'status', 'motivo_codigo', 'motivo',
    'texto', 'entrada', 'variacao', 'tentativas', 'versao_prompt', 'modelo', 'tokens_entrada', 'tokens_saida',
    'custo_usd', 'chave_idempotencia', 'agendada_para',
  ];
  const valores = [
    ctx.workspace_id, ctx.automacao_id, ctx.id, m.linha, m.nome, m.telefone, m.status, m.motivo_codigo ?? null,
    m.motivo ?? null, m.texto ?? null, m.entrada === undefined ? null : JSON.stringify(m.entrada),
    m.variacao === undefined ? null : JSON.stringify(m.variacao),
    m.tentativas === undefined ? null : JSON.stringify(m.tentativas), m.versao_prompt ?? null, m.modelo ?? null,
    m.tokens_entrada ?? 0, m.tokens_saida ?? 0, m.custo_usd ?? null, m.chave_idempotencia ?? null,
    m.agendada_para ?? null,
  ];
  const marcadores = valores.map((_, i) => `$${i + 1}`).join(', ');
  const { rowCount } = await db.query(
    `INSERT INTO mensagens (${colunas.join(', ')}) VALUES (${marcadores})
     ON CONFLICT (chave_idempotencia) WHERE status IN ('gerada', 'agendada', 'simulada', 'enviada') DO NOTHING`,
    valores,
  );
  if (rowCount === 0) {
    // Outra execução do mesmo período chegou primeiro neste contato
    await inserirMensagem(db, ctx, {
      ...m,
      status: 'pulada',
      motivo_codigo: 'ja_processado',
      motivo: 'já recebeu neste período',
      chave_idempotencia: null,
    });
  }
}

export async function montarFunil(
  db: Db,
  execucaoId: string,
  etapas: EtapaFunil[],
  previaLimitada: number | undefined,
): Promise<Funil> {
  const { rows } = await db.query<{ status: string; motivo_codigo: string | null; motivo: string | null; n: number }>(
    `SELECT status, motivo_codigo, CASE WHEN motivo_codigo = 'filtro' THEN motivo END AS motivo, count(*)::int AS n
       FROM mensagens WHERE execucao_id = $1
      GROUP BY 1, 2, 3`,
    [execucaoId],
  );
  const funil: Funil = { etapas, total: 0, status: {}, motivos: {} };
  if (previaLimitada) funil.previaLimitada = previaLimitada;
  for (const r of rows) {
    funil.total += r.n;
    funil.status[r.status] = (funil.status[r.status] ?? 0) + r.n;
    if (r.status === 'pulada' && r.motivo_codigo) {
      const chave = r.motivo_codigo === 'filtro' && r.motivo ? r.motivo : r.motivo_codigo;
      funil.motivos[chave] = (funil.motivos[chave] ?? 0) + r.n;
    }
  }
  return funil;
}
