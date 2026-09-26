# Dex Automation — guia para o Claude

Ferramenta interna (NVR) de automações de mensagens WhatsApp sobre o Dex Provider. Um operador, vários clientes (workspaces).
Desenho e fases: `docs/DESIGN.md`. Uso e deploy: `README.md`.

## Fase atual
F1a entregue: tudo roda em **modo sombra** (gera e registra, não envia). Próxima: F1b (adaptador Dex Provider, fila de envio real com ritmo/janela, relatório por WhatsApp ao cliente, alertas ao operador). O código do Dex Provider ainda não está acessível.

## Onde roda
- **Vercel (produção):** `src/index.ts` exporta o app Hono. Sem processo contínuo: agenda + fila rodam em `GET /tarefas/tick` (cron por minuto em `vercel.json`, protegido por `CRON_SECRET`); "Rodar agora"/"Prévia" usam `waitUntil`. Execuções respeitam `prazo` e pausam/retomam entre ticks. Banco: Neon (pooler em modo transação: nada de lock de sessão).
- **Processo contínuo (Docker/dev):** `src/processo.ts` sobe painel + `Worker` + `Agenda`.
- Nada pode ler arquivos do disco em tempo de execução (o deploy serverless não os leva): CSS e migrações ficam em `.ts`.

## Comandos
- `npm test`: precisa de Postgres em `TEST_DATABASE_URL` (padrão `postgres://dex:dex@localhost:5432/dex_automation_test`)
- `npm run typecheck`, `npm run build`, `npm run dev`
- Antes de concluir qualquer mudança: `npm run typecheck && npm test`

## Convenções
- Código, nomes, mensagens e UI em **português**, como já está.
- ESM com extensões `.js` nos imports; TypeScript estrito com `noUncheckedIndexedAccess`.
- SQL direto com `pg` (sem ORM); mudanças de schema = novo arquivo `src/db/migracoes/NNN_nome.ts` registrado em `index.ts`; nunca editar nem renomear uma aplicada.
- Arquivos `.tsx` começam com `/** @jsxImportSource hono/jsx */` (a Vercel pode transpilar sem ler o tsconfig).
- Configuração de automação validada por Zod em `src/motor/config.ts`. Se um campo novo aparecer no formulário da receita, mantenha `formParaConfig`/`configParaForm` simétricos (há teste de ida e volta).
- "O código decide, a IA escreve": regras determinísticas (saudação, cruzamento, variações, validação) ficam em código, não no prompt.
- Erros esperados (planilha, config, chave de IA) abortam a execução com mensagem legível (`ExecucaoAbortada`, `ErroPlanilha`, `ErroConfig`, `ErroLLMDefinitivo`).
- Painel: Hono + JSX no servidor, sem JS no cliente, escapando tudo (textos vêm da planilha e da IA).

## Regras de dados (o repositório é público)
- Nunca commitar dados de clientes (planilhas, telefones, nomes), prompts de clientes, chaves ou `.env`.
- Configurações reais ficam em `seeds/local/` (ignorado). Testes usam dados fictícios.
