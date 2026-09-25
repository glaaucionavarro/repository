/** Um contato passando pelas etapas da execução. */
export interface Item {
  linha: number;
  nome: string;
  telefone: string | null;
  campos: Record<string, unknown>;
  ativo: boolean;
  motivoCodigo?: string;
  motivo?: string;
}

export const MOTIVOS: Record<string, string> = {
  sem_telefone: 'sem número na planilha',
  telefone_invalido: 'número inválido',
  duplicado: 'número repetido na planilha',
  opt_out: 'pediu para não receber',
  ja_processado: 'já recebeu neste período',
};

export function pular(item: Item, codigo: string, motivo?: string): void {
  item.ativo = false;
  item.motivoCodigo = codigo;
  item.motivo = motivo ?? MOTIVOS[codigo] ?? codigo;
}

export const ativos = (itens: Item[]) => itens.filter((i) => i.ativo);
