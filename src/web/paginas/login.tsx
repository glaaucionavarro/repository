/** @jsxImportSource hono/jsx */
import { Aviso, Layout } from '../componentes.js';

export const Login = ({ erro, voltar }: { erro?: string; voltar?: string }) => (
  <Layout titulo="Entrar" logado={false}>
    <div class="login cartao">
      <h1>Dex Automation</h1>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <form method="post" action="/login">
        <input type="hidden" name="voltar" value={voltar ?? '/'} />
        <label for="senha">Senha</label>
        <input id="senha" type="password" name="senha" autocomplete="current-password" required autofocus />
        <p>
          <button class="primario" type="submit">
            Entrar
          </button>
        </p>
      </form>
    </div>
  </Layout>
);
