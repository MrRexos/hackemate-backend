export class Pedido {
  /**
   * @param {object} params
   * @param {string} [params.nom]
   * @param {number} [params.volum] Volum per unitat (caixa / línia logística).
   * @param {number} [params.quantitat]
   * @param {string|null} [params.tipusCarrega] Tipus de càrrega (es guarda; el sweep usa volum × quantitat).
   * @param {string|null} [params.horaIniciPedido] Finestra opcional a nivell de línia (no la usa l’optimizer actual).
   */
  constructor({ nom, volum, quantitat, tipusCarrega = null, horaIniciPedido = null }) {
    this.nom = nom;
    this.volumPerCaixa = Number(volum) || 0;
    this.quantitatCaixes = Number(quantitat) || 0;
    this.tipusCarrega = tipusCarrega ?? null;
    this.horaIniciPedido = horaIniciPedido ?? null;

    // Compatibilitat amb camps antics.
    this.volum = this.volumPerCaixa;
    this.quantitat = this.quantitatCaixes;
  }

  get volumTotal() {
    return this.volumPerCaixa * this.quantitatCaixes;
  }

  get volumTotalCaixes() {
    return this.volumTotal;
  }
}
