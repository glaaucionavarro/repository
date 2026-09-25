function resolver(vars: Record<string, unknown>, caminho: string): unknown {
  let atual: unknown = vars;
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function paraTexto(valor: unknown): string {
  if (valor === undefined || valor === null) return '';
  if (Array.isArray(valor)) return valor.map(paraTexto).filter(Boolean).join(', ');
  return String(valor);
}

/** Substitui {{caminho.da.variavel}}. Listas viram "a, b, c"; ausentes viram vazio. */
export function renderizar(modelo: string, vars: Record<string, unknown>): string {
  return modelo
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, caminho: string) => paraTexto(resolver(vars, caminho)))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}
