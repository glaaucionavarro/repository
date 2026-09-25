# Dex Automation — Desenho da solução (v0.1, para aprovação)

> **Status:** proposta, nada implementado. Itens marcados com **(premissa)** dependem das respostas da §13.

---

## 1. O que é

Ferramenta de automações de mensagens via WhatsApp que opera **sobre o Dex Provider**, que já cuida da conexão dos números. O primeiro caso de uso é portar o fluxo n8n *FIT&LOW – Disparo Mensagens*.

**É:** um motor de automações *opinativo* para disparo. Traz receitas configuráveis (disparo recorrente com IA, disparo em massa, sequências, gatilhos) e já inclui entregabilidade, histórico, opt-out e aprovação.

**Não é (v1):**
- um editor visual de nós estilo n8n;
- um chatbot/atendimento;
- um gerenciador de conexão WhatsApp (esse papel é do Dex Provider).

---

## 2. Decisões principais

| # | Decisão | Proposta | Por quê | Descartado |
|---|---|---|---|---|
| D1 | Como se monta uma automação | **Receitas + etapas configuráveis** (formulário) | 80% dos casos são variações de "ler lista → filtrar → compor → enviar". Um canvas visual leva meses e compete com o n8n, que já existe | Editor de nós tipo n8n |
| D2 | Execução | **Duas fases:** Preparação (gera tudo) → Disparo (fila com ritmo) | Permite prévia, aprovação e reenvio sem pagar a IA de novo. O ritmo de envio deixa de depender da latência da IA | Gerar e enviar item a item (como hoje) |
| D3 | Onde fica a lógica | **O código decide, a IA escreve** | Saudação por horário, cruzamento de produtos, concordância de gênero, variação e limite de emojis são regras. Em código saem exatas e baratas; no prompt saem caras e falham às vezes | Prompt gigante fazendo tudo |
| D4 | Memória de mensagens | **Log próprio das mensagens enviadas**, com gravação só depois do envio confirmado | Hoje a memória é gravada antes do envio. Se o envio falha, na semana seguinte a IA "varia" em cima de uma mensagem que nunca chegou ao cliente | Postgres Chat Memory do n8n |
| D5 | Multi-cliente | **Workspace por cliente desde o dia 1** (premissa) | Barato de fazer agora, caro de adicionar depois | Instância única |
| D6 | Fonte de dados | **Google Sheets como conector**, com validação. A planilha continua sendo a interface do cliente | Não muda a rotina de quem alimenta a planilha | Migrar tudo para o painel já na v1 |
| D7 | Fila e agenda | **No próprio Postgres** (ex.: pg-boss) | Menos peças para operar (sem Redis). O volume atual é pequeno | Redis + BullMQ |
| D8 | Stack | **TypeScript/Node + Postgres + painel web, em Docker na VPS** (premissa) | Mesma linguagem do Evolution e do n8n. Ajusto para a stack do Dex Provider se ela for outra | — |
| D9 | IA | **Provedor plugável** (OpenAI hoje), com chave por workspace | Cada cliente paga o próprio consumo, e trocar de modelo não exige reescrever nada | Acoplar a um provedor |

---

## 3. Arquitetura

```
                ┌──────────────────────── DEX AUTOMATION ────────────────────────┐
 Operador ────► │  Painel web ──► API ◄──────────── webhooks do Dex Provider ◄─┐ │
                │                  │                (respostas, status)        │ │
                │  Agenda (cron) ──┼──► Fila (Postgres)                        │ │
                │                  ▼                                           │ │
                │       ┌───── Motor de execução (worker) ─────┐               │ │
                │       │ 1. PREPARAÇÃO                        │               │ │
                │       │    fontes → filtros → cruzamento     │               │ │
                │       │    → composição (template | IA)      │               │ │
                │       │    → validação → [aprovação]         │               │ │
                │       │ 2. DISPARO                           │               │ │
                │       │    fila por número · ritmo · janela  │               │ │
                │       └───────────────┬──────────────────────┘               │ │
                │   Postgres: automações, execuções, mensagens,                │ │
                │             contatos, opt-out, auditoria                     │ │
                └─────────┬─────────────┼──────────────────────────────────────┼─┘
                          │             │ HTTP + token                         │
       Google Sheets ◄────┤             ▼                                      │
       LLM (OpenAI…) ◄────┘       DEX PROVIDER ────────────────────────────────┘
                                        │
                                  Evolution API → WhatsApp
```

