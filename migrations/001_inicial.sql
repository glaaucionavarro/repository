-- Dex Automation: esquema inicial (F1a)

CREATE TABLE workspaces (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  nome               text NOT NULL,
  fuso               text NOT NULL DEFAULT 'America/Sao_Paulo',
  llm_chave_cifrada  text,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE automacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  receita        text NOT NULL,
  ativa          boolean NOT NULL DEFAULT false,
  ativada_em     timestamptz,
  agenda_cron    text,
  modo_envio     text NOT NULL DEFAULT 'sombra' CHECK (modo_envio IN ('sombra', 'real')),
  config         jsonb NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automacoes_workspace ON automacoes (workspace_id);

CREATE TABLE execucoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id    uuid NOT NULL REFERENCES automacoes(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('agendada', 'manual', 'previa')),
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'preparando', 'disparando', 'concluida', 'abortada', 'falhou')),
  agendada_para   timestamptz,
  periodo         text,
  tentativas      int NOT NULL DEFAULT 0,
  iniciada_em     timestamptz,
  heartbeat_em    timestamptz,
  finalizada_em   timestamptz,
  motivo          text,
  funil           jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_entrada  int NOT NULL DEFAULT 0,
  tokens_saida    int NOT NULL DEFAULT 0,
  custo_usd       numeric(12, 6) NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execucoes_automacao ON execucoes (automacao_id, criado_em DESC);
CREATE INDEX execucoes_fila ON execucoes (criado_em) WHERE status = 'pendente';
-- A agenda nunca cria duas execuções para o mesmo horário
CREATE UNIQUE INDEX execucoes_agendadas_unicas ON execucoes (automacao_id, agendada_para) WHERE tipo = 'agendada';

CREATE TABLE mensagens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automacao_id         uuid REFERENCES automacoes(id) ON DELETE CASCADE,
  execucao_id          uuid REFERENCES execucoes(id) ON DELETE CASCADE,
  origem               text NOT NULL DEFAULT 'execucao' CHECK (origem IN ('execucao', 'importada_n8n')),
  linha                int,
  nome                 text,
  telefone             text,
  status               text NOT NULL
                       CHECK (status IN ('pulada', 'gerada', 'precisa_revisao', 'falhou', 'agendada', 'simulada', 'enviada')),
  motivo_codigo        text,
  motivo               text,
  texto                text,
  entrada              jsonb,
  variacao             jsonb,
  tentativas           jsonb,
  versao_prompt        text,
  modelo               text,
  tokens_entrada       int NOT NULL DEFAULT 0,
  tokens_saida         int NOT NULL DEFAULT 0,
  custo_usd            numeric(12, 6),
  chave_idempotencia   text,
  agendada_para        timestamptz,
  enviada_em           timestamptz,
  provider_message_id  text,
  criado_em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_execucao ON mensagens (execucao_id, linha);
CREATE INDEX mensagens_historico ON mensagens (workspace_id, telefone, criado_em DESC) WHERE status = 'enviada';
-- Idempotência: um contato recebe no máximo uma mensagem por automação e período
CREATE UNIQUE INDEX mensagens_idempotencia ON mensagens (chave_idempotencia)
  WHERE status IN ('gerada', 'agendada', 'simulada', 'enviada');

CREATE TABLE opt_outs (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  telefone      text NOT NULL,
  origem        text NOT NULL DEFAULT 'manual',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, telefone)
);

CREATE TABLE registro_acoes (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  automacao_id  uuid REFERENCES automacoes(id) ON DELETE CASCADE,
  acao          text NOT NULL,
  detalhe       jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registro_acoes_automacao ON registro_acoes (automacao_id, criado_em DESC);
