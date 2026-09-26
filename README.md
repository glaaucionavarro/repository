# Dex Automation

Ferramenta interna da NVR para automações de mensagens via WhatsApp, operando sobre o Dex Provider.
O desenho completo, com decisões e fases, está em [docs/DESIGN.md](docs/DESIGN.md).

## Situação

**F1a — modo sombra (esta versão).** A ferramenta lê a planilha do cliente, cruza preferências com os produtos da semana, gera cada mensagem com IA, valida e registra tudo. **Nada é enviado.** O envio real (F1b) depende da integração com o Dex Provider.

## Como uma execução funciona

1. **Guardas:** confere se a automação está ativa, se a chave "ON" da planilha está ligada e se o cliente tem chave de IA.
2. **Leitura:** lê as abas pelo **nome das colunas** (a posição não importa). Se uma coluna sumiu, a execução para com uma mensagem clara.
3. **Limpeza:** normaliza os telefones, tira quem não tem número, os números repetidos e quem pediu opt-out.
4. **Etapas:** apelido ("Chamar apenas de X"), cruzamento das preferências com os produtos (ignora acentos, maiúsculas e espaços, e aceita sinônimos) e filtro de quem não tem produto em comum.
5. **Idempotência:** quem já recebeu no período (semana, por padrão) é pulado, então rodar de novo não duplica mensagens.
6. **Composição:** o código calcula a saudação pelo horário previsto de envio, sorteia cumprimento/apresentação/conexão/fechamento diferentes das últimas mensagens do contato e monta o prompt. A IA só redige.
7. **Validação:** limite de emojis, termos proibidos, travessões, citar só os produtos permitidos, não repetir a última mensagem. Se reprovar, a IA recebe os problemas e reescreve uma vez; se reprovar de novo, a mensagem fica como "precisa revisão" e não sai.
8. **Registro:** cada mensagem guarda os dados usados, as tentativas, a validação, os tokens e o custo. A execução guarda o funil e o custo total.

## Implantar na Vercel (recomendado)

A Vercel não mantém processo rodando o tempo todo. Por isso, a agenda e a fila rodam na rota `/tarefas/tick`, que o cron da Vercel chama **a cada minuto** (veja `vercel.json`). "Rodar agora" e "Prévia" começam na hora, sem esperar o cron. Execuções longas pausam antes do limite de tempo da Vercel e continuam no minuto seguinte.

**Precisa do plano Pro.** O plano Hobby só permite cron uma vez por dia (o deploy falha com o cron por minuto) e, pelas regras da Vercel, é só para uso pessoal e não comercial.

Uma única vez:

1. **Importar:** na Vercel, *Add New → Project* e importe o repositório. Não precisa mudar nada nas configurações de build: a Vercel detecta o Hono em `src/index.ts`.
2. **Banco:** em *Storage → Create Database → Neon (Postgres)*, crie o banco e conecte ao projeto. Isso cria o `DATABASE_URL` sozinho. Use a mesma região das funções (padrão: Washington, D.C. / `us-east-1`).
3. **Variáveis** (*Settings → Environment Variables*, ambiente Production):

   | Variável | Valor |
   |---|---|
   | `APP_SECRET` | 64 caracteres aleatórios (`openssl rand -hex 32`). **Guarde:** se mudar, as chaves de IA salvas deixam de abrir |
   | `ADMIN_PASSWORD` | Senha do painel (forte) |
   | `CRON_SECRET` | Outro valor aleatório (`openssl rand -hex 32`) |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON da conta de serviço (veja abaixo) |

4. **Publicar de novo** (*Deployments → Redeploy*) para as variáveis valerem. As migrações rodam sozinhas na primeira visita.
5. **Domínio:** em *Settings → Domains*, adicione `automacao.seudominio.com.br`. No DNS do domínio, crie um registro **CNAME** com nome `automacao` e valor `cname.vercel-dns.com` (ou o valor que a Vercel mostrar ali). O HTTPS é emitido sozinho.

Se faltar alguma variável, o site mostra uma página "Configuração incompleta" dizendo qual.

Depois disso, cada push na branch de produção publica sozinho.

## Rodar localmente

Requisitos: Node 22 e Postgres 16.

```bash
cp .env.example .env        # preencha DATABASE_URL, APP_SECRET, ADMIN_PASSWORD
npm install
npm run dev                 # aplica as migrações e sobe painel + worker + agenda (src/processo.ts)
```

O painel fica em http://localhost:3000.

## Implantar com Docker (servidor próprio)

```bash
cp .env.example .env        # preencha APP_SECRET, ADMIN_PASSWORD e GOOGLE_SERVICE_ACCOUNT_JSON
docker compose up -d --build
```

