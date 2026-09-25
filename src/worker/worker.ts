import { executar, type Dependencias } from '../motor/execucao.js';
import { recuperarTravadas, reivindicar } from './fila.js';

export class Worker {
  private rodando = false;
  private temporizador: NodeJS.Timeout | null = null;
  private atual: Promise<void> | null = null;

  constructor(
    private readonly deps: Dependencias,
    private readonly intervaloMs = 3000,
  ) {}

  /** Um ciclo: recupera travadas e executa no máximo uma execução. Retorna true se executou algo. */
  async ciclo(): Promise<boolean> {
    await recuperarTravadas(this.deps.db);
    const id = await reivindicar(this.deps.db);
    if (!id) return false;
    try {
      await executar(id, this.deps);
    } catch (e) {
      this.deps.log?.(`erro inesperado na execução ${id}: ${(e as Error).stack ?? e}`);
    }
    return true;
  }

  iniciar(): void {
    this.rodando = true;
    const proximo = async () => {
      if (!this.rodando) return;
      let trabalhou = false;
      try {
        this.atual = this.ciclo().then((t) => {
          trabalhou = t;
        });
        await this.atual;
      } catch (e) {
        this.deps.log?.(`erro no worker: ${(e as Error).message}`);
      } finally {
        this.atual = null;
      }
      if (this.rodando) this.temporizador = setTimeout(proximo, trabalhou ? 0 : this.intervaloMs);
    };
    void proximo();
  }

  async parar(): Promise<void> {
    this.rodando = false;
    if (this.temporizador) clearTimeout(this.temporizador);
    await this.atual;
  }
}
