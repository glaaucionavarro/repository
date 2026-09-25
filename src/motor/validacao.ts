import { contarEmojis, normalizar, similaridade } from '../lib/texto.js';
import type { RegrasValidacao } from './config.js';

export interface ContextoValidacao {
  /** Itens que a mensagem pode mencionar (ex.: produtos em comum com o cliente) */
  permitidos?: string[];
  /** Todos os itens conhecidos, para detectar menções fora da lista */
  universo?: string[];
  /** Mensagens anteriores do contato (a mais recente primeiro) */
  anteriores?: string[];
  /** A mensagem deve começar com este texto (cumprimento sorteado) */
  inicioExigido?: string;
}

/** Encontra os itens do universo citados no texto, priorizando os nomes mais longos. */
export function itensMencionados(texto: string, universo: string[]): string[] {
  const alvo = ` ${normalizar(texto)} `;
  const ocupado = new Array<boolean>(alvo.length).fill(false);
  const candidatos = [...new Set(universo.map(normalizar).filter((u) => u.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  const encontrados: string[] = [];
  for (const item of candidatos) {
    const agulha = ` ${item} `;
    let desde = 0;
    for (;;) {
      const pos = alvo.indexOf(agulha, desde);
      if (pos < 0) break;
      const inicio = pos + 1;
      const fim = pos + agulha.length - 1;
      if (!ocupado.slice(inicio, fim).some(Boolean)) {
        for (let i = inicio; i < fim; i++) ocupado[i] = true;
        if (!encontrados.includes(item)) encontrados.push(item);
      }
      desde = pos + 1;
    }
  }
  return encontrados;
}

/** Regras determinísticas. Retorna a lista de problemas (vazia = aprovada). */
export function validarMensagem(texto: string, regras: RegrasValidacao, ctx: ContextoValidacao = {}): string[] {
  const problemas: string[] = [];
  if (!texto.trim()) return ['a mensagem veio vazia'];

  if (regras.maxEmojis !== undefined) {
    const n = contarEmojis(texto);
    if (n > regras.maxEmojis) problemas.push(`usa ${n} emojis (máximo ${regras.maxEmojis})`);
  }
  if (regras.maxCaracteres !== undefined && texto.length > regras.maxCaracteres) {
    problemas.push(`tem ${texto.length} caracteres (máximo ${regras.maxCaracteres})`);
  }
  if (regras.semTravessao && /[—–]|\s-\s/.test(texto)) problemas.push('usa travessão ou hífen solto entre frases');
  for (const proibido of regras.proibidos) {
    if (texto.toLowerCase().includes(proibido.toLowerCase())) problemas.push(`contém "${proibido}", que é proibido`);
  }
  if (ctx.inicioExigido && !normalizar(texto).startsWith(normalizar(ctx.inicioExigido))) {
    problemas.push(`não começa com "${ctx.inicioExigido}"`);
  }
  if (ctx.universo && ctx.permitidos) {
    const permitidos = new Set(ctx.permitidos.map(normalizar));
    const fora = itensMencionados(texto, ctx.universo).filter((i) => !permitidos.has(i));
    if (fora.length > 0) problemas.push(`menciona item fora da lista permitida: ${fora.join(', ')}`);
  }
  if (regras.diferenteDaUltima && ctx.anteriores?.length) {
    const parecida = ctx.anteriores.find((a) => similaridade(texto, a) >= regras.similaridadeMaxima);
    if (parecida !== undefined) problemas.push('está parecida demais com uma mensagem anterior');
  }
  return problemas;
}
