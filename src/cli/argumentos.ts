/** --chave valor  /  --chave=valor  /  --flag */
export function lerArgumentos(argv = process.argv.slice(2)): Record<string, string | true> {
  const r: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const [chave, valor] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (valor !== undefined) r[chave] = valor;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) r[chave] = argv[++i]!;
    else r[chave] = true;
  }
  return r;
}

export function obrigatorio(args: Record<string, string | true>, chave: string, uso: string): string {
  const v = args[chave];
  if (typeof v !== 'string' || !v) {
    console.error(`Falta --${chave}\n\nUso: ${uso}`);
    process.exit(1);
  }
  return v;
}
