export type Aleatorio = () => number;

/** Gerador determinístico (mulberry32) para testes. */
export function aleatorioComSemente(semente: number): Aleatorio {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Executa tarefas com no máximo `limite` em paralelo, preservando a ordem dos resultados. */
export async function emParalelo<T, R>(itens: T[], limite: number, tarefa: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await tarefa(itens[i]!, i);
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
}
