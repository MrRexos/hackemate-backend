// Model minim d'un pedido dins d'una entrega.
export class Pedido {
  constructor({ nom, volum, quantitat }) {
    this.nom = nom;
    // Volum total del pedido (volum unitari * quantitat).
    this.volum = Number(volum) * Number(quantitat);
    this.quantitat = quantitat;
  }
}
