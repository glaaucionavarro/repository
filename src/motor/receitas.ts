import { extrairIdPlanilha } from '../conectores/planilhas.js';
import type { AutomacaoConfig } from './config.js';

export const DISPARO_IA = 'disparo_recorrente_ia';

export const RECEITAS: Record<string, { nome: string; descricao: string }> = {
  [DISPARO_IA]: {
    nome: 'Disparo recorrente personalizado com IA',
    descricao:
      'Lê contatos e produtos de uma planilha, cruza preferências com os produtos disponíveis e escreve uma mensagem para cada contato.',
  },
};

/** Campos do formulário da receita "disparo recorrente com IA". Tudo string, como vem do HTML. */
export interface FormDisparoIA {
  nome: string;
  agendaDias: number[];
  agendaHora: string;
  planilha: string;
  abaContatos: string;
  colNome: string;
  colTelefone: string;
  colPreferencias: string;
  colObservacao: string;
  colApelido: string;
  abaProdutos: string;
  colProduto: string;
  chaveAba: string;
  chaveColuna: string;
  chaveValor: string;
  sinonimos: string;
  modelo: string;
  versao: string;
  promptSistema: string;
  promptUsuario: string;
  historico: string;
  cumprimentos: string;
  apresentacoes: string;
  conexoes: string;
  fechamentos: string;
  maxEmojis: string;
  proibidos: string;
  semTravessao: boolean;
  somenteProdutos: boolean;
  diferenteDaUltima: boolean;
  intervaloMin: string;
  intervaloMax: string;
  janelaInicio: string;
  janelaFim: string;
  diasEnvio: number[];
  periodo: string;
  previaLimite: string;
}

export const PROMPT_SISTEMA_PADRAO = `Você escreve mensagens de WhatsApp em nome de [NOME DO NEGÓCIO] para clientes que já conhecem a marca.

Tom: próximo, caloroso e natural, como uma conversa entre conhecidos. Sem pressão de venda.

Regras:
- Fale sempre em nome da marca ("temos", "nosso menu"), nunca "eu tenho".
- Mencione apenas os produtos informados para este cliente.
- Use as observações do cliente só para personalizar, sem assumir que ele vai comprar.
- Use no máximo 2 emojis: um no cumprimento e um no fechamento.
- Não use travessões (—) nem hífens soltos entre frases.
- Não invente promoções, preços ou prazos.

Formato: cumprimento, linha em branco, corpo, linha em branco, fechamento.`;

export const PROMPT_USUARIO_PADRAO = `Dados do cliente:
- Nome: {{nome}} (chame de {{apelido}})
- Produtos desta semana que ele(a) gosta: {{produtos_match}}
- Observação: {{observacao}}

Hoje é {{dia_semana}}, {{data}}. A mensagem sai às {{hora}}.

Comece a mensagem exatamente com: "{{variacao.cumprimento}}" e coloque um emoji logo depois.
Para apresentar os produtos, inspire-se em: "{{variacao.apresentacao}}"
Para a conexão pessoal, use: "{{variacao.conexao}}"
Para fechar, inspire-se em: "{{variacao.fechamento}}" (ajuste gênero e número ao produto).

Mensagens enviadas antes a este cliente (não repita a estrutura delas):
{{historico}}

Responda somente com o texto da mensagem.`;

