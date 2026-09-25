import { formatarDataHora } from '../../lib/tempo.js';
import type { AutomacaoConfig } from '../../motor/config.js';
import { DISPARO_IA, RECEITAS, type FormDisparoIA } from '../../motor/receitas.js';
import { descreverCron } from '../../worker/agenda.js';
import { Aviso, DIAS_CURTOS, formatarUsd, Layout, Recado, Selo } from '../componentes.js';
import type { Automacao, Execucao, Workspace } from '../consultas.js';

type AutomacaoComWs = Automacao & { ws_slug: string; ws_nome: string; ws_fuso: string; ws_tem_chave: boolean };

const Migalha = ({ slug, nome }: { slug: string; nome: string }) => (
  <div class="migalha">
    <a href="/workspaces">Clientes</a> › <a href={`/w/${slug}`}>{nome}</a> ›
  </div>
);

function resumoFunil(e: Execucao): string {
  const s = e.funil.status ?? {};
  const partes: string[] = [];
  const prontas = (s.simulada ?? 0) + (s.enviada ?? 0) + (s.gerada ?? 0);
  if (prontas) partes.push(`${prontas} ${e.tipo === 'previa' ? 'geradas' : s.enviada ? 'enviadas' : 'simuladas'}`);
  if (s.pulada) partes.push(`${s.pulada} puladas`);
  if (s.precisa_revisao) partes.push(`${s.precisa_revisao} p/ revisar`);
  if (s.falhou) partes.push(`${s.falhou} falhas`);
  return partes.join(' · ') || '—';
}