- O compose sobe o Postgres e a aplicação, e o `DATABASE_URL` é montado automaticamente. Para trocar a senha do banco, defina `POSTGRES_PASSWORD` no `.env`.
- Atrás de um proxy com HTTPS (Easypanel, Traefik, Nginx…), defina `COOKIE_SEGURO=true`.
- Para rodar os papéis em processos separados, use `PAPEIS=web` num e `PAPEIS=worker,agenda` no outro.
- **Guarde o `APP_SECRET`.** As chaves de IA dos clientes são cifradas com ele; se ele mudar, elas precisam ser cadastradas de novo.

## Conta de serviço do Google

A ferramenta lê as planilhas com uma única conta de serviço da NVR:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto e ative a **Google Sheets API**.
2. Em *IAM e administrador → Contas de serviço*, crie uma conta e gere uma **chave JSON**.
3. Coloque o conteúdo do JSON (puro ou em base64) em `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Em cada planilha de cliente, **compartilhe com o `client_email`** da conta, como Leitor.

Se faltar compartilhar, a execução para com a mensagem "Sem acesso à planilha. Compartilhe-a com …".

## Colocar um cliente no ar

1. **Clientes → Novo cliente** e cadastre a chave da OpenAI do cliente.
2. **Nova automação:** preencha o formulário ou importe um arquivo de configuração:
   ```bash
   OPENAI_API_KEY=sk-... npm run automacao:importar -- --arquivo seeds/local/cliente.json
   ```
   Veja o formato em [seeds/exemplo.json](seeds/exemplo.json). Configurações reais de clientes ficam em `seeds/local/`, que o git ignora.
3. Clique em **Prévia** e confira as mensagens geradas para os primeiros contatos.
4. Clique em **Ligar agenda**. No modo sombra, cada execução gera e registra as mensagens sem enviar.

## Migrar um fluxo do n8n

1. **Importe o histórico** que o n8n já enviou, para a primeira mensagem real não repetir a última do n8n:
   ```bash
   npm run importar-n8n -- --workspace meu-cliente --tabela nome_da_tabela_de_memoria \
     --origem postgres://usuario:senha@host:5432/banco_do_n8n --simular
   # confira os números e rode de novo sem --simular
   ```
   No Docker: `docker compose exec app node dist/src/cli/importar-n8n.js --workspace meu-cliente --tabela ... --origem ...`.
   A tabela é a configurada no nó de memória Postgres do fluxo. Reimportar substitui a importação anterior; rode de novo logo antes da virada.
2. **Modo sombra por 1–2 semanas:** o n8n continua enviando e a Dex Automation gera em paralelo, para comparar no painel.
3. **Virada** (F1b): o fluxo do n8n é desligado (sem apagar) e o envio real é ativado.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe tudo em modo desenvolvimento |
| `npm test` | Testes (os de integração precisam de Postgres; veja abaixo) |
| `npm run typecheck` | Checagem de tipos |
| `npm run build` / `npm start` | Compila para `dist/` e roda a versão compilada (processo contínuo) |
| `npm run migrar` | Aplica as migrações pendentes |
| `npm run importar-n8n -- …` | Importa o histórico do n8n |
| `npm run automacao:importar -- …` | Cria ou atualiza cliente e automação a partir de um JSON |

**Testes com Postgres:** os testes de integração usam `TEST_DATABASE_URL` (padrão `postgres://dex:dex@localhost:5432/dex_automation_test`) e criam um schema próprio por arquivo. Sem banco disponível, eles são pulados.

## Estrutura

```
src/
  conectores/   Google Sheets, OpenAI, canal WhatsApp (simulado; Dex Provider na F1b)
  motor/        config (Zod), etapas, variações, validação, composição, execução, receitas
  worker/       fila no Postgres (SKIP LOCKED), recuperação de travadas, agenda (cron por fuso), tick do serverless
  web/          painel (Hono + JSX no servidor), autenticação, páginas, CSS
  db/           conexão, migrações (em TypeScript, para irem junto no deploy serverless)
  cli/          migração, importação do n8n, importação de automação
  lib/          telefone, texto, tempo, template, criptografia
  index.ts      entrada da Vercel (exporta o app)
  processo.ts   entrada de processo contínuo (Docker/servidor/desenvolvimento)
test/           unitários + integração com Postgres
```

## Segurança

- Nunca coloque no repositório `.env`, chaves, dados de planilhas ou prompts de clientes. A pasta `seeds/local/` é ignorada para isso.
- As chaves de IA ficam cifradas (AES-256-GCM) com o `APP_SECRET`.
- O painel tem login único por senha, limite de tentativas, cookie assinado, checagem de origem nos formulários e cabeçalhos de segurança. Use uma senha forte e exponha o painel só por HTTPS.