export function formPadrao(): FormDisparoIA {
  return {
    nome: '',
    agendaDias: [3],
    agendaHora: '10:00',
    planilha: '',
    abaContatos: 'Clientes',
    colNome: 'Nome',
    colTelefone: 'Número',
    colPreferencias: 'Preferências',
    colObservacao: 'Observação',
    colApelido: '',
    abaProdutos: 'Produtos',
    colProduto: 'Produtos da Semana',
    chaveAba: 'Status',
    chaveColuna: 'Status',
    chaveValor: 'ON',
    sinonimos: '',
    modelo: 'gpt-4.1',
    versao: 'v1',
    promptSistema: PROMPT_SISTEMA_PADRAO,
    promptUsuario: PROMPT_USUARIO_PADRAO,
    historico: '2',
    cumprimentos: [
      'Oi {{apelido}}! {{saudacao}} Tudo bem?',
      'Ei {{apelido}}! {{saudacao}} Tudo bem?',
      'Oieee {{apelido}}! {{saudacao}} Tudo bem?',
    ].join('\n'),
    apresentacoes: [
      'essa semana temos {{produtos_match}}!',
      'no menu dessa semana tem {{produtos_match}}!',
      'passando para avisar que essa semana temos {{produtos_match}}!',
      'já está no menu dessa semana: {{produtos_match}}!',
    ].join('\n'),
    conexoes: ['Sei que você adora', 'Lembrei que você gosta', 'Como sei que você adora'].join('\n'),
    fechamentos: [
      'Se quiser garantir o seu, é só me avisar!',
      'Me chama aqui se quiser garantir o seu!',
      'Se quiser, é só me chamar que já deixo reservado pra você!',
    ].join('\n'),
    maxEmojis: '2',
    proibidos: '',
    semTravessao: true,
    somenteProdutos: true,
    diferenteDaUltima: true,
    intervaloMin: '40',
    intervaloMax: '120',
    janelaInicio: '09:00',
    janelaFim: '19:00',
    diasEnvio: [1, 2, 3, 4, 5, 6],
    periodo: 'semana',
    previaLimite: '5',
  };
}

const linhas = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** "Nome canônico = outra grafia; mais uma" por linha */
export function lerSinonimos(texto: string): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  for (const linha of linhas(texto)) {
    const [canonico, resto] = linha.split('=');
    if (!canonico?.trim() || !resto) continue;
    r[canonico.trim()] = resto
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return r;
}

