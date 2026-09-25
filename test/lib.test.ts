import { describe, expect, it } from 'vitest';
import { cifrar, decifrar, mascarar } from '../src/lib/cripto.js';
import { formatarTelefone, normalizarTelefone } from '../src/lib/telefone.js';
import {
  ajustarParaJanela,
  chavePeriodo,
  dataNoFuso,
  partesNoFuso,
  planejarHorarios,
  saudacao,
} from '../src/lib/tempo.js';
import { renderizar } from '../src/lib/template.js';
import { contarEmojis, dividirLista, limparSaidaModelo, normalizar, similaridade } from '../src/lib/texto.js';
import { aleatorioComSemente, emParalelo } from '../src/lib/aleatorio.js';

const SP = 'America/Sao_Paulo';

describe('telefone', () => {
  it.each([
    ['31 99801-1234', '5531998011234'],
    ['(31) 3222-1234', '553132221234'],
    ['‪61 999702045‬', '5561999702045'],
    ['5531998011234', '5531998011234'],
    ['+55 31 99801-1234', '5531998011234'],
    ['+1 415 555 0100', '14155550100'],
    ['0055 31 99801 1234', '5531998011234'],
  ])('%s → %s', (bruto, esperado) => {
    expect(normalizarTelefone(bruto)).toEqual({ valido: true, numero: esperado });
  });

  it('não duplica o 55 quando o número já tem DDI', () => {
    const r = normalizarTelefone('55 31 99801-1234');
    expect(r).toEqual({ valido: true, numero: '5531998011234' });
  });

  it('diferencia vazio de inválido', () => {
    expect(normalizarTelefone('')).toEqual({ valido: false, motivo: 'sem_telefone' });
    expect(normalizarTelefone('  ')).toEqual({ valido: false, motivo: 'sem_telefone' });
    expect(normalizarTelefone('12345')).toEqual({ valido: false, motivo: 'telefone_invalido' });
    expect(normalizarTelefone('99801-1234')).toEqual({ valido: false, motivo: 'telefone_invalido' });
  });

  it('formata para exibição', () => {
    expect(formatarTelefone('5531998011234')).toBe('+55 31 99801-1234');
  });
});

describe('texto', () => {
  it('normaliza acentos, caixa, pontuação e invisíveis', () => {
    expect(normalizar('  Torta de Limão!  ')).toBe('torta de limao');
    expect(normalizar('bolo  de​   cenoura')).toBe('bolo de cenoura');
  });

  it('divide listas ignorando vazios', () => {
    expect(dividirLista('a, b ,, c ')).toEqual(['a', 'b', 'c']);
  });

  it('conta emojis por grafema', () => {
    expect(contarEmojis('Oi 😊 tudo bem 💚')).toBe(2);
    expect(contarEmojis('👩‍🍳')).toBe(1);
    expect(contarEmojis('❤️')).toBe(1);
    expect(contarEmojis('sem emoji, 100% texto')).toBe(0);
  });

  it('mede similaridade', () => {
    expect(similaridade('oi ana tudo bem', 'Oi Ana! Tudo bem?')).toBe(1);
    expect(similaridade('essa semana temos bolo', 'no menu tem torta')).toBe(0);
  });

  it('limpa aspas e cercas que o modelo coloca', () => {
    expect(limparSaidaModelo('"Oi Ana!"')).toBe('Oi Ana!');
    expect(limparSaidaModelo('```\nOi\n```')).toBe('Oi');
  });
});

