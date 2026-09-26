# Dex Automation — Desenho da solução (v0.2)

> **Status:** aprovado. **F1a implementada** (modo sombra); veja o README para uso e deploy.
> **O que mudou desde a v0.1:** entraram as respostas sobre operação (operador único, vários clientes), objetivo (ferramenta interna, a NVR vende a implantação), relatório para o cliente e integração com o Dex Provider (API a criar, se não existir).

---

## 1. O que é

Ferramenta **interna da NVR** para automações de mensagens via WhatsApp, operando sobre o Dex Provider.

- **Um operador** (você) atende **vários clientes**, cada um num *workspace* isolado.
- **O cliente não acessa a ferramenta.** Ele recebe relatórios: WhatsApp agora, PDF depois.
- **Primeiro caso de uso:** portar o fluxo n8n *FIT&LOW – Disparo Mensagens*.

**Não é:**
- editor visual de nós estilo n8n;
- chatbot/atendimento;
- gerenciador de conexão WhatsApp (esse papel é do Dex Provider);
- produto SaaS: não tem login de cliente, cobrança nem autoatendimento.

**Métricas que guiam as prioridades:**
1. **Tempo para colocar um cliente novo no ar.** Como você vende implantação, isso é margem.
2. **Tempo que você gasta por cliente por semana.** A ferramenta fica em silêncio quando tudo dá certo e só chama você nas exceções.

---

## 2. Decisões principais

| # | Decisão | Proposta | Por quê |
|---|---|---|---|
| D1 | Como se monta uma automação | **Receitas + etapas configuráveis** (formulário), sem canvas visual | 80% dos casos são "ler lista → filtrar → compor → enviar". Um canvas leva meses e compete com o n8n |
| D2 | Execução | **Três fases: Preparação → Disparo → Relatório** | Permite prévia, modo sombra e reenvio sem pagar a IA de novo; o relatório sai do mesmo registro |
| D3 | Onde fica a lógica | **O código decide, a IA escreve** | Saudação, cruzamento, concordância, variação e emojis são regras. Em código saem exatas e baratas |
| D4 | Memória de mensagens | **Log próprio das mensagens enviadas**, com gravação só depois do envio confirmado | Elimina o histórico "fantasma" do fluxo atual |
| D5 | Clientes e acesso | **Workspaces isolados, um login de administrador**, sem permissões | Reflete a operação real: só você usa |
| D6 | Fonte de dados | **Google Sheets como conector**, com validação | A rotina do cliente não muda |
| D7 | Fila e agenda | **No próprio Postgres**, sobre a tabela de execuções (`FOR UPDATE SKIP LOCKED`) | Menos peças para operar; a execução já é o "job". Troca feita na F1a: pg-boss não era necessário |
| D8 | Canal WhatsApp | **Atrás de um adaptador:** simulado / Dex Provider / Evolution direto | O motor não depende de o Dex Provider estar pronto (§7) |
| D9 | IA | **Provedor plugável, com chave por workspace**, e custo registrado por execução | O cliente paga o próprio consumo, e você sabe quanto cada cliente custa |
| D10 | Relatórios | **Resumo por WhatsApp, enviado do número da NVR**; PDF na F2 | O relatório é a prova de valor que o cliente vê (§8) |
| D11 | Stack e hospedagem | **TypeScript/Node + Postgres + painel web. Produção na Vercel (Pro) com Postgres Neon**; Docker continua suportado | Vercel é onde a NVR já publica. Sem processo contínuo, agenda e fila viram um cron por minuto (`/tarefas/tick`) e as execuções pausam/retomam dentro do limite de tempo das funções |

---

## 3. Arquitetura

```
                ┌──────────────────────── DEX AUTOMATION ─────────────────────────┐
  Você ───────► │  Painel web ──► API ◄───────────── webhooks (F2) ◄────────────┐ │
                │                  │                                            │ │
                │  Agenda (cron) ──┼──► Fila (Postgres)                         │ │
                │                  ▼                                            │ │
                │       ┌───── Motor de execução (worker) ─────┐                │ │
                │       │ 1. PREPARAÇÃO  ler, filtrar, cruzar, │                │ │
                │       │                compor, validar       │                │ │
                │       │ 2. DISPARO     fila por número,      │                │ │
                │       │                ritmo, janela         │                │ │
                │       │ 3. RELATÓRIO   cliente + operador    │                │ │
                │       └───────────────┬──────────────────────┘                │ │
                │                       ▼                                       │ │
                │            Canal WhatsApp (adaptador)                         │ │
                │     simulado │ Dex Provider (alvo) │ Evolution (plano B)      │ │
                │                                                               │ │
                │  Postgres: workspaces, automações, execuções, mensagens,      │ │
                │            contatos, opt-out, registro de ações               │ │
                └─────────┬───────────────────┼─────────────────────────────────┼─┘
                          │                   ▼                                 │
       Google Sheets ◄────┤             DEX PROVIDER ───────────────────────────┘
       LLM (OpenAI…) ◄────┘                   │
                                        Evolution API → WhatsApp
```