function escreverSinonimos(s: Record<string, string[]>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k} = ${v.join('; ')}`)
    .join('\n');
}

const numero = (s: string, padrao?: number) => (s.trim() === '' ? padrao : Number(s));

/** Converte o formulário na config do motor (a validação final é do esquema). */
export function formParaConfig(f: FormDisparoIA): unknown {
  const planilha = extrairIdPlanilha(f.planilha);
  const colunas: Record<string, string> = { nome: f.colNome, telefone: f.colTelefone };
  if (f.colPreferencias.trim()) colunas.preferencias = f.colPreferencias;
  if (f.colObservacao.trim()) colunas.observacao = f.colObservacao;
  if (f.colApelido.trim()) colunas.apelido = f.colApelido;

  const variacoes: Record<string, { opcoes: string[]; exigirInicio: boolean }> = {};
  if (linhas(f.cumprimentos).length) variacoes.cumprimento = { opcoes: linhas(f.cumprimentos), exigirInicio: true };
  if (linhas(f.apresentacoes).length) variacoes.apresentacao = { opcoes: linhas(f.apresentacoes), exigirInicio: false };
  if (linhas(f.conexoes).length) variacoes.conexao = { opcoes: linhas(f.conexoes), exigirInicio: false };
  if (linhas(f.fechamentos).length) variacoes.fechamento = { opcoes: linhas(f.fechamentos), exigirInicio: false };

  const chaveAtiva = f.chaveAba.trim() && f.chaveColuna.trim() && f.chaveValor.trim();

  return {
    guardas: chaveAtiva
      ? { chavePlanilha: { planilha, aba: f.chaveAba, coluna: f.chaveColuna, valor: f.chaveValor } }
      : {},
    fontes: {
      contatos: { planilha, aba: f.abaContatos, colunas },
      produtos: { planilha, aba: f.abaProdutos, colunas: { nome: f.colProduto } },
    },
    contatos: 'contatos',
    etapas: [
      {
        tipo: 'apelido',
        campoNome: 'nome',
        ...(colunas.observacao ? { campoObservacao: 'observacao' } : {}),
        ...(colunas.apelido ? { campoApelido: 'apelido' } : {}),
      },
      {
        tipo: 'cruzar',
        campo: 'preferencias',
        fonte: 'produtos',
        campoFonte: 'nome',
        saida: 'produtos_match',
        sinonimos: lerSinonimos(f.sinonimos),
      },
      {
        tipo: 'filtrar',
        campo: 'produtos_match',
        op: 'lista_nao_vazia',
        motivo: 'sem produto da semana nas preferências',
        rotulo: 'com produto da semana nas preferências',
      },
    ],
    composicao: {
      tipo: 'ia',
      modelo: f.modelo,
      versao: f.versao,
      promptSistema: f.promptSistema,
      promptUsuario: f.promptUsuario,
      historico: numero(f.historico, 2),
      variacoes,
    },
    validacao: {
      maxEmojis: numero(f.maxEmojis),
      proibidos: linhas(f.proibidos),
      semTravessao: f.semTravessao,
      diferenteDaUltima: f.diferenteDaUltima,
      ...(f.somenteProdutos
        ? {
            somenteItensDe: {
              permitidos: 'produtos_match',
              universo: [
                { fonte: 'produtos', campo: 'nome' },
                ...(colunas.preferencias ? [{ fonte: 'contatos', campo: 'preferencias', lista: true }] : []),
              ],
            },
          }
        : {}),
    },
    envio: {
      canal: 'simulado',
      intervaloSeg: [numero(f.intervaloMin, 40), numero(f.intervaloMax, 120)],
      janela: { inicio: f.janelaInicio, fim: f.janelaFim },
      dias: f.diasEnvio,
    },
    periodo: f.periodo,
    previaLimite: numero(f.previaLimite, 5),
  };
}

/** Caminho inverso, para editar uma automação criada pelo formulário. */
export function configParaForm(nome: string, c: AutomacaoConfig, agenda: { dias: number[]; hora: string } | null): FormDisparoIA {
  const contatos = c.fontes[c.contatos]!;
  const produtos = c.fontes.produtos;
  const cruzar = c.etapas.find((e) => e.tipo === 'cruzar');
  const chave = c.guardas.chavePlanilha;
  const v = c.composicao.variacoes;
  return {
    nome,
    agendaDias: agenda?.dias ?? [],
    agendaHora: agenda?.hora ?? '',
    planilha: contatos.planilha,
    abaContatos: contatos.aba,
    colNome: contatos.colunas.nome ?? '',
    colTelefone: contatos.colunas.telefone ?? '',
    colPreferencias: contatos.colunas.preferencias ?? '',
    colObservacao: contatos.colunas.observacao ?? '',
    colApelido: contatos.colunas.apelido ?? '',
    abaProdutos: produtos?.aba ?? '',
    colProduto: produtos?.colunas.nome ?? '',
    chaveAba: chave?.aba ?? '',
    chaveColuna: chave?.coluna ?? '',
    chaveValor: chave?.valor ?? '',
    sinonimos: cruzar?.tipo === 'cruzar' ? escreverSinonimos(cruzar.sinonimos) : '',
    modelo: c.composicao.modelo,
    versao: c.composicao.versao,
    promptSistema: c.composicao.promptSistema,
    promptUsuario: c.composicao.promptUsuario,
    historico: String(c.composicao.historico),
    cumprimentos: (v.cumprimento?.opcoes ?? []).join('\n'),
    apresentacoes: (v.apresentacao?.opcoes ?? []).join('\n'),
    conexoes: (v.conexao?.opcoes ?? []).join('\n'),
    fechamentos: (v.fechamento?.opcoes ?? []).join('\n'),
    maxEmojis: c.validacao.maxEmojis === undefined ? '' : String(c.validacao.maxEmojis),
    proibidos: c.validacao.proibidos.join('\n'),
    semTravessao: c.validacao.semTravessao,
    somenteProdutos: Boolean(c.validacao.somenteItensDe),
    diferenteDaUltima: c.validacao.diferenteDaUltima,
    intervaloMin: String(c.envio.intervaloSeg[0]),
    intervaloMax: String(c.envio.intervaloSeg[1]),
    janelaInicio: c.envio.janela.inicio,
    janelaFim: c.envio.janela.fim,
    diasEnvio: c.envio.dias,
    periodo: c.periodo,
    previaLimite: String(c.previaLimite),
  };
}
