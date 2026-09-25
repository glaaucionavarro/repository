import { removerInvisiveis } from './texto.js';

export type ResultadoTelefone =
  | { valido: true; numero: string }
  | { valido: false; motivo: 'sem_telefone' | 'telefone_invalido' };

/**
 * Normaliza um telefone para dígitos no formato internacional (E.164 sem o "+").
 * Números brasileiros sem DDI recebem 55; números que já têm 55 não recebem de novo.
 */
export function normalizarTelefone(bruto: string | null | undefined, ddiPadrao = '55'): ResultadoTelefone {
  const texto = removerInvisiveis(bruto ?? '').trim();
  if (!texto) return { valido: false, motivo: 'sem_telefone' };

  const internacional = texto.startsWith('+') || texto.startsWith('00');
  let digitos = texto.replace(/\D/g, '');
  if (texto.startsWith('00')) digitos = digitos.slice(2);
  if (!digitos) return { valido: false, motivo: 'sem_telefone' };

  if (internacional) {
    return digitos.length >= 10 && digitos.length <= 15
      ? { valido: true, numero: digitos }
      : { valido: false, motivo: 'telefone_invalido' };
  }

  if (ddiPadrao === '55') {
    // DDD + número (fixo com 8 dígitos ou celular com 9)
    if (digitos.length === 10 || digitos.length === 11) return { valido: true, numero: `55${digitos}` };
    // Já veio com 55 na frente
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
      return { valido: true, numero: digitos };
    }
    return { valido: false, motivo: 'telefone_invalido' };
  }

  const completo = `${ddiPadrao}${digitos}`;
  return completo.length >= 10 && completo.length <= 15
    ? { valido: true, numero: completo }
    : { valido: false, motivo: 'telefone_invalido' };
}

/** 5531998765432 → +55 31 99876-5432 (só para exibição). */
export function formatarTelefone(numero: string | null | undefined): string {
  if (!numero) return '—';
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(numero);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${numero}`;
}
