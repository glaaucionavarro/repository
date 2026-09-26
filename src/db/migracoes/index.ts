import inicial from './001_inicial.js';

/**
 * Migrações em ordem. Ficam em TypeScript (e não em .sql lidos do disco) para irem junto no deploy serverless.
 * O nome é o que fica gravado em schema_migracoes: nunca renomeie nem altere uma migração já aplicada.
 */
export const MIGRACOES: { nome: string; sql: string }[] = [{ nome: '001_inicial.sql', sql: inicial }];