describe('tempo', () => {
  it('calcula a semana ISO no fuso local', () => {
    expect(chavePeriodo(new Date('2026-09-30T13:00:00Z'), SP, 'semana')).toBe('2026-W40');
    // 01:00 UTC de segunda ainda é domingo em São Paulo
    expect(chavePeriodo(new Date('2026-10-05T01:00:00Z'), SP, 'semana')).toBe('2026-W40');
    expect(chavePeriodo(new Date('2027-01-01T12:00:00Z'), SP, 'semana')).toBe('2026-W53');
    expect(chavePeriodo(new Date('2026-09-30T13:00:00Z'), SP, 'dia')).toBe('2026-09-30');
    expect(chavePeriodo(new Date('2026-09-30T13:00:00Z'), SP, 'mes')).toBe('2026-09');
  });

  it('saudação pelo horário local', () => {
    expect(saudacao(new Date('2026-09-30T13:00:00Z'), SP)).toBe('Bom dia!');
    expect(saudacao(new Date('2026-09-30T16:00:00Z'), SP)).toBe('Boa tarde!');
    expect(saudacao(new Date('2026-09-30T22:00:00Z'), SP)).toBe('Boa noite!');
    expect(saudacao(new Date('2026-09-30T06:00:00Z'), SP)).toBe('');
  });

  it('converte data de parede para instante', () => {
    const d = dataNoFuso(2026, 9, 30, 10, 0, SP);
    expect(d.toISOString()).toBe('2026-09-30T13:00:00.000Z');
    expect(partesNoFuso(d, SP)).toMatchObject({ dia: 30, hora: 10, minuto: 0, diaSemana: 3 });
  });

  const regras = { intervaloSeg: [40, 120] as [number, number], janela: { inicio: '09:00', fim: '19:00' }, dias: [1, 2, 3, 4, 5, 6] };

  it('empurra para a próxima janela permitida', () => {
    // Sábado 19:30 → domingo não pode → segunda 09:00
    const sabadoNoite = dataNoFuso(2026, 10, 3, 19, 30, SP);
    expect(ajustarParaJanela(sabadoNoite, regras, SP).toISOString()).toBe(dataNoFuso(2026, 10, 5, 9, 0, SP).toISOString());
    // Antes da janela → início da janela no mesmo dia
    const cedo = dataNoFuso(2026, 9, 30, 7, 15, SP);
    expect(ajustarParaJanela(cedo, regras, SP).toISOString()).toBe(dataNoFuso(2026, 9, 30, 9, 0, SP).toISOString());
  });

  it('planeja horários com intervalo dentro dos limites e sempre na janela', () => {
    const inicio = dataNoFuso(2026, 9, 30, 18, 50, SP);
    const horarios = planejarHorarios(inicio, 20, regras, SP, aleatorioComSemente(1));
    expect(horarios).toHaveLength(20);
    for (let i = 1; i < horarios.length; i++) {
      const p = partesNoFuso(horarios[i]!, SP);
      expect(p.hora * 60 + p.minuto).toBeGreaterThanOrEqual(9 * 60);
      expect(p.hora * 60 + p.minuto).toBeLessThan(19 * 60);
      expect(horarios[i]!.getTime() - horarios[i - 1]!.getTime()).toBeGreaterThanOrEqual(40_000);
    }
    // Não cabe tudo até 19h: parte vai para quinta de manhã
    expect(partesNoFuso(horarios.at(-1)!, SP).dia).toBe(1);
  });
});

describe('template', () => {
  it('renderiza variáveis, listas e ausentes', () => {
    expect(renderizar('Oi {{nome}}! {{saudacao}} Tudo bem?', { nome: 'Ana', saudacao: '' })).toBe('Oi Ana! Tudo bem?');
    expect(renderizar('{{ lista }}|{{a.b}}|{{nada}}', { lista: ['x', 'y'], a: { b: 1 } })).toBe('x, y|1|');
  });
});

describe('cripto', () => {
  const segredo = 'x'.repeat(32);
  it('cifra e decifra', () => {
    const c = cifrar('sk-abc123', segredo);
    expect(c).not.toContain('sk-abc123');
    expect(decifrar(c, segredo)).toBe('sk-abc123');
  });
  it('falha com segredo errado', () => {
    expect(() => decifrar(cifrar('sk', segredo), 'y'.repeat(32))).toThrow();
  });
  it('mascara', () => expect(mascarar('sk-1234567890')).toBe('••••7890'));
});

describe('emParalelo', () => {
  it('respeita o limite e preserva a ordem', async () => {
    let simultaneos = 0;
    let pico = 0;
    const r = await emParalelo([1, 2, 3, 4, 5], 2, async (n) => {
      simultaneos++;
      pico = Math.max(pico, simultaneos);
      await new Promise((ok) => setTimeout(ok, 5));
      simultaneos--;
      return n * 10;
    });
    expect(r).toEqual([10, 20, 30, 40, 50]);
    expect(pico).toBe(2);
  });
});
