import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use o formato HH:MM');
const texto = z.string().trim().min(1);

export const esquemaFonte = z.object({
  planilha: texto,
  aba: texto,
  /** campo interno → nome da coluna na planilha */
  colunas: z.record(z.string(), texto),
});

const etapaFiltrar = z.object({
  tipo: z.literal('filtrar'),
  campo: texto,
  op: z.enum(['preenchido', 'vazio', 'igual', 'diferente', 'contem', 'lista_nao_vazia']),
  valor: z.string().optional(),
  /** Motivo mostrado no relatório para quem for filtrado */
  motivo: z.string().optional(),
  /** Como o funil descreve quem passou (ex.: "com produto da semana") */
  rotulo: z.string().optional(),
});

const etapaCruzar = z.object({
  tipo: z.literal('cruzar'),
  /** Campo do contato com uma lista separada por vírgula (ex.: preferências) */
  campo: texto,
  /** Fonte com os itens disponíveis (ex.: produtos da semana) */
  fonte: texto,
  campoFonte: texto,
  /** Campo novo no contato com os itens em comum */
  saida: texto,
  separador: z.string().min(1).default(','),
  /** nome canônico → outras grafias que devem casar com ele */
  sinonimos: z.record(z.string(), z.array(z.string())).default({}),
});

const etapaApelido = z.object({
  tipo: z.literal('apelido'),
  campoNome: texto.default('nome'),
  /** Campo onde procurar "Chamar (apenas) de X" */
  campoObservacao: z.string().optional(),
  /** Coluna de apelido explícita, se existir; tem prioridade */
  campoApelido: z.string().optional(),
  saida: texto.default('apelido'),
});

export const esquemaEtapa = z.discriminatedUnion('tipo', [etapaFiltrar, etapaCruzar, etapaApelido]);

const grupoVariacao = z.object({
  opcoes: z.array(texto).min(1),
  /** A mensagem precisa começar exatamente com a opção sorteada (usado no cumprimento) */
  exigirInicio: z.boolean().default(false),
});

const composicao = z.object({
  tipo: z.literal('ia').default('ia'),
  modelo: texto.default('gpt-4.1'),
  temperatura: z.number().min(0).max(2).optional(),
  /** Rótulo livre da versão do prompt, gravado em cada mensagem */
  versao: texto.default('v1'),
  promptSistema: texto,
  promptUsuario: texto,
  /** Quantas mensagens enviadas anteriormente entram no contexto */
  historico: z.number().int().min(0).max(10).default(2),
  variacoes: z.record(z.string(), grupoVariacao).default({}),
  /** Total de tentativas quando a validação reprova (1 = sem nova tentativa) */
  tentativas: z.number().int().min(1).max(3).default(2),
  /** Chamadas simultâneas à IA */
  paralelismo: z.number().int().min(1).max(10).default(3),
});

const validacao = z.object({
  maxEmojis: z.number().int().min(0).optional(),
  maxCaracteres: z.number().int().min(1).optional(),
  proibidos: z.array(z.string().min(1)).default([]),
  /** Reprova travessões (—, –) e hífens soltos entre frases (" - "), mas aceita palavras como "sexta-feira" */
  semTravessao: z.boolean().default(false),
  /** Só pode mencionar itens do campo `permitidos`; `universo` diz quais itens existem */
  somenteItensDe: z
    .object({
      permitidos: texto,
      universo: z
        .array(z.object({ fonte: texto, campo: texto, lista: z.boolean().default(false) }))
        .min(1),
    })
    .optional(),
  diferenteDaUltima: z.boolean().default(true),
  similaridadeMaxima: z.number().min(0).max(1).default(0.75),
});

const envio = z.object({
  canal: z.enum(['simulado', 'dex_provider']).default('simulado'),
  instancia: z.string().optional(),
  intervaloSeg: z
    .tuple([z.number().min(1), z.number().min(1)])
    .refine(([min, max]) => max >= min, 'o intervalo máximo deve ser maior ou igual ao mínimo')
    .default([40, 120]),
  janela: z
    .object({ inicio: hhmm, fim: hhmm })
    .refine((j) => j.fim > j.inicio, 'o fim da janela deve ser depois do início')
    .default({ inicio: '09:00', fim: '19:00' }),
  /** 0 = domingo … 6 = sábado */
  dias: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
});

const guardas = z.object({
  /** Liga/desliga pela planilha: só roda se alguma linha da coluna tiver o valor */
  chavePlanilha: z.object({ planilha: texto, aba: texto, coluna: texto, valor: texto }).optional(),
});

export const esquemaConfig = z
  .object({
    guardas: guardas.prefault({}),
    fontes: z.record(z.string(), esquemaFonte),
    /** Qual fonte é a lista de contatos. Ela precisa mapear os campos `nome` e `telefone`. */
    contatos: texto,
    etapas: z.array(esquemaEtapa).default([]),
    composicao,
    validacao: validacao.prefault({}),
    envio: envio.prefault({}),
    /** Janela de idempotência: um contato recebe no máximo uma mensagem por período */
    periodo: z.enum(['dia', 'semana', 'mes']).default('semana'),
    /** Quantos contatos a prévia processa */
    previaLimite: z.number().int().min(1).max(50).default(5),
  })
  .superRefine((c, ctx) => {
    const fonteContatos = c.fontes[c.contatos];
    if (!fonteContatos) {
      ctx.addIssue({ code: 'custom', path: ['contatos'], message: `fonte "${c.contatos}" não existe em fontes` });
    } else {
      for (const campo of ['nome', 'telefone']) {
        if (!fonteContatos.colunas[campo]) {
          ctx.addIssue({
            code: 'custom',
            path: ['fontes', c.contatos, 'colunas', campo],
            message: `a fonte de contatos precisa mapear o campo "${campo}"`,
          });
        }
      }
    }
    c.etapas.forEach((e, i) => {
      if (e.tipo === 'cruzar' && !c.fontes[e.fonte]) {
        ctx.addIssue({ code: 'custom', path: ['etapas', i, 'fonte'], message: `fonte "${e.fonte}" não existe` });
      }
    });
    c.validacao.somenteItensDe?.universo.forEach((u, i) => {
      if (!c.fontes[u.fonte]) {
        ctx.addIssue({
          code: 'custom',
          path: ['validacao', 'somenteItensDe', 'universo', i, 'fonte'],
          message: `fonte "${u.fonte}" não existe`,
        });
      }
    });
    if (c.envio.canal === 'dex_provider' && !c.envio.instancia) {
      ctx.addIssue({ code: 'custom', path: ['envio', 'instancia'], message: 'informe a instância do Dex Provider' });
    }
  });

export type AutomacaoConfig = z.infer<typeof esquemaConfig>;
export type Etapa = z.infer<typeof esquemaEtapa>;
export type RegrasValidacao = AutomacaoConfig['validacao'];
export type GruposVariacao = AutomacaoConfig['composicao']['variacoes'];

export class ErroConfig extends Error {}

export function lerConfig(bruto: unknown): AutomacaoConfig {
  const r = esquemaConfig.safeParse(bruto);
  if (!r.success) {
    const erros = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`);
    throw new ErroConfig(`Configuração inválida — ${erros.join('; ')}`);
  }
  return r.data;
}
