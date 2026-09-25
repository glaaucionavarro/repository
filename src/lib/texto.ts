// Caracteres invisíveis que aparecem em dados colados de WhatsApp/planilhas
// (marcas de direção, espaços de largura zero, BOM).
const INVISIVEIS = /[​-‏‪-‮⁠-⁩﻿]/g;

export function removerInvisiveis(s: string): string {
  return s.replace(INVISIVEIS, '');
}

/** Forma canônica para comparar textos: sem acentos, minúsculo, sem pontuação/emojis, espaços únicos. */
export function normalizar(s: string): string {
  return removerInvisiveis(s)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

export function dividirLista(s: string, separador = ','): string[] {
  return removerInvisiveis(s)
    .split(separador)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const segmentador = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
const PICTOGRAFICO = /\p{Extended_Pictographic}/u;

/** Conta emojis por grafema, então 👩‍🍳 e ❤️ contam como um só. */
export function contarEmojis(s: string): number {
  let total = 0;
  for (const { segment } of segmentador.segment(s)) {
    if (PICTOGRAFICO.test(segment)) total++;
  }
  return total;
}

function bigramas(s: string): Set<string> {
  const palavras = normalizar(s).split(' ').filter(Boolean);
  const resultado = new Set<string>();
  for (let i = 0; i < palavras.length - 1; i++) resultado.add(`${palavras[i]} ${palavras[i + 1]}`);
  if (palavras.length === 1) resultado.add(palavras[0]!);
  return resultado;
}

/** Similaridade de Jaccard entre bigramas de palavras (0 = nada em comum, 1 = iguais). */
export function similaridade(a: string, b: string): number {
  const x = bigramas(a);
  const y = bigramas(b);
  if (x.size === 0 && y.size === 0) return 1;
  let comum = 0;
  for (const g of x) if (y.has(g)) comum++;
  return comum / (x.size + y.size - comum);
}

export function primeiraPalavra(s: string): string {
  return normalizar(s).split(' ')[0] ?? '';
}

/** Remove aspas ou cercas de código que o modelo às vezes coloca em volta da resposta. */
export function limparSaidaModelo(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  if (t.length >= 2 && /^["“'].*["”']$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}
