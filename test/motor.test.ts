import { describe, expect, it } from 'vitest';
import { ErroConfig, lerConfig } from '../src/motor/config.js';
import { aplicarCruzar, aplicarFiltrar, extrairApelido } from '../src/motor/etapas.js';
import type { Item } from '../src/motor/itens.js';
import { itensMencionados, validarMensagem } from '../src/motor/validacao.js';
import { escolherVariacoes } from '../src/motor/variacoes.js';
import { aleatorioComSemente } from '../src/lib/aleatorio.js';
import { configTeste } from './ajuda.js';

const item = (campos: Record<string, unknown>, linha = 2): Item => ({
  linha,
  nome: String(campos.nome ?? 'X'),
  telefone: '5531900000000',
  campos,
  ativo: true,
});

describe('cruzar', () => {
  const fontes = {
    produtos: [
      { linha: 2, campos: { nome: 'Bolo de Cenoura' } },
      { linha: 3, campos: { nome: 'Bombom de morango' } },
      { linha: 4, campos: { nome: 'Bolo no pote de frutas vermelhas' } },
    ],
  };
  const etapa = {
    tipo: 'cruzar' as const,
    campo: 'preferencias',
    fonte: 'produtos',
    campoFonte: 'nome',
    saida: 'match',
    separador: ',',
    sinonimos: { 'Bolo no pote de frutas vermelhas': ['bolo de pote de frutas vermelhas'] },
  };

  it('ignora acentos, caixa e espaços, e devolve a grafia do cardápio', () => {
    const i = item({ preferencias: 'BOMBOM de Morango , bolo  de cenoura, quiche' });
    aplicarCruzar([i], etapa, fontes);
    expect(i.campos.match).toEqual(['Bombom de morango', 'Bolo de Cenoura']);
  });

  it('usa sinônimos', () => {
    const i = item({ preferencias: 'Bolo de pote de frutas vermelhas' });
    aplicarCruzar([i], etapa, fontes);
    expect(i.campos.match).toEqual(['Bolo no pote de frutas vermelhas']);
  });

  it('lista vazia quando não há nada em comum', () => {
    const i = item({ preferencias: 'Quiche' });
    aplicarCruzar([i], etapa, fontes);
    expect(i.campos.match).toEqual([]);
  });
});

describe('filtrar', () => {
  it('pula com o motivo configurado', () => {
    const a = item({ match: ['x'] });
    const b = item({ match: [] });
    aplicarFiltrar([a, b], { tipo: 'filtrar', campo: 'match', op: 'lista_nao_vazia', motivo: 'sem produto' });
    expect(a.ativo).toBe(true);
    expect(b).toMatchObject({ ativo: false, motivoCodigo: 'filtro', motivo: 'sem produto' });
  });

  it('operadores de texto', () => {
    const itens = [item({ s: 'VIP' }), item({ s: 'comum' }), item({ s: '' })];
    aplicarFiltrar(itens, { tipo: 'filtrar', campo: 's', op: 'igual', valor: 'vip' });
    expect(itens.map((i) => i.ativo)).toEqual([true, false, false]);
  });
});

describe('apelido', () => {
  it.each([
    ['Paula Mendes', 'Chamar apenas de Paula. Cliente fiel.', 'Paula'],
    ['Renata Leal', 'Chamar de Rê. Ama bolo.', 'Rê'],
    ['Larissa Grupo', 'Chamar apenas de Larissa.', 'Larissa'],
    ['Júlia Castro', '', 'Júlia'],
    ['Mariana', 'Pode chamar de "Mari" sempre', 'Mari'],
  ])('%s / %s → %s', (nome, obs, esperado) => {
    expect(extrairApelido(nome, obs)).toBe(esperado);
  });

  it('coluna explícita tem prioridade', () => {
    expect(extrairApelido('Ana Souza', 'Chamar de Aninha', 'Nana')).toBe('Nana');
  });
});

describe('validação', () => {
  const regras = lerConfig(configTeste()).validacao;
  const universo = ['Bolo de Cenoura', 'Bombom de morango', 'Bombom aberto de morango', 'Torta de limão', 'Bolo'];

  it('detecta menções priorizando o nome mais longo', () => {
    expect(itensMencionados('Temos bombom aberto de morango e bolo de cenoura!', universo)).toEqual([
      'bombom aberto de morango',
      'bolo de cenoura',
    ]);
  });

  it('aprova uma mensagem correta', () => {
    const texto = 'Oi Ana! Bom dia! Tudo bem? 😊\n\nEssa semana temos bombom de morango!\n\n💚';
    expect(
      validarMensagem(texto, regras, { universo, permitidos: ['Bombom de morango'], inicioExigido: 'Oi Ana! Bom dia! Tudo bem?' }),
    ).toEqual([]);
  });

  it('lista todos os problemas', () => {
    const texto = 'Ei Ana — 😊😍 temos torta de limão 💚';
    const problemas = validarMensagem(texto, regras, {
      universo,
      permitidos: ['Bombom de morango'],
      inicioExigido: 'Oi Ana!',
      anteriores: ['Ei Ana — 😊😍 temos torta de limão 💚'],
    });
    expect(problemas).toEqual([
      'usa 3 emojis (máximo 2)',
      'contém "—", que é proibido',
      'não começa com "Oi Ana!"',
      'menciona item fora da lista permitida: torta de limao',
      'está parecida demais com uma mensagem anterior',
    ]);
  });
});

