export interface MensagemLLM {
  papel: 'system' | 'user' | 'assistant';
  conteudo: string;
}

export interface PedidoLLM {
  modelo: string;
  mensagens: MensagemLLM[];
  temperatura?: number;
}

export interface RespostaLLM {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensEntradaCache: number;
}

export interface ProvedorLLM {
  gerar(pedido: PedidoLLM): Promise<RespostaLLM>;
}

/** Erro que não adianta repetir (chave inválida, modelo inexistente, pedido malformado). */
export class ErroLLMDefinitivo extends Error {}

export interface OpcoesOpenAI {
  fetchFn?: typeof fetch;
  urlBase?: string;
  /** Esperas entre tentativas, em ms. Padrão: [2000, 6000] (3 tentativas ao todo). */
  esperas?: number[];
  timeoutMs?: number;
}

export class OpenAI implements ProvedorLLM {
  private readonly fetchFn: typeof fetch;
  private readonly urlBase: string;
  private readonly esperas: number[];
  private readonly timeoutMs: number;

  constructor(
    private readonly chave: string,
    opcoes: OpcoesOpenAI = {},
  ) {
    this.fetchFn = opcoes.fetchFn ?? fetch;
    this.urlBase = opcoes.urlBase ?? 'https://api.openai.com/v1';
    this.esperas = opcoes.esperas ?? [2000, 6000];
    this.timeoutMs = opcoes.timeoutMs ?? 90_000;
  }

  async gerar(pedido: PedidoLLM): Promise<RespostaLLM> {
    const corpo: Record<string, unknown> = {
      model: pedido.modelo,
      messages: pedido.mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
    };
    if (pedido.temperatura !== undefined) corpo.temperature = pedido.temperatura;

    let ultimoErro: Error = new Error('sem tentativas');
    for (let tentativa = 0; tentativa <= this.esperas.length; tentativa++) {
      if (tentativa > 0) await new Promise((r) => setTimeout(r, this.esperas[tentativa - 1]));
      let resposta: Response;
      try {
        resposta = await this.fetchFn(`${this.urlBase}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.chave}`, 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        ultimoErro = new Error(`Falha de rede com a OpenAI: ${(e as Error).message}`);
        continue;
      }

      if (resposta.ok) {
        const json = (await resposta.json()) as {
          model?: string;
          choices?: { message?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        };
        return {
          texto: json.choices?.[0]?.message?.content ?? '',
          modelo: json.model ?? pedido.modelo,
          tokensEntrada: json.usage?.prompt_tokens ?? 0,
          tokensSaida: json.usage?.completion_tokens ?? 0,
          tokensEntradaCache: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }

      const detalhe = (await resposta.text()).slice(0, 500);
      if (resposta.status === 401) throw new ErroLLMDefinitivo('Chave da OpenAI inválida ou revogada.');
      if (resposta.status === 429 && /insufficient_quota/.test(detalhe)) {
        throw new ErroLLMDefinitivo('A conta da OpenAI está sem créditos (insufficient_quota).');
      }
      if (resposta.status === 429 || resposta.status >= 500) {
        ultimoErro = new Error(`OpenAI respondeu ${resposta.status}: ${detalhe}`);
        continue;
      }
      throw new ErroLLMDefinitivo(`OpenAI recusou o pedido (${resposta.status}): ${detalhe}`);
    }
    throw ultimoErro;
  }
}

/** Preço em USD por 1 milhão de tokens. */
export interface Preco {
  entrada: number;
  saida: number;
  cache?: number;
}
export type TabelaPrecos = Record<string, Preco>;

// Valores de referência. Confira em https://openai.com/api/pricing e sobrescreva com LLM_PRECOS_JSON se mudarem.
export const PRECOS_PADRAO: TabelaPrecos = {
  'gpt-4.1': { entrada: 2, saida: 8, cache: 0.5 },
  'gpt-4.1-mini': { entrada: 0.4, saida: 1.6, cache: 0.1 },
  'gpt-4.1-nano': { entrada: 0.1, saida: 0.4, cache: 0.025 },
  'gpt-4o': { entrada: 2.5, saida: 10, cache: 1.25 },
  'gpt-4o-mini': { entrada: 0.15, saida: 0.6, cache: 0.075 },
};

export function lerPrecos(json: string | undefined): TabelaPrecos {
  if (!json) return { ...PRECOS_PADRAO };
  try {
    return { ...PRECOS_PADRAO, ...(JSON.parse(json) as TabelaPrecos) };
  } catch {
    throw new Error('LLM_PRECOS_JSON não é um JSON válido');
  }
}

function precoDoModelo(modelo: string, tabela: TabelaPrecos): Preco | undefined {
  if (tabela[modelo]) return tabela[modelo];
  // A API devolve nomes com data (gpt-4.1-2025-04-14): usa o prefixo mais longo conhecido
  const conhecido = Object.keys(tabela)
    .filter((m) => modelo.startsWith(`${m}-`))
    .sort((a, b) => b.length - a.length)[0];
  return conhecido ? tabela[conhecido] : undefined;
}

/** Custo em USD, ou null se o modelo não estiver na tabela de preços. */
export function calcularCusto(r: Omit<RespostaLLM, 'texto'>, tabela: TabelaPrecos): number | null {
  const preco = precoDoModelo(r.modelo, tabela);
  if (!preco) return null;
  const cache = Math.min(r.tokensEntradaCache, r.tokensEntrada);
  const normal = r.tokensEntrada - cache;
  return (normal * preco.entrada + cache * (preco.cache ?? preco.entrada) + r.tokensSaida * preco.saida) / 1_000_000;
}
