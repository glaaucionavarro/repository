/** @jsxImportSource hono/jsx */
import { formatarTelefone } from '../../lib/telefone.js';
import { formatarDataHora } from '../../lib/tempo.js';
import { MOTIVOS } from '../../motor/itens.js';
import { Aviso, formatarDuracao, formatarUsd, Layout, Metrica, Selo } from '../componentes.js';
import type { Execucao, Mensagem } from '../consultas.js';

type ExecucaoCompleta = Execucao & { automacao_nome: string; ws_slug: string; ws_nome: string; ws_fuso: string };

const ROTULO_STATUS: Record<string, string> = {
  simulada: 'Simuladas',
  enviada: 'Enviadas',
  gerada: 'Geradas',
  precisa_revisao: 'Precisam revisão',
  falhou: 'Falharam',
  pulada: 'Puladas',
};

const Funil = ({ e }: { e: ExecucaoCompleta }) => {
  const etapas = e.funil.etapas ?? [];
  if (etapas.length === 0) return null;
  const maximo = Math.max(1, ...etapas.map((x) => x.ativos));
  return (
    <div class="cartao funil">
      {etapas.map((x) => (
        <div class="etapa">
          <span>{x.rotulo}</span>
          <div class="barra">
            <span style={`width: ${(100 * x.ativos) / maximo}%`} />
          </div>
          <strong>{x.ativos}</strong>
        </div>
      ))}
    </div>
  );
};

const Detalhes = ({ m }: { m: Mensagem }) => (
  <details>
    <summary>detalhes</summary>
    {m.tentativas?.length ? (
      <>
        <h3>Tentativas</h3>
        {m.tentativas.map((t, i) => (
          <div>
            <div class="pequeno">
              <strong>#{i + 1}</strong>{' '}
              {t.problemas.length ? <span class="selo alerta">reprovada</span> : <span class="selo ok">aprovada</span>}
            </div>
            {t.problemas.length ? (
              <ul class="pequeno">
                {t.problemas.map((x) => (
                  <li>{x}</li>
                ))}
              </ul>
            ) : null}
            <pre>{t.texto}</pre>
          </div>
        ))}
      </>
    ) : null}
    {m.variacao?.textos ? (
      <>
        <h3>Variações sorteadas</h3>
        <pre>{JSON.stringify(m.variacao.textos, null, 2)}</pre>
      </>
    ) : null}
    <h3>Dados usados</h3>
    <pre>{JSON.stringify(m.entrada, null, 2)}</pre>
    {m.modelo ? (
      <p class="suave pequeno">
        {m.modelo} · prompt {m.versao_prompt} · {m.tokens_entrada} tokens de entrada, {m.tokens_saida} de saída ·{' '}
        {formatarUsd(m.custo_usd)}
      </p>
    ) : null}
  </details>
);

export const PaginaExecucao = (p: { e: ExecucaoCompleta; mensagens: Mensagem[]; filtro?: string }) => {
  const { e } = p;
  const fuso = e.ws_fuso;
  const emAndamento = ['pendente', 'preparando', 'disparando'].includes(e.status);
  const contagem: Record<string, number> = {};
  for (const m of p.mensagens) contagem[m.status] = (contagem[m.status] ?? 0) + 1;
  const visiveis = p.filtro ? p.mensagens.filter((m) => m.status === p.filtro) : p.mensagens;
  const motivos = Object.entries(e.funil.motivos ?? {}).sort((a, b) => b[1] - a[1]);
  const prontas = (contagem.simulada ?? 0) + (contagem.enviada ?? 0) + (contagem.gerada ?? 0);

  return (
    <Layout titulo={`Execução · ${e.automacao_nome}`} atualizarEm={emAndamento ? 3 : undefined}>
      <div class="migalha">
        <a href="/workspaces">Clientes</a> › <a href={`/w/${e.ws_slug}`}>{e.ws_nome}</a> ›{' '}
        <a href={`/a/${e.automacao_id}`}>{e.automacao_nome}</a> ›
      </div>
      <h1>
        Execução de {formatarDataHora(e.agendada_para ?? e.criado_em, fuso)}{' '}
        <Selo status={e.tipo === 'agendada' ? 'agendada_tipo' : e.tipo} /> <Selo status={e.status} />
      </h1>

      {e.tipo === 'previa' ? (
        <Aviso>Prévia: nada é enviado e não conta para o período. Só os primeiros contatos elegíveis são gerados.</Aviso>
      ) : null}
      {e.motivo ? <Aviso tipo={e.status === 'falhou' ? 'erro' : 'info'}>{e.motivo}</Aviso> : null}
      {emAndamento ? <Aviso>Em andamento. A página atualiza sozinha.</Aviso> : null}

      <div class="grade">
        <Metrica rotulo={e.tipo === 'previa' ? 'Geradas' : 'Prontas (simuladas)'} valor={prontas} />
        <Metrica rotulo="Puladas" valor={contagem.pulada ?? 0} />
        <Metrica rotulo="Precisam revisão" valor={contagem.precisa_revisao ?? 0} />
        <Metrica rotulo="Falhas" valor={contagem.falhou ?? 0} />
        <Metrica rotulo="Custo da IA" valor={formatarUsd(e.custo_usd)} />
        <Metrica rotulo="Duração" valor={formatarDuracao(e.iniciada_em, e.finalizada_em)} />
      </div>

      <h2>Funil</h2>
      <Funil e={e} />
      {e.funil.previaLimitada ? (
        <p class="suave pequeno">A prévia parou nos primeiros {e.funil.previaLimitada} contatos elegíveis.</p>
      ) : null}

      {motivos.length ? (
        <>
          <h2>Por que alguns contatos foram pulados</h2>
          <div class="cartao">
            <ul>
              {motivos.map(([codigo, n]) => (
                <li>
                  {MOTIVOS[codigo] ?? codigo}: <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      <h2>Mensagens</h2>
      <div class="abas">
        <a href={`/e/${e.id}`} class={!p.filtro ? 'ativa' : ''}>
          Todas ({p.mensagens.length})
        </a>
        {Object.entries(contagem).map(([s, n]) => (
          <a href={`/e/${e.id}?status=${s}`} class={p.filtro === s ? 'ativa' : ''}>
            {ROTULO_STATUS[s] ?? s} ({n})
          </a>
        ))}
      </div>
      {visiveis.length === 0 ? (
        <p class="suave">Nada por aqui.</p>
      ) : (
        <div class="tabela empilhar">
          <table>
            <thead>
              <tr>
                <th>Linha</th>
                <th>Contato</th>
                <th>Situação</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((m) => (
                <tr>
                  <td class="suave" data-rotulo="Linha">{m.linha ?? '—'}</td>
                  <td data-rotulo="Contato">
                    {m.nome}
                    <div class="suave pequeno">{formatarTelefone(m.telefone)}</div>
                  </td>
                  <td data-rotulo="Situação">
                    <Selo status={m.status} />
                    {m.agendada_para && m.status !== 'pulada' ? (
                      <div class="suave pequeno">sairia {formatarDataHora(m.agendada_para, fuso)}</div>
                    ) : null}
                  </td>
                  <td data-rotulo="Mensagem">
                    {m.texto ? <div class="texto-msg">{m.texto}</div> : null}
                    {m.motivo ? <div class="suave pequeno">{m.motivo}</div> : null}
                    {m.status !== 'pulada' ? <Detalhes m={m} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
};
