import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function chave(segredo: string): Buffer {
  return createHash('sha256').update(`dex-automation:${segredo}`).digest();
}

/** Cifra com AES-256-GCM. Formato: v1:<base64(iv | tag | dados)>. */
export function cifrar(texto: string, segredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave(segredo), iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return `v1:${Buffer.concat([iv, cifra.getAuthTag(), dados]).toString('base64')}`;
}

export function decifrar(cifrado: string, segredo: string): string {
  if (!cifrado.startsWith('v1:')) throw new Error('Formato de segredo desconhecido');
  const bruto = Buffer.from(cifrado.slice(3), 'base64');
  const decifra = createDecipheriv('aes-256-gcm', chave(segredo), bruto.subarray(0, 12));
  decifra.setAuthTag(bruto.subarray(12, 28));
  return Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]).toString('utf8');
}

export function iguaisSeguro(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/** Mostra só o final de uma chave: ••••abcd */
export function mascarar(segredo: string): string {
  return `••••${segredo.slice(-4)}`;
}
