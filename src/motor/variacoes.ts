import type { Aleatorio } from '../lib/aleatorio.js';
import { renderizar } from '../lib/template.js';
import { normalizar, primeiraPalavra } from '../lib/texto.js';
import type { GruposVariacao } from './config.js';

export interface MensagemAnterior {
  texto: string;
  /** Índices usados em cada grupo, quando a mensagem foi gerada por esta ferramenta */
  variacao?: Record<string, number> | null;
}

export interface VariacaoEscolhida {
  indices: Record<string, number>;
  textos: Record<string, string>;
}

function jaUsada(
  grupo: string,
  indice: number,
  opcaoRenderizada: string,
  exigirInicio: boolean,
  anterior: MensagemAnterior,
): boolean {
  if (anterior.variacao && grupo in anterior.variacao) return anterior.variacao[grupo] === indice;
  // Mensagens importadas do n8n não têm o índice: detecta pelo texto
  if (exigirInicio) return primeiraPalavra(anterior.texto) === primeiraPalavra(opcaoRenderizada);
  const alvo = normalizar(opcaoRenderizada);
  return alvo.length > 0 && normalizar(anterior.texto).includes(alvo);
}

/**
 * Sorteia uma opção de cada grupo, evitando as usadas nas últimas mensagens.
 * Se todas já foram usadas, evita pelo menos a da mensagem mais recente.
 */
export function escolherVariacoes(
  grupos: GruposVariacao,
  historico: MensagemAnterior[],
  vars: Record<string, unknown>,
  aleatorio: Aleatorio,
): VariacaoEscolhida {
  const indices: Record<string, number> = {};
  const textos: Record<string, string> = {};
  for (const [grupo, def] of Object.entries(grupos)) {
    const renderizadas = def.opcoes.map((o) => renderizar(o, vars).trim());
    const livres = (anteriores: MensagemAnterior[]) =>
      renderizadas
        .map((r, i) => i)
        .filter((i) => !anteriores.some((a) => jaUsada(grupo, i, renderizadas[i]!, def.exigirInicio, a)));
    let candidatos = livres(historico);
    if (candidatos.length === 0) candidatos = livres(historico.slice(0, 1));
    if (candidatos.length === 0) candidatos = renderizadas.map((_, i) => i);
    const escolhido = candidatos[Math.floor(aleatorio() * candidatos.length)]!;
    indices[grupo] = escolhido;
    textos[grupo] = renderizadas[escolhido]!;
  }
  return { indices, textos };
}
