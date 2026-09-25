import pg from 'pg';
import type { PedidoLLM, ProvedorLLM, RespostaLLM } from '../src/conectores/llm.js';
import { migrar } from '../src/db/migrar.js';
import { criarPool, type Db } from '../src/db/pool.js';

export const URL_TESTE = process.env.TEST_DATABASE_URL ?? 'postgres://dex:dex@localhost:5432/dex_automation_test';

export async function bancoDisponivel(): Promise<boolean> {
  const c = new pg.Client({ connectionString: URL_TESTE, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

/** Banco isolado por arquivo de teste: cada um ganha seu próprio schema. */
export async function prepararBanco(schema: string): Promise<Db> {
  const admin = new pg.Client({ connectionString: URL_TESTE });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const url = new URL(URL_TESTE);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = criarPool(url.toString());
  await migrar(db);
  return db;
}

export type Resposta = string | Error | ((pedido: PedidoLLM, n: number) => string | Error);

/** IA falsa: devolve respostas programadas e guarda os pedidos recebidos. */
export class LLMFalso implements ProvedorLLM {
  pedidos: PedidoLLM[] = [];

  constructor(private readonly resposta: Resposta = respostaPadrao) {}

  async gerar(pedido: PedidoLLM): Promise<RespostaLLM> {
    this.pedidos.push(structuredClone(pedido));
    const r = typeof this.resposta === 'function' ? this.resposta(pedido, this.pedidos.length) : this.resposta;
    if (r instanceof Error) throw r;
    return { texto: r, modelo: 'gpt-4.1-2025-04-14', tokensEntrada: 1000, tokensSaida: 100, tokensEntradaCache: 0 };
  }
}

/** Resposta válida: começa com o cumprimento pedido e cita os produtos permitidos. */
export function respostaPadrao(pedido: PedidoLLM): string {
  const usuario = pedido.mensagens.find((m) => m.papel === 'user')!.conteudo;
  const inicio = /Comece exatamente com: "([^"]*)"/.exec(usuario)?.[1] ?? 'Oi!';
  const produtos = /Produtos: (.*)/.exec(usuario)?.[1] ?? '';
  return `${inicio} 😊\n\nNo menu dessa semana temos ${produtos}! Se quiser garantir, é só me chamar!\n\n💚`;
}

export const PLANILHA = 'planilha-teste';

export function dadosPlanilha(status = 'ON') {
  return {
    [PLANILHA]: {
      Status: [['', 'Status'], ['', status]],
      Produtos: [['', 'Produtos da Semana'], ['', 'Bolo de Cenoura'], ['', 'Bombom de morango'], ['', 'Torta de limão']],
      Clientes: [
        ['', 'Nome', 'Número', 'Preferências', 'Observação'],
        ['', 'Ana Souza', '31 91234-5678', 'Bombom de morango, bolo de cenoura ', 'Chamar apenas de Aninha.'],
        ['', 'Bruno Lima', '‪31 998765432‬', 'Torta de Limao', ''],
        ['', 'Carla Dias', '', 'Bombom de morango', ''],
        ['', 'Diego Reis', '(31) 91234-5678', 'Bolo de cenoura', ''],
        ['', 'Elisa Prado', '11 97777-0000', 'Quiche', 'Chamar de Lili.'],
        ['', 'Fábio Nunes', '+55 21 96666-1111', 'bolo  de   cenoura', ''],
        ['', '', '', '', ''],
        ['', 'Gabi Torres', '12345', 'Bombom de morango', ''],
      ],
    },
  };
}

export function configTeste(extra: Record<string, unknown> = {}) {
  return {
    guardas: { chavePlanilha: { planilha: PLANILHA, aba: 'Status', coluna: 'Status', valor: 'ON' } },
    fontes: {
      clientes: {
        planilha: PLANILHA,
        aba: 'Clientes',
        colunas: { nome: 'Nome', telefone: 'Número', preferencias: 'Preferências', observacao: 'Observação' },
      },
      produtos: { planilha: PLANILHA, aba: 'Produtos', colunas: { nome: 'Produtos da Semana' } },
    },
    contatos: 'clientes',
    etapas: [
      { tipo: 'apelido', campoNome: 'nome', campoObservacao: 'observacao' },
      { tipo: 'cruzar', campo: 'preferencias', fonte: 'produtos', campoFonte: 'nome', saida: 'produtos_match' },
      {
        tipo: 'filtrar',
        campo: 'produtos_match',
        op: 'lista_nao_vazia',
        motivo: 'sem produto da semana nas preferências',
        rotulo: 'com produto da semana nas preferências',
      },
    ],
    composicao: {
      modelo: 'gpt-4.1',
      promptSistema: 'Você é uma confeitaria de teste. Hoje é {{dia_semana}}.',
      promptUsuario:
        'Cliente: {{apelido}}\nProdutos: {{produtos_match}}\nComece exatamente com: "{{variacao.cumprimento}}"\n\n{{historico}}',
      historico: 2,
      variacoes: {
        cumprimento: {
          opcoes: ['Oi {{apelido}}! {{saudacao}} Tudo bem?', 'Ei {{apelido}}! {{saudacao}} Tudo bem?', 'Oieee {{apelido}}! {{saudacao}} Tudo bem?'],
          exigirInicio: true,
        },
      },
    },
    validacao: {
      maxEmojis: 2,
      proibidos: ['—'],
      somenteItensDe: {
        permitidos: 'produtos_match',
        universo: [
          { fonte: 'produtos', campo: 'nome' },
          { fonte: 'clientes', campo: 'preferencias', lista: true },
        ],
      },
    },
    envio: { intervaloSeg: [40, 120], janela: { inicio: '09:00', fim: '19:00' }, dias: [1, 2, 3, 4, 5, 6] },
    ...extra,
  };
}