| Componente | Papel |
|---|---|
| Painel web | Lista de automações, ligar/pausar, "rodar agora", prévia (dry-run), aprovação, histórico de execuções e mensagens |
| API | Cadastro e disparo manual; recebe os webhooks do Dex Provider |
| Agenda | Dispara execuções no horário, com fuso (`America/Sao_Paulo`) |
| Worker | Executa as etapas; escala horizontalmente se for preciso |
| Conectores | Sheets (fonte), Dex Provider (canal), LLM (composição). O Drive entra depois, como fonte e destino |

---

## 4. Como uma execução acontece

```
Quarta 10:00 ─► Execução #N criada
 │
 ├─ GUARDAS: automação ativa? chave "ON" na planilha? número conectado no Dex Provider?
 │           Se alguma falhar, a execução é abortada e um alerta é disparado. Nada é enviado.
 │
 ├─ PREPARAÇÃO (minutos)
 │    ler abas ─► validar cabeçalhos (se alguém renomeou uma coluna, para aqui)
 │    ─► normalizar telefones (E.164) ─► remover quem não tem número, duplicados e opt-out
 │    ─► cruzar preferências × produtos da semana
 │    ─► compor com IA a partir de: apelido, produtos (já com gênero), observação,
 │        saudação calculada, variação sorteada, últimas 2 mensagens ENVIADAS
 │    ─► validar (regras) ─► se reprovar, regera 1x ─► se reprovar de novo, "precisa revisão"
 │    Resultado: mensagens "prontas"; cada contato pulado fica com o motivo registrado
 │
 ├─ [opcional] APROVAÇÃO no painel (F2: prévia enviada para o WhatsApp do dono)
 │
 └─ DISPARO (fila do número)
      para cada mensagem: checar número (exists=true) ─► enviar
      intervalo aleatório (ex.: 40–120 s) · só dentro da janela (ex.: 9h–19h)
      status: enviada | falhou (motivo). Só "enviada" entra no histórico
      se a taxa de falha passar do limite ou o número desconectar: pausa + alerta
```

**Garantias**
- **Idempotência:** chave `automação + contato + período` (ex.: semana ISO). Reexecutar na mesma semana não reenvia para quem já recebeu.
- **Retomada:** se o servidor cair no meio, o disparo continua de onde parou.
- **Rastreabilidade:** cada mensagem guarda os dados de entrada, a versão do prompt, a saída da IA, o resultado das validações e a resposta do provedor.

---

## 5. Receitas e etapas

Uma automação é formada por **gatilho + fontes + sequência de etapas**. Receitas são automações pré-montadas: o operador só preenche os campos.

### Etapas

| Etapa | Fase | O que faz |
|---|---|---|
| `fonte.planilha` | F1 | Lê uma aba do Sheets com mapeamento de colunas e validação de cabeçalho |
| `filtrar` | F1 | Condições simples (vazio/igual/contém), opt-out, teto de frequência |
| `cruzar` | F1 | Cruza um campo-lista do contato com outra fonte (preferências × produtos), normalizando acentos, caixa e espaços e considerando sinônimos |
| `compor.ia` | F1 | Prompt + contexto calculado + histórico, com saída estruturada |
| `validar` | F1 | Regras determinísticas: nº de emojis, termos proibidos, só produtos da lista, diferente da última mensagem |
| `enviar.whatsapp` | F1 | Envia via Dex Provider, com checagem de número e ritmo |
| `compor.template` | F2 | Texto com variáveis (`{{apelido}}`) e variações sorteadas. Sem IA, custo zero |
| `aprovar` | F2 | Segura as mensagens até alguém aprovar |
| `fonte.contatos` | F2 | Lista nativa de contatos, com tags |
| `esperar` / `se_respondeu` | F3 | Sequências e follow-up |
| `drive.*` | F3 | Ler e salvar arquivos no Google Drive |

### Receitas previstas

| Receita | Exemplo | Fase |
|---|---|---|
| Disparo recorrente personalizado com IA | FIT&LOW semanal | F1 |
| Disparo em massa com template | Aviso, promoção, cardápio | F2 |
| Sequência / follow-up | Msg 1 → 3 dias → se não respondeu, msg 2 | F3 |
| Datas | Aniversário, recompra após X dias | F3 |
| Gatilho externo | Webhook de formulário/CRM → mensagem | F3 |

---

## 6. Exemplo: o fluxo FIT&LOW na nova ferramenta