---

## 4. Como uma execução acontece

```
Quarta 10:00 ─► Execução #N criada
 │
 ├─ GUARDAS: automação ativa? chave "ON" na planilha? número conectado?
 │           Se alguma falhar, a execução é abortada e você recebe um alerta. Nada é enviado.
 │
 ├─ 1. PREPARAÇÃO (minutos)
 │    ler abas ─► validar cabeçalhos (se alguém renomeou uma coluna, para aqui)
 │    ─► normalizar telefones (E.164) ─► tirar quem não tem número, duplicados e opt-out
 │    ─► cruzar preferências × produtos da semana ─► sem match = pulado (com motivo)
 │    ─► compor com IA a partir de: apelido, produtos (já com gênero), observação,
 │        saudação calculada, variação sorteada, últimas 2 mensagens ENVIADAS
 │    ─► validar ─► se reprovar, regera 1x ─► se reprovar de novo, "precisa revisão" (não envia)
 │
 ├─ 2. DISPARO (fila do número)
 │    para cada mensagem: checar número (exists=true) ─► enviar
 │    intervalo aleatório (ex.: 40–120 s) · só dentro da janela (ex.: 9h–19h)
 │    status: enviada | falhou (motivo). Só "enviada" entra no histórico
 │    se a taxa de falha passar do limite ou o número desconectar: pausa + alerta
 │
 └─ 3. RELATÓRIO
      para o cliente: resumo por WhatsApp (§8)
      para você: só se houver exceção
```

**Garantias**
- **Idempotência:** chave `automação + contato + período` (semana ISO). Reexecutar na mesma semana não reenvia para quem já recebeu.
- **Retomada:** se o servidor cair no meio, o disparo continua de onde parou.
- **Rastreabilidade:** cada mensagem guarda os dados de entrada, a versão do prompt, a saída da IA, o resultado das validações, a resposta do provedor e o custo.

---

## 5. Receitas e etapas

Uma automação é formada por **gatilho + fontes + etapas + relatório**. Receitas são automações pré-montadas: para implantar um cliente novo, você **clona uma receita** e ajusta planilha, prompt e número.

### Etapas

| Etapa | Fase | O que faz |
|---|---|---|
| `fonte.planilha` | F1a | Lê uma aba do Sheets com mapeamento de colunas e validação de cabeçalho |
| `filtrar` | F1a | Condições simples, opt-out, teto de frequência |
| `cruzar` | F1a | Cruza um campo-lista do contato com outra fonte, normalizando acentos, caixa e espaços e considerando sinônimos |
| `compor.ia` | F1a | Prompt + contexto calculado + histórico |
| `validar` | F1a | Regras determinísticas: emojis, termos proibidos, só produtos da lista, diferente da última mensagem |
| `enviar.whatsapp` | F1b | Envia pelo adaptador de canal, com checagem de número e ritmo |
| `relatorio.whatsapp` | F1b | Resumo da execução para o cliente |
| `compor.template` | F2 | Texto com variáveis e variações sorteadas. Sem IA, custo zero |
| `aprovar` | F2 | Segura as mensagens até alguém aprovar (você, ou o cliente por WhatsApp) |
| `relatorio.pdf` | F2 | Relatório em PDF, por execução ou mensal |
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
  - filtrar: { produtos_match: nao_vazio }         # confirmado: só quem tem match recebe
  - compor.ia:
      prompt: fitlow-v4                            # enxuto: só persona, tom e estilo
      contexto: [apelido, produtos_match, observacao, saudacao, variacao, ultimas_mensagens: 2]
  - validar: { max_emojis: 2, proibidos: ["—"], somente_produtos_de: produtos }
  - enviar.whatsapp:
      numero: fitlow
      intervalo: 40-120s
      janela: "09:00-19:00"
relatorio:
  whatsapp: { de: nvr, para: [dono_do_negocio] }
