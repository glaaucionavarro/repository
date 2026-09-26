/** @jsxImportSource hono/jsx */
import { mascarar } from '../../lib/cripto.js';
import { formatarDataHora } from '../../lib/tempo.js';
import { descreverCron } from '../../worker/agenda.js';
import { Aviso, Layout, Recado, Selo } from '../componentes.js';
import type { Automacao, Workspace } from '../consultas.js';

export const ListaWorkspaces = (p: {
  workspaces: (Workspace & { automacoes: number; ativas: number })[];
  ok?: string;
  erro?: string;
  valores?: { nome?: string; slug?: string; fuso?: string };
}) => (
  <Layout titulo="Clientes">
    <h1>Clientes</h1>
    <Recado ok={p.ok} erro={p.erro} />
    {p.workspaces.length === 0 ? (
      <Aviso>Nenhum cliente ainda. Crie o primeiro abaixo.</Aviso>
    ) : (
      <div class="tabela">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Automações</th>
              <th>Chave de IA</th>
              <th>Fuso</th>
            </tr>
          </thead>
          <tbody>
            {p.workspaces.map((w) => (
              <tr>
                <td>
                  <a href={`/w/${w.slug}`}>{w.nome}</a> <span class="suave pequeno">/{w.slug}</span>
                </td>
                <td>
                  {w.automacoes} <span class="suave">({w.ativas} ativas)</span>
                </td>
                <td>{w.llm_chave_cifrada ? <Selo status="ativa" /> : <span class="selo alerta">faltando</span>}</td>
                <td class="suave">{w.fuso}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    <h2>Novo cliente</h2>
    <form method="post" action="/workspaces" class="cartao">
      <div class="linha">
        <div>
          <label for="nome">Nome</label>
          <input id="nome" type="text" name="nome" required value={p.valores?.nome ?? ''} placeholder="Confeitaria Exemplo" />
        </div>
        <div>
          <label for="slug">
            Identificador <span class="dica">(opcional; letras, números e hífen)</span>
          </label>
          <input id="slug" type="text" name="slug" value={p.valores?.slug ?? ''} placeholder="confeitaria-exemplo" />
        </div>
        <div>
          <label for="fuso">Fuso horário</label>
          <input id="fuso" type="text" name="fuso" value={p.valores?.fuso ?? 'America/Sao_Paulo'} />
        </div>
      </div>
      <p>
        <button class="primario" type="submit">
          Criar cliente
        </button>
      </p>
    </form>
  </Layout>
);

export const PaginaWorkspace = (p: {
  ws: Workspace;
  chave: string | null;
  automacoes: (Automacao & { ultima_status: string | null; ultima_em: Date | null; ultima_id: string | null })[];
  ok?: string;
  erro?: string;
}) => (
  <Layout titulo={p.ws.nome}>
    <div class="migalha">
      <a href="/workspaces">Clientes</a> ›
    </div>
    <h1>{p.ws.nome}</h1>
    <Recado ok={p.ok} erro={p.erro} />

    <h2>Automações</h2>
    {p.automacoes.length === 0 ? (
      <Aviso>Nenhuma automação ainda.</Aviso>
    ) : (
      <div class="tabela">
        <table>
          <thead>
            <tr>
              <th>Automação</th>
              <th>Situação</th>
              <th>Agenda</th>
              <th>Última execução</th>
            </tr>
          </thead>
          <tbody>
            {p.automacoes.map((a) => (
              <tr>
                <td>
                  <a href={`/a/${a.id}`}>{a.nome}</a>
                </td>
                <td>
                  <Selo status={a.ativa ? 'ativa' : 'pausada'} /> <Selo status={a.modo_envio} />
                </td>
                <td>{descreverCron(a.agenda_cron)}</td>
                <td>
                  {a.ultima_id ? (
                    <>
                      <a href={`/e/${a.ultima_id}`}>{formatarDataHora(a.ultima_em, p.ws.fuso)}</a>{' '}
                      <Selo status={a.ultima_status!} />
                    </>
                  ) : (
                    <span class="suave">nunca rodou</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    <p>
      <a class="botao primario" href={`/w/${p.ws.slug}/automacoes/nova`}>
        Nova automação
      </a>
    </p>

    <h2>Chave de IA (OpenAI)</h2>
    <div class="cartao">
      <p class="pequeno suave">
        Cada cliente usa a própria chave, então o consumo sai na conta dele. A chave é guardada cifrada.
      </p>
      {p.chave ? (
        <p>
          Configurada: <code>{mascarar(p.chave)}</code>
        </p>
      ) : (
        <Aviso tipo="erro">Sem chave: as automações deste cliente não conseguem rodar.</Aviso>
      )}
      <form method="post" action={`/w/${p.ws.slug}/ia`}>
        <label for="chave">{p.chave ? 'Trocar chave' : 'Chave'}</label>
        <input id="chave" type="password" name="chave" autocomplete="off" placeholder="sk-..." required />
        <p>
          <button type="submit">Salvar chave</button>
        </p>
      </form>
    </div>
  </Layout>
);