```yaml
nome: FIT&LOW – Disparo semanal
workspace: fitlow
gatilho: { agenda: "quarta 10:00", fuso: America/Sao_Paulo }
guardas:
  chave_planilha: { aba: Status, coluna: Status, valor: "ON" }   # mantém o liga/desliga atual
fontes:
  clientes:
    planilha: "Automação - Disparo"
    aba: Clientes
    colunas: { nome: Nome, telefone: Número, preferencias: Preferências, observacao: Observação }
  produtos:
    planilha: "Automação - Disparo"
    aba: Produtos
    colunas: { nome: "Produtos da Semana" }
etapas:
  - filtrar: { telefone: preenchido, opt_out: false }
  - cruzar:  { lista: clientes.preferencias, com: produtos.nome, saida: produtos_match }
  - filtrar: { produtos_match: nao_vazio }         # sem match = pulado, com motivo registrado
  - compor.ia:
      prompt: georgia-v4                           # enxuto: só persona, tom e estilo
      contexto: [apelido, produtos_match, observacao, saudacao, variacao, ultimas_mensagens: 2]
  - validar: { max_emojis: 2, proibidos: ["—"], somente_produtos_de: produtos }
  - enviar.whatsapp:
      numero: fitlow                               # instância no Dex Provider
      intervalo: 40-120s
      janela: "09:00-19:00"
```

O operador não escreve YAML: o painel gera isso a partir de um formulário. O YAML aparece aqui só para mostrar o que fica guardado.

---

## 7. Integração com o Dex Provider

A Dex Automation **não fala com o Evolution direto** e **não guarda a chave do Evolution**. Por workspace, ela guarda apenas um token do Dex Provider e o ID da instância (número).

Contrato mínimo necessário (a confirmar com o que o Dex Provider já expõe):

| Necessidade | Chamada (ilustrativa) | Fase |
|---|---|---|
| Listar números e status (conectado?) | `GET /instances` | F1 |
| Verificar se os números têm WhatsApp | `POST /instances/{id}/check-numbers` → `[{number, exists, jid}]` | F1 |
| Enviar texto | `POST /instances/{id}/messages/text` `{to, text, idempotencyKey}` → `{messageId}` | F1 |
| Webhook de mensagem recebida | `POST {dex-automation}/webhooks/provider` | F2 (opt-out, follow-up) |
| Webhook de status (entregue/lida) | mesmo endpoint | F2 (métricas) |
| Enviar mídia | `POST /instances/{id}/messages/media` | F3 |

**Ponto em aberto: quem controla o ritmo por número?** Se outras ferramentas também enviarem pelo mesmo número através do Dex Provider, o limite precisa morar no Provider, porque só ele vê todo o tráfego do número. Na v1, a Dex Automation controla o próprio ritmo; se o Provider já tiver fila ou limite, uso o dele.

---

## 8. Modelo de dados (essencial)

```
Workspace ─┬─ Conexao        dex_provider (token), google, llm — credenciais criptografadas
           ├─ Contato        telefone E.164, nome, apelido, atributos, tags, opt_out
           ├─ Automacao      receita, gatilho, etapas (JSON), status, modo auto|revisão
           │   └─ Execucao   status, início/fim, funil: lidos → válidos → match → gerados → enviados
           │       └─ Mensagem  contato, texto, status, motivo, chave_idempotencia,
           │                    versao_prompt, validacoes, variacao_usada,
           │                    provider_message_id, enviada_em
           ├─ OptOut
           └─ Auditoria      quem ligou, pausou, editou ou aprovou
```

`Mensagem` com status `enviada` substitui o `chatMemory`: é de lá que saem as últimas mensagens de cada contato e as variações já usadas.

---

## 9. Entregabilidade (anti-bloqueio)

O Evolution usa a API **não oficial** do WhatsApp. Se o número for banido, a ferramenta deixa de servir para aquele cliente. Por isso a entregabilidade é requisito central, e não detalhe:

- Intervalo **aleatório** entre mensagens. Hoje ele é fixo em 61 s, um padrão fácil de detectar.
- Janela de horário e dias permitidos. O que não couber na janela segue no próximo período.
- Limite diário por número e **teto de frequência por contato, somando todas as automações** (ex.: no máximo 1 disparo de marketing a cada 3 dias).
- Opt-out global por workspace ("SAIR", "PARAR"), que depende do webhook de entrada.
- Checagem de número conectado antes e durante o disparo, com pausa automática se ele cair.
- Pausa automática se a taxa de falha passar de um limite.
- Simulação de "digitando…", se o Provider suportar.

---

## 10. O que muda em relação ao fluxo n8n atual

