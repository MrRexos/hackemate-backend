export class Pedido {
  constructor({ nom, volum, quantitat }) {
    this.nom = nom;
    this.volum = Number(volum) * Number(quantitat);
    this.quantitat = quantitat;
  }
}