```

Você não escreve YAML: o painel gera isso a partir de um formulário. O YAML aparece aqui só para mostrar o que fica guardado.

---

## 7. Integração com o Dex Provider

**Situação:** ainda não se sabe se o Dex Provider expõe uma API. Por isso o motor depende só de uma interface `CanalWhatsApp`, com três implementações:

| Adaptador | Uso | Observação |
|---|---|---|
| **Simulado** | Modo sombra e testes | Registra o que seria enviado e não envia nada |
| **Dex Provider** | **Alvo** | Precisa da API abaixo. Se ela não existir, criamos dentro do Dex Provider |
| **Evolution direto** | Plano B | Só se criar a API no Dex Provider atrasar. Custo: a chave do Evolution passa a ficar também na Dex Automation, e o controle de ritmo por número deixa de ser central |

**Por que a API no Dex Provider é o melhor caminho:**
- Só ele vê **todo o tráfego do número**, então o limite anti-bloqueio fica num lugar só.
- As credenciais do Evolution ficam **em um único serviço**.
- Ele recebe os webhooks do Evolution e **repassa para quem precisar**: a Dex Automation hoje, um atendimento ou chatbot amanhã.

### Contrato proposto

| Necessidade | Chamada (ilustrativa) | Fase |
|---|---|---|
| Listar números e status | `GET /instances` | F1b |
| Verificar se os números têm WhatsApp | `POST /instances/{id}/check-numbers` → `[{number, exists, jid}]` | F1b |
| Enviar texto | `POST /instances/{id}/messages/text` `{to, text, idempotencyKey}` → `{messageId}` | F1b |
| Repassar mensagem recebida | Webhook `message.received` → Dex Automation (assinado com HMAC) | F2 |
| Repassar status (entregue/lida) | Webhook `message.status` | F2 |
| Enviar mídia | `POST /instances/{id}/messages/media` | F3 |

Autenticação: token de serviço no header, sempre por HTTPS.

**Dependência:** para criar essa API é preciso o código do Dex Provider. Isso bloqueia **só a F1b**. A F1a roda inteira com o adaptador simulado.

---

## 8. Relatórios

**Para o cliente, por WhatsApp (F1b)**, enviado do número da NVR ao dono do negócio depois de cada execução. Exemplo ilustrativo:

```
FIT&LOW · Disparo de quarta (01/10)
Produtos da semana: 3
✅ Enviadas: 22 de 34 clientes

Não enviadas: 12
• 9 não têm produto da semana nas preferências
• 2 sem número na planilha (linhas 26 e 35)
• 1 número sem WhatsApp (linha 12)
```

O relatório mostra que o serviço está funcionando **e diz o que corrigir na planilha**. Assim a qualidade dos dados melhora sem você intermediar.

**Para o cliente, em PDF (F2):** o mesmo conteúdo, mais as mensagens enviadas e um consolidado mensal.

**Para você:** só nas exceções. Execução abortada, número desconectado, taxa de falha alta, IA reprovada várias vezes, planilha com coluna renomeada. Quando dá tudo certo, silêncio.

---

## 9. Modelo de dados (essencial)

```
Workspace ─┬─ Conexao        dex_provider (token), google, llm — credenciais criptografadas
           ├─ Contato        telefone E.164, nome, apelido, atributos, tags, opt_out
           ├─ Automacao      receita, gatilho, etapas (JSON), relatório, status
           │   └─ Execucao   status, início/fim, funil (lidos → válidos → match → gerados
           │                 → enviados), custo_ia, relatório_enviado
           │       └─ Mensagem  contato, texto, status, motivo, chave_idempotencia,
           │                    versao_prompt, validacoes, variacao_usada, custo,
           │                    provider_message_id, enviada_em
           ├─ OptOut
           └─ RegistroAcao   ligou, pausou, editou, rodou manualmente (com data)