| Hoje | Efeito | No Dex Automation |
|---|---|---|
| A memória é gravada **antes** de verificar o número e enviar | Uma falha de envio vira "mensagem anterior" fantasma | O histórico só registra mensagens `enviada` |
| O Agent já grava na memória e o Memory Manager grava de novo | Histórico provavelmente duplicado (vale conferir a tabela) | Uma fonte de verdade: a tabela `Mensagem` |
| `verificaNumero` não checa `exists` | O fluxo tenta enviar para número sem WhatsApp | Só envia com `exists=true`; se não, pula e registra o motivo |
| O número é montado como `"55" + dígitos` | Um número que já tem 55 vira `5555…` | Normalização E.164 |
| Não há idempotência | Reexecutar o fluxo manda de novo para todo mundo | Chave por contato e período |
| Clientes sem match são descartados antes da IA | As regras "SEM MATCH" do prompt nunca são usadas, mas os tokens são pagos | Prompt enxuto; o comportamento sem match vira configuração explícita |
| O prompt manda "consultar a tool chatMemory" | A memória não é uma tool no n8n: ela é injetada no contexto, e funciona por acaso | O histórico entra explicitamente no contexto |
| Saudação, concordância, variação e emojis ficam com a IA, mais a tool Think | Mais chamadas, mais custo e erros ocasionais | Tudo calculado em código; a IA só redige |
| O cruzamento é por texto exato | Grafias diferentes do mesmo produto não casam | Normalização + sinônimos (F1), depois catálogo de produtos com gênero (F2) |
| Quem não tem número ou não casa com nenhum produto some em silêncio | Ninguém percebe o cliente esquecido | Relatório de qualidade em cada execução |
| A chave do Evolution está fixa nos nós HTTP | Ela vaza junto com todo JSON exportado | A credencial fica só no Dex Provider |
| O timeout da IA é de ~7 dias | Uma execução pode travar indefinidamente | Timeout curto + retry |

Na planilha atual (34 clientes), encontrei:
- 2 clientes sem número;
- 1 nome duplicado;
- 1 campo de Preferências com uma frase livre, que quebra a separação por vírgula;
- o mesmo produto escrito de 3 formas diferentes;
- observações com texto "da semana" gravado de forma fixa ("acabamos de fazer uma fornada…"), que a IA vai repetir toda semana como se fosse verdade.

Para personalizar bem, a **estrutura dos dados** pesa tanto quanto o prompt. Proposta para a F2: um catálogo de produtos (nome, sinônimos, gênero, *semanal* ou *fixo*) e a separação entre "perfil permanente" e "contexto desta semana".

---

## 11. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Banimento do número (API não oficial) | Média | Alto | §9. No longo prazo, o Dex Provider suportar a API oficial (Cloud API) como alternativa |
| Contrato do Dex Provider ainda desconhecido | Alta | Alto | A F0 fecha o contrato antes de codar a integração |
| Escopo virar "um n8n próprio" | Alta | Alto | Receitas; canvas visual fora do escopo até haver demanda comprovada |
| Qualidade dos dados da planilha | Alta | Médio | Validação + relatório por execução + catálogo |
| IA enviar algo errado para um cliente real | Média | Médio | Validação determinística + modo revisão + modo sombra na migração |
| Você virar suporte de N clientes | Média | Médio | Funil por execução e alertas automáticos |
| LGPD (dados pessoais + marketing) | Média | Médio | Opt-out, retenção de logs, isolamento por workspace |

---

## 12. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F0** | Respostas da §13 + contrato do Dex Provider fechado | Contrato documentado |
| **F1 – MVP** | Motor + agenda + fonte Sheets + `cruzar` + `compor.ia` + `validar` + envio via Provider + idempotência + funil/log + painel mínimo (automações, ligar/pausar, rodar agora, prévia, execuções, mensagens) | O FIT&LOW roda **em modo sombra** por 1–2 semanas (gera sem enviar, lado a lado com o n8n) e depois substitui o n8n |
| **F2** | Aprovação humana, `compor.template` (disparo em massa), webhook de entrada + opt-out, catálogo de produtos, contatos nativos + tags, alertas | Um segundo cliente rodando |
| **F3** | Sequências/follow-up, gatilhos externos, datas, mídia, Google Drive | — |
| **F4** | Só se virar produto: autoatendimento, cobrança, permissões finas | — |

---

## 13. Perguntas em aberto

1. **Dex Provider:** ele tem API HTTP? Quais endpoints existem hoje (enviar, checar número, status)? Como é a autenticação? Ele consegue enviar webhook de mensagens recebidas? Tem fila ou limite de envio próprio? Em que stack é feito e onde roda?
2. **Quem opera:** só a NVR, para vários clientes, ou o cliente final também vai usar o painel?
3. **Objetivo:** ferramenta interna da agência ou produto para vender?
4. **Planilha:** ela continua sendo a interface do cliente, ou posso planejar a migração para o painel?
5. **Clientes sem match:** é intencional que quem só gosta de itens do cardápio fixo (ex.: quiches) nunca receba mensagem?
6. **Custo:** qual é a restrição de custo (infra, IA, desenvolvimento)?
