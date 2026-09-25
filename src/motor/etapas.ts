import type { Registro } from '../conectores/planilhas.js';
import { dividirLista, normalizar } from '../lib/texto.js';
import type { Etapa } from './config.js';
import { ativos, pular, type Item } from './itens.js';

type Filtrar = Extract<Etapa, { tipo: 'filtrar' }>;
type Cruzar = Extract<Etapa, { tipo: 'cruzar' }>;
type Apelido = Extract<Etapa, { tipo: 'apelido' }>;

function comoTexto(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  return v === undefined || v === null ? '' : String(v);
}

function passaFiltro(item: Item, e: Filtrar): boolean {
  const valor = item.campos[e.campo];
  switch (e.op) {
    case 'preenchido':
      return comoTexto(valor).trim() !== '';
    case 'vazio':
      return comoTexto(valor).trim() === '';
    case 'igual':
      return normalizar(comoTexto(valor)) === normalizar(e.valor ?? '');
    case 'diferente':
      return normalizar(comoTexto(valor)) !== normalizar(e.valor ?? '');
    case 'contem':
      return normalizar(comoTexto(valor)).includes(normalizar(e.valor ?? ''));
    case 'lista_nao_vazia':
      return Array.isArray(valor) ? valor.length > 0 : comoTexto(valor).trim() !== '';
  }
}

export function aplicarFiltrar(itens: Item[], e: Filtrar): void {
  for (const item of ativos(itens)) {
    if (!passaFiltro(item, e)) {
      pular(item, 'filtro', e.motivo ?? `filtro: ${e.campo} ${e.op}${e.valor ? ` "${e.valor}"` : ''}`);
    }
  }
}

/**
 * Cruza a lista do contato (ex.: preferências) com os itens de outra fonte (ex.: produtos da semana).
 * A comparação ignora acentos, maiúsculas, pontuação e espaços extras, e aceita sinônimos.
 * O resultado usa a grafia da fonte (a que está no cardápio), não a do contato.
 */
export function aplicarCruzar(itens: Item[], e: Cruzar, fontes: Record<string, Registro[]>): void {
  const disponiveis = (fontes[e.fonte] ?? [])
    .map((r) => r.campos[e.campoFonte] ?? '')
    .filter((v) => v.trim() !== '');

  const canonicoDe = new Map<string, string>();
  for (const [canonico, outras] of Object.entries(e.sinonimos)) {
    const alvo = normalizar(canonico);
    canonicoDe.set(alvo, alvo);
    for (const outra of outras) canonicoDe.set(normalizar(outra), alvo);
  }
  const chave = (s: string) => {
    const n = normalizar(s);
    return canonicoDe.get(n) ?? n;
  };

  const porChave = new Map<string, string>();
  for (const d of disponiveis) if (!porChave.has(chave(d))) porChave.set(chave(d), d.trim());

  for (const item of ativos(itens)) {
    const desejados = dividirLista(comoTexto(item.campos[e.campo]), e.separador);
    const encontrados: string[] = [];
    for (const desejado of desejados) {
      const achado = porChave.get(chave(desejado));
      if (achado && !encontrados.includes(achado)) encontrados.push(achado);
    }
    item.campos[e.saida] = encontrados;
  }
}

const CHAMAR_DE = /chamar\s+(?:apenas\s+|somente\s+|só\s+|so\s+)?(?:de|por|como)\s+["“']?([\p{Letter}][\p{Letter}'-]*)/iu;

/** Apelido: coluna explícita > "Chamar (apenas) de X" na observação > primeiro nome. */
export function extrairApelido(nome: string, observacao?: string, apelidoExplicito?: string): string {
  if (apelidoExplicito?.trim()) return apelidoExplicito.trim();
  const m = observacao ? CHAMAR_DE.exec(observacao) : null;
  if (m) return m[1]!;
  return nome.trim().split(/\s+/)[0] ?? nome.trim();
}

export function aplicarApelido(itens: Item[], e: Apelido): void {
  for (const item of ativos(itens)) {
    item.campos[e.saida] = extrairApelido(
      comoTexto(item.campos[e.campoNome]) || item.nome,
      e.campoObservacao ? comoTexto(item.campos[e.campoObservacao]) : undefined,
      e.campoApelido ? comoTexto(item.campos[e.campoApelido]) : undefined,
    );
  }
}

export function aplicarEtapa(itens: Item[], e: Etapa, fontes: Record<string, Registro[]>): void {
  if (e.tipo === 'filtrar') aplicarFiltrar(itens, e);
  else if (e.tipo === 'cruzar') aplicarCruzar(itens, e, fontes);
  else aplicarApelido(itens, e);
}

export function rotuloEtapa(e: Etapa): string {
  if (e.tipo === 'filtrar') return e.rotulo ?? `filtro: ${e.campo} ${e.op}${e.valor ? ` "${e.valor}"` : ''}`;
  if (e.tipo === 'cruzar') return `cruzar ${e.campo} × ${e.fonte}`;
  return 'apelido';
}