describe('variações', () => {
  const grupos = {
    cumprimento: { opcoes: ['Oi {{apelido}}!', 'Ei {{apelido}}!', 'Oieee {{apelido}}!'], exigirInicio: true },
    fechamento: { opcoes: ['é só me chamar', 'me avisa aqui'], exigirInicio: false },
  };
  const vars = { apelido: 'Ana' };

  it('evita as opções usadas no histórico importado (sem índice)', () => {
    const historico = [{ texto: 'Oi Ana! Tudo bem? ... é só me chamar' }, { texto: 'Ei Ana! ... me avisa aqui' }];
    for (let s = 0; s < 20; s++) {
      const v = escolherVariacoes(grupos, historico, vars, aleatorioComSemente(s));
      expect(v.textos.cumprimento).toBe('Oieee Ana!');
    }
  });

  it('"oieee" não é confundido com "oi"', () => {
    const v = escolherVariacoes({ c: grupos.cumprimento }, [{ texto: 'Oieee Ana!' }, { texto: 'Ei Ana!' }], vars, aleatorioComSemente(3));
    expect(v.textos.c).toBe('Oi Ana!');
  });

  it('usa os índices gravados quando existem', () => {
    const historico = [{ texto: 'qualquer', variacao: { fechamento: 0 } }];
    const v = escolherVariacoes({ fechamento: grupos.fechamento }, historico, vars, aleatorioComSemente(1));
    expect(v.indices.fechamento).toBe(1);
  });

  it('se todas foram usadas, evita ao menos a mais recente', () => {
    const historico = [{ texto: 'Ei Ana!' }, { texto: 'Oi Ana!' }, { texto: 'Oieee Ana!' }];
    for (let s = 0; s < 20; s++) {
      expect(escolherVariacoes(grupos, historico, vars, aleatorioComSemente(s)).textos.cumprimento).not.toBe('Ei Ana!');
    }
  });
});

describe('config', () => {
  it('aplica os padrões', () => {
    const c = lerConfig(configTeste());
    expect(c.periodo).toBe('semana');
    expect(c.composicao.tentativas).toBe(2);
    expect(c.envio.canal).toBe('simulado');
    expect(c.validacao.diferenteDaUltima).toBe(true);
  });

  it('explica o que está errado', () => {
    const base = configTeste();
    const semTelefone = {
      ...base,
      fontes: { ...base.fontes, clientes: { ...base.fontes.clientes, colunas: { nome: 'Nome' } } },
    };
    expect(() => lerConfig(semTelefone)).toThrow(ErroConfig);
    expect(() => lerConfig(semTelefone)).toThrow(/precisa mapear o campo "telefone"/);
    expect(() => lerConfig({ ...base, envio: { janela: { inicio: '19:00', fim: '09:00' } } })).toThrow(/fim da janela/);
  });
});

describe('receita: formulário ↔ config', () => {
  it('ida e volta não perde nada', async () => {
    const { configParaForm, formParaConfig, formPadrao } = await import('../src/motor/receitas.js');
    const f = { ...formPadrao(), nome: 'X', planilha: 'https://docs.google.com/spreadsheets/d/abc/edit', sinonimos: 'Bolo A = bolo a; bolo-a' };
    const c1 = lerConfig(formParaConfig(f));
    const c2 = lerConfig(formParaConfig(configParaForm('X', c1, { dias: f.agendaDias, hora: f.agendaHora })));
    expect(c2).toEqual(c1);
    expect(c1.composicao.variacoes.conexao?.opcoes).toHaveLength(3);
    expect(c1.etapas[1]).toMatchObject({ tipo: 'cruzar', sinonimos: { 'Bolo A': ['bolo a', 'bolo-a'] } });
    expect(c1.fontes.contatos!.planilha).toBe('abc');
  });

  it('o formulário representa todos os campos que a receita usa', async () => {
    const { configParaForm, formParaConfig } = await import('../src/motor/receitas.js');
    const c1 = lerConfig(configTeste({ contatos: 'contatos', fontes: { ...configTeste().fontes, contatos: configTeste().fontes.clientes } }));
    const volta = lerConfig(formParaConfig(configParaForm('X', c1, null)));
    expect(volta.composicao.variacoes.cumprimento).toEqual(c1.composicao.variacoes.cumprimento);
    expect(volta.validacao.proibidos).toEqual(c1.validacao.proibidos);
    expect(volta.envio).toEqual(c1.envio);
  });
});

describe('travessões', () => {
  const regras = lerConfig({ ...configTeste(), validacao: { semTravessao: true } }).validacao;
  it.each([
    ['Temos bolo — corre!', true],
    ['Temos bolo – corre!', true],
    ['Temos bolo - corre!', true],
    ['Entrego na sexta-feira!', false],
    ['Bombom zero-lactose', false],
  ])('%s → reprova=%s', (texto, reprova) => {
    expect(validarMensagem(texto, regras).includes('usa travessão ou hífen solto entre frases')).toBe(reprova);
  });
});
