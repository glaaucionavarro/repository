import { Cron } from 'croner';
import type { Db } from '../db/pool.js';
import { chavePeriodo, type TipoPeriodo } from '../lib/tempo.js';

/** Valida uma expressão cron e devolve o próximo horário, ou lança erro legível. */
export function proximoHorario(expressao: string, fuso: string, depoisDe = new Date()): Date | null {
  let cron: Cron;
  try {
    cron = new Cron(expressao, { timezone: fuso, paused: true });
  } catch (e) {
    throw new Error(`Agenda inválida "${expressao}": ${(e as Error).message}`);
  }
  return cron.nextRun(depoisDe);
}

/**
 * Cria as execuções agendadas que venceram. Se o servidor ficou fora do ar,
 * recupera só o horário mais recente dentro da tolerância, nunca uma rajada de atrasados.
 */
export async function cicloAgenda(
  db: Db,
  agora = new Date(),
  toleranciaHoras = 6,
  log: (m: string) => void = () => {},
): Promise<number> {
  const { rows } = await db.query<{
    id: string;
    agenda_cron: string;
    ativada_em: Date | null;
    periodo: TipoPeriodo | null;
    fuso: string;
  }>(
    `SELECT a.id, a.agenda_cron, a.ativada_em, a.config->>'periodo' AS periodo, w.fuso
       FROM automacoes a JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.ativa AND a.agenda_cron IS NOT NULL`,
  );
  let criadas = 0;
  for (const a of rows) {
    let ultima: Date | undefined;
    try {
      ultima = new Cron(a.agenda_cron, { timezone: a.fuso, paused: true }).previousRuns(1, agora)[0];
    } catch (e) {
      log(`agenda inválida na automação ${a.id}: ${(e as Error).message}`);
      continue;
    }
    if (!ultima) continue;
    const limite = Math.max(agora.getTime() - toleranciaHoras * 3_600_000, a.ativada_em?.getTime() ?? 0);
    if (ultima.getTime() < limite) continue;
    const { rowCount } = await db.query(
      `INSERT INTO execucoes (automacao_id, tipo, agendada_para, periodo)
       VALUES ($1, 'agendada', $2, $3)
       ON CONFLICT (automacao_id, agendada_para) WHERE tipo = 'agendada' DO NOTHING`,
      [a.id, ultima, chavePeriodo(ultima, a.fuso, a.periodo ?? 'semana')],
    );
    if (rowCount) {
      criadas++;
      log(`execução agendada criada para a automação ${a.id} (${ultima.toISOString()})`);
    }
  }
  return criadas;
}

export class Agenda {
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: (m: string) => void = () => {},
    private readonly intervaloMs = 30_000,
  ) {}

  iniciar(): void {
    const ciclo = () =>
      cicloAgenda(this.db, new Date(), 6, this.log).catch((e) => this.log(`erro na agenda: ${(e as Error).message}`));
    void ciclo();
    this.temporizador = setInterval(ciclo, this.intervaloMs);
  }

  parar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "0 10 * * 3" → "quarta às 10:00". Devolve a própria expressão se não for do formato simples. */
export function descreverCron(expressao: string | null): string {
  if (!expressao) return 'sem agenda';
  const m = /^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+)$/.exec(expressao.trim());
  if (!m) return expressao;
  const dias = m[3]!.split(',').map((d) => DIAS[Number(d) % 7]);
  const hora = `${m[2]!.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`;
  return `${dias.join(', ')} às ${hora}`;
}

export function montarCron(dias: number[], hora: string): string {
  const [h, m] = hora.split(':').map(Number);
  return `${m} ${h} * * ${[...new Set(dias)].sort().join(',')}`;
}

export function lerCronSimples(expressao: string | null): { dias: number[]; hora: string } | null {
  const m = expressao ? /^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+)$/.exec(expressao.trim()) : null;
  if (!m) return null;
  return {
    dias: m[3]!.split(',').map((d) => Number(d) % 7),
    hora: `${m[2]!.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`,
  };
}