```

---

## 10. Entregabilidade (anti-bloqueio)

O Evolution usa a API **não oficial** do WhatsApp. Se o número for banido, a ferramenta deixa de servir para aquele cliente.

- Intervalo **aleatório** entre mensagens, no lugar dos 61 s fixos de hoje.
- Janela de horário e dias permitidos.
- Limite diário por número e **teto de frequência por contato, somando todas as automações**.
- Opt-out global por workspace ("SAIR", "PARAR"), que depende do webhook de entrada (F2).
- Checagem de número conectado antes e durante o disparo, com pausa automática.
- Pausa automática se a taxa de falha passar de um limite.

---

## 11. O que muda em relação ao fluxo n8n atual

| Hoje | Efeito | No Dex Automation |
|---|---|---|
| A memória é gravada **antes** de verificar o número e enviar | Uma falha vira "mensagem anterior" fantasma | O histórico só registra mensagens `enviada` |
| O Agent grava na memória e o Memory Manager grava de novo | Histórico provavelmente duplicado | Uma fonte de verdade |
| `verificaNumero` não checa `exists` | O fluxo tenta enviar para número sem WhatsApp | Só envia com `exists=true` |
| O número é montado como `"55" + dígitos` | Um número que já tem 55 vira `5555…` | Normalização E.164 |
| Não há idempotência | Reexecutar o fluxo manda de novo para todo mundo | Chave por contato e período |
| O prompt tem regras "SEM MATCH", mas esses clientes são filtrados antes | Tokens pagos à toa | Regras removidas; o comportamento (só quem tem match recebe) foi mantido |
| O prompt manda "consultar a tool chatMemory" | Funciona por acaso | O histórico entra explicitamente no contexto |
| Saudação, concordância, variação e emojis ficam com a IA, mais a tool Think | Mais custo e erros ocasionais | Tudo calculado em código |
| O cruzamento é por texto exato | Grafias diferentes do mesmo produto não casam | Normalização + sinônimos |
| Quem é pulado some em silêncio | Ninguém percebe | Aparece no relatório, com o motivo |
| A chave do Evolution está fixa nos nós HTTP | Ela vaza junto com todo export | A credencial fica só no Dex Provider |
| O timeout da IA é de ~7 dias | Uma execução pode travar indefinidamente | Timeout curto + retry |

---

## 12. Migração do FIT&LOW

1. **Importar o histórico do n8n** (tabela `disparos_fit_e_low`) como mensagens anteriores. Assim a primeira execução real já varia em relação à última mensagem que o n8n mandou.
2. **Modo sombra por 1–2 quartas:** o n8n continua enviando de verdade, a Dex Automation gera em paralelo e você compara as mensagens no painel.
3. **Virada:** o n8n é desativado e o envio real é ativado. O fluxo n8n fica desligado, sem ser apagado, por 1 mês, como volta rápida.

---

## 13. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Banimento do número (API não oficial) | Média | Alto | §10. No longo prazo, o Dex Provider suportar a API oficial |
| Código do Dex Provider indisponível | Média | Alto | O adaptador isola o problema: a F1a não depende dele, e existe o plano B |
| **Operador único:** tudo passa por você | Alta | Alto | Alertas só em exceção, relatório que orienta o cliente a corrigir a planilha, runbook por cliente |
| **Receita pontual × custo recorrente:** a implantação é vendida uma vez, mas VPS, IA, suporte e risco de bloqueio são mensais | Alta | Médio | Chave de IA por cliente e custo medido por execução, para embasar uma mensalidade de operação |
| Escopo virar "um n8n próprio" | Alta | Alto | Receitas; editor visual fora do escopo |
| IA enviar algo errado para um cliente real | Média | Médio | Validação determinística + modo sombra |
| LGPD | Média | Médio | Opt-out, retenção de logs, isolamento por workspace |

---

## 14. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F1a – Motor em modo sombra** | Motor, agenda, fonte Sheets, `cruzar`, `compor.ia`, `validar`, canal simulado, funil e log, custo por execução, importação do histórico do n8n, painel mínimo (login, workspaces, automações, ligar/pausar, rodar agora, prévia, execuções, mensagens) | O FIT&LOW gera em sombra toda quarta com qualidade igual ou melhor que a do n8n |
| **F1b – Envio real** | API no Dex Provider (ou plano B), adaptador real, checagem de número, fila com ritmo e janela, relatório por WhatsApp, alertas | n8n do FIT&LOW desligado |
| **F2 – Escala de clientes** | Clonar receita/automação entre clientes, `compor.template`, webhook de entrada + opt-out, catálogo de produtos, relatório PDF, aprovação | Segundo cliente implantado |
| **F3** | Sequências, gatilhos externos, datas, mídia, Google Drive | — |

**Fora do escopo:** login de clientes, cobrança, autoatendimento, editor visual.

---

## 15. Pendências

| # | Pendência | Bloqueia |
|---|---|---|
| P1 | Onde está o código do Dex Provider (repositório, quem fez, URL)? | F1b |
| P2 | Hospedagem: mesma VPS do Evolution? Como é o deploy hoje (Docker, Easypanel, Portainer…)? | Deploy da F1a |
| P3 | Relatório: de qual número sai (a NVR tem número conectado no Dex Provider?) e quem recebe no cliente | F1b |
| P4 | Repositório: hoje está **público**; tornar privado antes de entrar código e prompts | F1a |
