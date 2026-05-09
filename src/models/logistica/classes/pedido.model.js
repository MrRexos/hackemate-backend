export class Pedido {
  constructor({ nom, volum, quantitat }) {
    this.nom = nom;
    this.volumPerCaixa = Number(volum) || 0;
    this.quantitatCaixes = Number(quantitat) || 0;

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
