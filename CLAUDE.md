# Dex Automation — guia para o Claude

Ferramenta interna (NVR) de automações de mensagens WhatsApp sobre o Dex Provider. Um operador, vários clientes (workspaces).
Desenho e fases: `docs/DESIGN.md`. Uso e deploy: `README.md`.

## Fase atual
F1a entregue: tudo roda em **modo sombra** (gera e registra, não envia). Próxima: F1b (adaptador Dex Provider, fila de envio real com ritmo/janela, relatório por WhatsApp ao cliente, alertas ao operador). O código do Dex Provider ainda não está acessível.

## Comandos
- `npm test`: precisa de Postgres em `TEST_DATABASE_URL` (padrão `postgres://dex:dex@localhost:5432/dex_automation_test`)
- `npm run typecheck`, `npm run build`, `npm run dev`
- Antes de concluir qualquer mudança: `npm run typecheck && npm test`

## Convenções
- Código, nomes, mensagens e UI em **português**, como já está.
- ESM com extensões `.js` nos imports; TypeScript estrito com `noUncheckedIndexedAccess`.
- SQL direto com `pg` (sem ORM); mudanças de schema = nova migração em `migrations/NNN_nome.sql`, nunca editar uma aplicada.
- Configuração de automação validada por Zod em `src/motor/config.ts`. Se um campo novo aparecer no formulário da receita, mantenha `formParaConfig`/`configParaForm` simétricos (há teste de ida e volta).
- "O código decide, a IA escreve": regras determinísticas (saudação, cruzamento, variações, validação) ficam em código, não no prompt.
- Erros esperados (planilha, config, chave de IA) abortam a execução com mensagem legível (`ExecucaoAbortada`, `ErroPlanilha`, `ErroConfig`, `ErroLLMDefinitivo`).
- Painel: Hono + JSX no servidor, sem JS no cliente, escapando tudo (textos vêm da planilha e da IA).

## Regras de dados (o repositório é público)
- Nunca commitar dados de clientes (planilhas, telefones, nomes), prompts de clientes, chaves ou `.env`.
- Configurações reais ficam em `seeds/local/` (ignorado). Testes usam dados fictícios.
