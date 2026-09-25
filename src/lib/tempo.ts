export interface PartesData {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 0 = domingo … 6 = sábado */
  diaSemana: number;
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ABREV_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

export function partesNoFuso(data: Date, fuso: string): PartesData {
  const partes: Record<string, string> = {};
  for (const p of formatador(fuso).formatToParts(data)) partes[p.type] = p.value;
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    diaSemana: ABREV_SEMANA[partes.weekday!] ?? 0,
  };
}

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Cria o instante correspondente a uma data/hora "de parede" no fuso informado. */
export function dataNoFuso(ano: number, mes: number, dia: number, hora: number, minuto: number, fuso: string): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let palpite = alvo;
  // Duas iterações resolvem o deslocamento, inclusive perto de mudança de horário
  for (let i = 0; i < 2; i++) {
    const p = partesNoFuso(new Date(palpite), fuso);
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
    palpite += alvo - visto;
  }
  return new Date(palpite);
}

/** "Bom dia!", "Boa tarde!", "Boa noite!" ou vazio de madrugada. */
export function saudacao(data: Date, fuso: string): string {
  const { hora } = partesNoFuso(data, fuso);
  if (hora >= 6 && hora < 12) return 'Bom dia!';
  if (hora >= 12 && hora < 18) return 'Boa tarde!';
  if (hora >= 18) return 'Boa noite!';
  return '';
}

export function nomeDiaSemana(data: Date, fuso: string): string {
  return DIAS_SEMANA[partesNoFuso(data, fuso).diaSemana]!;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

export function formatarDataHora(data: Date | string | null | undefined, fuso: string): string {
  if (!data) return '—';
  const p = partesNoFuso(new Date(data), fuso);
  return `${doisDigitos(p.dia)}/${doisDigitos(p.mes)}/${p.ano} ${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`;
}

export function formatarData(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  return `${doisDigitos(p.dia)}/${doisDigitos(p.mes)}`;
}

export type TipoPeriodo = 'dia' | 'semana' | 'mes';

/** Chave do período de idempotência: 2026-09-30, 2026-W40 ou 2026-09. */
export function chavePeriodo(data: Date, fuso: string, tipo: TipoPeriodo): string {
  const p = partesNoFuso(data, fuso);
  if (tipo === 'dia') return `${p.ano}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)}`;
  if (tipo === 'mes') return `${p.ano}-${doisDigitos(p.mes)}`;
  // Semana ISO 8601 calculada sobre a data local
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia));
  const diaIso = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaIso);
  const inicioAno = Date.UTC(d.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((d.getTime() - inicioAno) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${doisDigitos(semana)}`;
}

function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export interface JanelaEnvio {
  intervaloSeg: [number, number];
  janela: { inicio: string; fim: string };
  /** 0 = domingo … 6 = sábado */
  dias: number[];
}

/** Próximo instante >= `data` que cai dentro da janela e de um dia permitido. */
export function ajustarParaJanela(data: Date, regras: JanelaEnvio, fuso: string): Date {
  const inicio = paraMinutos(regras.janela.inicio);
  const fim = paraMinutos(regras.janela.fim);
  let candidato = data;
  for (let i = 0; i < 15; i++) {
    const p = partesNoFuso(candidato, fuso);
    const minutos = p.hora * 60 + p.minuto;
    if (regras.dias.includes(p.diaSemana)) {
      if (minutos < inicio) return dataNoFuso(p.ano, p.mes, p.dia, Math.floor(inicio / 60), inicio % 60, fuso);
      if (minutos < fim) return candidato;
    }
    // Vai para o início da janela do dia seguinte
    const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
    candidato = dataNoFuso(
      amanha.getUTCFullYear(),
      amanha.getUTCMonth() + 1,
      amanha.getUTCDate(),
      Math.floor(inicio / 60),
      inicio % 60,
      fuso,
    );
  }
  throw new Error('Nenhum dia permitido na janela de envio');
}

/** Planeja o horário de cada envio: intervalos aleatórios, sempre dentro da janela. */
export function planejarHorarios(
  inicio: Date,
  quantidade: number,
  regras: JanelaEnvio,
  fuso: string,
  aleatorio: () => number = Math.random,
): Date[] {
  const [min, max] = regras.intervaloSeg;
  const horarios: Date[] = [];
  let atual = ajustarParaJanela(inicio, regras, fuso);
  for (let i = 0; i < quantidade; i++) {
    if (i > 0) {
      const segundos = min + aleatorio() * (max - min);
      atual = ajustarParaJanela(new Date(atual.getTime() + segundos * 1000), regras, fuso);
    }
    horarios.push(atual);
  }
  return horarios;
}