export const PaginaAutomacao = (p: {
  a: AutomacaoComWs;
  config: AutomacaoConfig | null;
  erroConfig?: string;
  proximo: Date | null;
  execucoes: Execucao[];
  ok?: string;
  erro?: string;
}) => {
  const { a, config } = p;
  const contatos = config ? config.fontes[config.contatos] : undefined;
  const emAndamento = p.execucoes.some((e) => ['pendente', 'preparando', 'disparando'].includes(e.status));
  return (
    <Layout titulo={a.nome} atualizarEm={emAndamento ? 5 : undefined}>
      <Migalha slug={a.ws_slug} nome={a.ws_nome} />
      <h1>{a.nome}</h1>
      <Recado ok={p.ok} erro={p.erro} />
      {!a.ws_tem_chave ? (
        <Aviso tipo="erro">
          Este cliente não tem chave de IA. <a href={`/w/${a.ws_slug}`}>Cadastrar chave</a>
        </Aviso>
      ) : null}
      {p.erroConfig ? <Aviso tipo="erro">{p.erroConfig}</Aviso> : null}

      <div class="acoes cartao">
        <Selo status={a.ativa ? 'ativa' : 'pausada'} />
        <Selo status={a.modo_envio} />
        {a.ativa ? (
          <form method="post" action={`/a/${a.id}/pausar`}>
            <button type="submit">Pausar</button>
          </form>
        ) : (
          <form method="post" action={`/a/${a.id}/ligar`}>
            <button type="submit" class="primario">
              Ligar agenda
            </button>
          </form>
        )}
        <form method="post" action={`/a/${a.id}/rodar`}>
          <button type="submit" title="Roda agora, como se fosse o horário agendado">
            Rodar agora
          </button>
        </form>
        <form method="post" action={`/a/${a.id}/previa`}>
          <button type="submit" title="Gera mensagens para os primeiros contatos, sem contar para o período">
            Prévia
          </button>
        </form>
        {a.receita === DISPARO_IA ? (
          <a class="botao" href={`/a/${a.id}/editar`}>
            Editar
          </a>
        ) : null}
        <a class="botao" href={`/a/${a.id}/json`}>
          JSON
        </a>
      </div>

      <div class="cartao">
        <div class="linha">
          <div>
            <div class="suave pequeno">Receita</div>
            <div>{RECEITAS[a.receita]?.nome ?? 'Personalizada (JSON)'}</div>
          </div>
          <div>
            <div class="suave pequeno">Agenda</div>
            <div>{descreverCron(a.agenda_cron)}</div>
            {a.ativa && p.proximo ? (
              <div class="suave pequeno">próxima: {formatarDataHora(p.proximo, a.ws_fuso)}</div>
            ) : null}
          </div>
          {contatos ? (
            <div>
              <div class="suave pequeno">Planilha</div>
              <div>
                <a href={`https://docs.google.com/spreadsheets/d/${contatos.planilha}/edit`} target="_blank" rel="noopener">
                  abrir planilha
                </a>{' '}
                <span class="suave pequeno">(aba {contatos.aba})</span>
              </div>
            </div>
          ) : null}
          {config ? (
            <>
              <div>
                <div class="suave pequeno">IA</div>
                <div>
                  {config.composicao.modelo} <span class="suave pequeno">prompt {config.composicao.versao}</span>
                </div>
              </div>
              <div>
                <div class="suave pequeno">Janela de envio</div>
                <div>
                  {config.envio.janela.inicio}–{config.envio.janela.fim},{' '}
                  {config.envio.dias.map((d) => DIAS_CURTOS[d]).join(' ')}
                </div>
                <div class="suave pequeno">
                  intervalo {config.envio.intervaloSeg[0]}–{config.envio.intervaloSeg[1]}s
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {a.modo_envio === 'sombra' ? (
        <Aviso>
          Modo sombra: a automação lê a planilha e gera as mensagens, mas nada é enviado. O envio real chega na F1b,
          junto com o Dex Provider.
        </Aviso>
      ) : null}

      <h2>Execuções</h2>
      {p.execucoes.length === 0 ? (
        <p class="suave">Nenhuma execução ainda. Use "Prévia" para testar.</p>
      ) : (
        <div class="tabela empilhar">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Resultado</th>
                <th>Custo IA</th>
              </tr>
            </thead>
            <tbody>
              {p.execucoes.map((e) => (
                <tr>
                  <td data-rotulo="Quando">
                    <a href={`/e/${e.id}`}>{formatarDataHora(e.agendada_para ?? e.criado_em, a.ws_fuso)}</a>
                  </td>
                  <td data-rotulo="Tipo">
                    <Selo status={e.tipo === 'agendada' ? 'agendada_tipo' : e.tipo} />
                  </td>
                  <td data-rotulo="Situação">
                    <Selo status={e.status} />
                    {e.motivo ? <div class="suave pequeno">{e.motivo}</div> : null}
                  </td>
                  <td class="pequeno" data-rotulo="Resultado">{resumoFunil(e)}</td>
                  <td class="pequeno" data-rotulo="Custo IA">{formatarUsd(e.custo_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
};

const Texto = (p: { nome: keyof FormDisparoIA; rotulo: string; dica?: string; valor: string; obrigatorio?: boolean; tipo?: string }) => (
  <div>
    <label for={p.nome}>
      {p.rotulo} {p.dica ? <span class="dica">{p.dica}</span> : null}
    </label>
    <input id={p.nome} type={p.tipo ?? 'text'} name={p.nome} value={p.valor} required={p.obrigatorio} />
  </div>
);

const Dias = (p: { nome: keyof FormDisparoIA; marcados: number[] }) => (
  <div class="checks">
    {DIAS_CURTOS.map((d, i) => (
      <label>
        <input type="checkbox" name={p.nome} value={String(i)} checked={p.marcados.includes(i)} /> {d}
      </label>
    ))}
  </div>
);

export const FormAutomacao = (p: { ws: Pick<Workspace, 'slug' | 'nome'>; f: FormDisparoIA; acao: string; erro?: string; titulo: string }) => {
  const f = p.f;
  return (
    <Layout titulo={p.titulo}>
      <Migalha slug={p.ws.slug} nome={p.ws.nome} />
      <h1>{p.titulo}</h1>
      <p class="suave">{RECEITAS[DISPARO_IA]!.descricao}</p>
      {p.erro ? <Aviso tipo="erro">{p.erro}</Aviso> : null}
      <form method="post" action={p.acao}>
        <fieldset>
          <legend>Geral</legend>
          <Texto nome="nome" rotulo="Nome da automação" valor={f.nome} obrigatorio />
          <label>Dias da agenda</label>
          <Dias nome="agendaDias" marcados={f.agendaDias} />
          <div class="linha">
            <Texto nome="agendaHora" rotulo="Horário" tipo="time" valor={f.agendaHora} obrigatorio />
            <div>
              <label for="periodo">Cada contato recebe no máximo 1 mensagem por</label>
              <select id="periodo" name="periodo">
                {(['dia', 'semana', 'mes'] as const).map((v) => (
                  <option value={v} selected={f.periodo === v}>
                    {v === 'mes' ? 'mês' : v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Planilha</legend>
          <Texto
            nome="planilha"
            rotulo="Link ou ID da planilha"
            dica="(compartilhe com a conta de serviço como Leitor)"
            valor={f.planilha}
            obrigatorio
          />
          <h3>Contatos</h3>
          <div class="linha">
            <Texto nome="abaContatos" rotulo="Aba" valor={f.abaContatos} obrigatorio />
            <Texto nome="colNome" rotulo="Coluna do nome" valor={f.colNome} obrigatorio />
            <Texto nome="colTelefone" rotulo="Coluna do telefone" valor={f.colTelefone} obrigatorio />
          </div>
          <div class="linha">
            <Texto nome="colPreferencias" rotulo="Coluna de preferências" dica="(separadas por vírgula)" valor={f.colPreferencias} obrigatorio />
            <Texto nome="colObservacao" rotulo="Coluna de observação" dica="(opcional)" valor={f.colObservacao} />
            <Texto nome="colApelido" rotulo="Coluna de apelido" dica="(opcional)" valor={f.colApelido} />
          </div>
          <p class="suave pequeno">
            Sem coluna de apelido, o nome de tratamento vem de "Chamar (apenas) de X" na observação ou do primeiro nome.
          </p>
          <h3>Produtos da semana</h3>
          <div class="linha">
            <Texto nome="abaProdutos" rotulo="Aba" valor={f.abaProdutos} obrigatorio />
            <Texto nome="colProduto" rotulo="Coluna" valor={f.colProduto} obrigatorio />
          </div>
          <label for="sinonimos">
            Sinônimos <span class="dica">(um por linha: Nome no cardápio = outra grafia; mais uma)</span>
          </label>
          <textarea id="sinonimos" name="sinonimos" placeholder="Bolo no pote de frutas vermelhas = bolo de pote de frutas vermelhas">
            {f.sinonimos}
          </textarea>
          <h3>Liga/desliga pela planilha</h3>
          <p class="suave pequeno">Só roda se alguma linha da coluna tiver o valor. Deixe em branco para não usar.</p>
          <div class="linha">
            <Texto nome="chaveAba" rotulo="Aba" valor={f.chaveAba} />
            <Texto nome="chaveColuna" rotulo="Coluna" valor={f.chaveColuna} />
            <Texto nome="chaveValor" rotulo="Valor" valor={f.chaveValor} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Mensagem (IA)</legend>
          <div class="linha">
            <Texto nome="modelo" rotulo="Modelo" valor={f.modelo} obrigatorio />
            <Texto nome="versao" rotulo="Versão do prompt" dica="(rótulo livre)" valor={f.versao} obrigatorio />
            <Texto nome="historico" rotulo="Mensagens anteriores no contexto" tipo="number" valor={f.historico} />
          </div>
          <label for="promptSistema">
            Prompt de sistema <span class="dica">(persona, tom e regras; igual para todos os contatos)</span>
          </label>
          <textarea id="promptSistema" name="promptSistema" class="grande" required>
            {f.promptSistema}
          </textarea>
          <label for="promptUsuario">
            Prompt por contato{' '}
            <span class="dica">
              (variáveis: {'{{nome}} {{apelido}} {{produtos_match}} {{observacao}} {{saudacao}} {{data}} {{dia_semana}} {{hora}} {{historico}} {{variacao.cumprimento}}'}…)
            </span>
          </label>
          <textarea id="promptUsuario" name="promptUsuario" class="grande" required>
            {f.promptUsuario}
          </textarea>
          <h3>Variações</h3>
          <p class="suave pequeno">
            Uma opção por linha. O sistema sorteia uma opção diferente das usadas nas últimas mensagens de cada contato. A
            mensagem precisa começar exatamente com o cumprimento sorteado.
          </p>
          <label for="cumprimentos">Cumprimentos</label>
          <textarea id="cumprimentos" name="cumprimentos">{f.cumprimentos}</textarea>
          <label for="apresentacoes">Apresentações (sugestão)</label>
          <textarea id="apresentacoes" name="apresentacoes">{f.apresentacoes}</textarea>
          <label for="conexoes">Conexões pessoais (sugestão)</label>
          <textarea id="conexoes" name="conexoes">{f.conexoes}</textarea>
          <label for="fechamentos">Fechamentos (sugestão)</label>
          <textarea id="fechamentos" name="fechamentos">{f.fechamentos}</textarea>
        </fieldset>

        <fieldset>
          <legend>Validação</legend>
          <p class="suave pequeno">
            Se a mensagem reprovar, a IA recebe os problemas e reescreve uma vez. Se reprovar de novo, ela não é enviada e
            fica como "precisa revisão".
          </p>
          <div class="linha">
            <Texto nome="maxEmojis" rotulo="Máximo de emojis" tipo="number" valor={f.maxEmojis} />
            <div>
              <label for="proibidos">Termos proibidos (um por linha)</label>
              <textarea id="proibidos" name="proibidos">{f.proibidos}</textarea>
            </div>
          </div>
          <div class="checks">
            <label>
              <input type="checkbox" name="semTravessao" value="1" checked={f.semTravessao} /> Sem travessões nem hífens
              soltos entre frases
            </label>
            <label>
              <input type="checkbox" name="somenteProdutos" value="1" checked={f.somenteProdutos} /> Só pode citar os
              produtos em comum com o contato
            </label>
            <label>
              <input type="checkbox" name="diferenteDaUltima" value="1" checked={f.diferenteDaUltima} /> Não pode ficar
              parecida com a última mensagem
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Envio</legend>
          <div class="linha">
            <Texto nome="intervaloMin" rotulo="Intervalo mínimo (s)" tipo="number" valor={f.intervaloMin} />
            <Texto nome="intervaloMax" rotulo="Intervalo máximo (s)" tipo="number" valor={f.intervaloMax} />
            <Texto nome="janelaInicio" rotulo="Janela: início" tipo="time" valor={f.janelaInicio} />
            <Texto nome="janelaFim" rotulo="Janela: fim" tipo="time" valor={f.janelaFim} />
          </div>
          <label>Dias permitidos para envio</label>
          <Dias nome="diasEnvio" marcados={f.diasEnvio} />
          <Texto nome="previaLimite" rotulo="Contatos na prévia" tipo="number" valor={f.previaLimite} />
          <p class="suave pequeno">Nesta versão tudo roda em modo sombra: nada é enviado.</p>
        </fieldset>

        <p class="acoes">
          <button class="primario" type="submit">
            Salvar
          </button>
          <a class="botao" href={`/w/${p.ws.slug}`}>
            Cancelar
          </a>
        </p>
      </form>
    </Layout>
  );
};

export const EditorJson = (p: { a: AutomacaoComWs; json: string; cron: string; erro?: string }) => (
  <Layout titulo={`${p.a.nome} · JSON`}>
    <Migalha slug={p.a.ws_slug} nome={p.a.ws_nome} />
    <h1>{p.a.nome}: configuração em JSON</h1>
    {p.erro ? <Aviso tipo="erro">{p.erro}</Aviso> : null}
    {p.a.receita === DISPARO_IA ? (
      <Aviso>
        Salvar por aqui transforma a automação em "personalizada": o formulário deixa de ser usado para ela.
      </Aviso>
    ) : null}
    <form method="post" action={`/a/${p.a.id}/json`}>
      <label for="cron">
        Agenda (cron) <span class="dica">(minuto hora dia mês dia-da-semana; vazio = sem agenda)</span>
      </label>
      <input id="cron" type="text" name="cron" value={p.cron} placeholder="0 10 * * 3" />
      <label for="config">Configuração</label>
      <textarea id="config" name="config" class="grande" style="min-height: 60vh" spellcheck={false}>
        {p.json}
      </textarea>
      <p class="acoes">
        <button class="primario" type="submit">
          Salvar
        </button>
        <a class="botao" href={`/a/${p.a.id}`}>
          Cancelar
        </a>
      </p>
    </form>
  </Layout>
);
