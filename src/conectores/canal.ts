export interface VerificacaoNumero {
  telefone: string;
  existe: boolean;
  jid?: string;
}

/**
 * Canal de envio de WhatsApp. O motor só conhece esta interface.
 * Implementações: simulado (modo sombra), Dex Provider (F1b) e Evolution direto (plano B).
 */
export interface CanalWhatsApp {
  readonly nome: string;
  verificarNumeros(instancia: string, telefones: string[]): Promise<VerificacaoNumero[]>;
  enviarTexto(instancia: string, para: string, texto: string, chaveIdempotencia: string): Promise<{ id: string }>;
}

/** Não envia nada: registra o que seria enviado. Usado no modo sombra e nos testes. */
export class CanalSimulado implements CanalWhatsApp {
  readonly nome = 'simulado';
  readonly enviados: { instancia: string; para: string; texto: string; chave: string }[] = [];

  async verificarNumeros(_instancia: string, telefones: string[]): Promise<VerificacaoNumero[]> {
    return telefones.map((telefone) => ({ telefone, existe: true, jid: `${telefone}@s.whatsapp.net` }));
  }

  async enviarTexto(instancia: string, para: string, texto: string, chave: string): Promise<{ id: string }> {
    this.enviados.push({ instancia, para, texto, chave });
    return { id: `simulado-${this.enviados.length}` };
  }
}
