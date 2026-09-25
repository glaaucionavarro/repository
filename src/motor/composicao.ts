import { calcularCusto, ErroLLMDefinitivo, type MensagemLLM, type ProvedorLLM, type TabelaPrecos } from '../conectores/llm.js';
import { renderizar } from '../lib/template.js';
import { limparSaidaModelo } from '../lib/texto.js';
import type { AutomacaoConfig } from './config.js';
import { validarMensagem, type ContextoValidacao } from './validacao.js';
import type { MensagemAnterior, VariacaoEscolhida } from './variacoes.js';

export interface Tentativa {
  texto: string;
  problemas: string[];
}

export interface ResultadoComposicao {
  status: 'gerada' | 'precisa_revisao' | 'falhou';
  texto: string | null;
  motivo?: string;
  tentativas: Tentativa[];
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  /** null quando o modelo não está na tabela de preços */
  custo: number | null;
}

export function formatarHistorico(historico: MensagemAnterior[]): string {
  if (historico.length === 0) return '(nenhuma mensagem anterior)';
  return historico
    .map((m, i) => `Mensagem anterior ${i + 1}${i === 0 ? ' (mais recente)' : ''}:\n${m.texto}`)
    .join('\n\n');
}

export interface ParametrosComposicao {
  llm: ProvedorLLM;
  config: AutomacaoConfig['composicao'];
  regras: AutomacaoConfig['validacao'];
  /** Variáveis do contato + globais (saudação, data…) */
  vars: Record<string, unknown>;
  /** Variáveis que não mudam entre contatos (entram no prompt de sistema) */
  globais: Record<string, unknown>;
  historico: MensagemAnterior[];
  variacao: VariacaoEscolhida;
  contextoValidacao: Omit<ContextoValidacao, 'anteriores' | 'inicioExigido'>;
  precos: TabelaPrecos;
}

/** Gera a mensagem e valida; se reprovar, pede correção à IA até esgotar as tentativas. */
export async function comporMensagem(p: ParametrosComposicao): Promise<ResultadoComposicao> {
  const grupoInicio = Object.entries(p.config.variacoes).find(([, g]) => g.exigirInicio)?.[0];
  const ctxValidacao: ContextoValidacao = {
    ...p.contextoValidacao,
    anteriores: p.historico.map((h) => h.texto),
    inicioExigido: grupoInicio ? p.variacao.textos[grupoInicio] : undefined,
  };
  const vars = { ...p.vars, variacao: p.variacao.textos, historico: formatarHistorico(p.historico) };
  const conversa: MensagemLLM[] = [
    { papel: 'system', conteudo: renderizar(p.config.promptSistema, p.globais) },
    { papel: 'user', conteudo: renderizar(p.config.promptUsuario, vars) },
  ];

  const resultado: ResultadoComposicao = {
    status: 'falhou',
    texto: null,
    tentativas: [],
    modelo: p.config.modelo,
    tokensEntrada: 0,
    tokensSaida: 0,
    custo: 0,
  };

  try {
    for (let t = 1; t <= p.config.tentativas; t++) {
      const resposta = await p.llm.gerar({ modelo: p.config.modelo, mensagens: conversa, temperatura: p.config.temperatura });
      resultado.modelo = resposta.modelo;
      resultado.tokensEntrada += resposta.tokensEntrada;
      resultado.tokensSaida += resposta.tokensSaida;
      const custo = calcularCusto(resposta, p.precos);
      resultado.custo = custo === null || resultado.custo === null ? null : resultado.custo + custo;

      const texto = limparSaidaModelo(resposta.texto);
      const problemas = validarMensagem(texto, p.regras, ctxValidacao);
      resultado.tentativas.push({ texto, problemas });
      resultado.texto = texto;

      if (problemas.length === 0) {
        resultado.status = 'gerada';
        return resultado;
      }
      conversa.push(
        { papel: 'assistant', conteudo: texto },
        {
          papel: 'user',
          conteudo:
            `Essa mensagem não pode ser enviada porque:\n${problemas.map((x) => `- ${x}`).join('\n')}\n\n` +
            'Reescreva corrigindo esses pontos e mantendo todas as outras instruções. Responda só com o texto da mensagem.',
        },
      );
    }
    resultado.status = 'precisa_revisao';
    resultado.motivo = `reprovada na validação: ${resultado.tentativas.at(-1)!.problemas.join('; ')}`;
    return resultado;
  } catch (e) {
    // Chave inválida, sem créditos etc. valem para todos os contatos: sobe para abortar a execução
    if (e instanceof ErroLLMDefinitivo) throw e;
    resultado.status = 'falhou';
    resultado.motivo = `falha na IA: ${(e as Error).message}`;
    return resultado;
  }
}
