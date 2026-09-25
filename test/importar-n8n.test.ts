import { describe, expect, it } from 'vitest';
import { converterMemoria, textoDaIA } from '../src/cli/importar-n8n.js';

describe('importação do histórico do n8n', () => {
  it('lê mensagens da IA nos formatos do LangChain', () => {
    expect(textoDaIA({ type: 'ai', content: ' Oi! ' })).toBe('Oi!');
    expect(textoDaIA('{"type":"ai","data":{"content":"Olá"}}')).toBe('Olá');
    expect(textoDaIA({ type: 'human', content: 'Cliente: ...' })).toBeNull();
  });

  it('converte, normaliza telefones e remove a gravação duplicada', () => {
    const linhas = [
      { id: 1, session_id: 'disparo-31 91234-5678', message: { type: 'human', content: 'prompt' } },
      { id: 2, session_id: 'disparo-31 91234-5678', message: { type: 'ai', content: 'Semana 1' } },
      { id: 3, session_id: 'disparo-31 91234-5678', message: { type: 'ai', content: 'Semana 1' } },
      { id: 5, session_id: 'disparo-31 91234-5678', message: { type: 'ai', content: 'Semana 2' } },
      { id: 4, session_id: 'disparo-‪21 98888-7777‬', message: { type: 'ai', content: 'Outro' } },
      { id: 6, session_id: 'disparo-', message: { type: 'ai', content: 'Sem número' } },
    ];
    const r = converterMemoria(linhas, 'disparo-');
    expect(r.mensagens).toEqual([
      { telefone: '5531912345678', texto: 'Semana 1', ordem: 0 },
      { telefone: '5521988887777', texto: 'Outro', ordem: 1 },
      { telefone: '5531912345678', texto: 'Semana 2', ordem: 2 },
    ]);
    expect(r.ignoradas).toBe(1);
  });
});
