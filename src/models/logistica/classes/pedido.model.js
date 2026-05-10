import { factorCaixesPerUnitatTipusCarrega } from '../constants/factor-tipus-carrega.constants.js';

export class Pedido {
  /**
   * @param {object} params
   * @param {string} [params.nom]
   * @param {number} [params.volum] Multiplicador opcional per producte (Excel); si és 0 es tracta com 1. Es multiplica per (factor tipus × quantitat).
   * @param {number} [params.quantitat] Quantitat de la línia en unitats del tipus de càrrega (CAJ/BRL/UN/altres).
   * @param {string|null} [params.tipusCarrega] Tipus de càrrega: CAJ (caixa), BRL (barril=4 caixes), UN (24/cixa); altres → 12 unitats/cixa.
   * @param {string|null} [params.horaIniciPedido] Finestra opcional a nivell de línia (no la usa l’optimizer actual).
   * @param {string|null} [params.adreca] Adreça completa (p. ex. import Excel); opcional.
   * @param {string|null} [params.carrer] Línia de via / número (geocodificació estructurada).
   * @param {string|null} [params.codiPostal] Codi postal (5 xifres, p. ex. geocodificació amb Nominatim).
   * @param {string|null} [params.municipi] Municipi / població.
   */
  constructor({
    dia,
    nom,
    producte,
    volum,
    quantitat,
    tipusCarrega = null,
    horaIniciPedido = null,
    adreca = null,
    carrer = null,
    codiPostal = null,
    municipi = null,
  }) {
    this.nom = nom;
    this.volumPerCaixa = Number(volum) || 0;
    /** Quantitat de línia en unitats del tipus (no necessàriament caixes físiques). */
    this.quantitatCaixes = Number(quantitat) || 0;
    this.tipusCarrega = tipusCarrega ?? null;
    this.horaIniciPedido = horaIniciPedido ?? null;
    this.dia = dia;
    this.producte = producte;
    this.adreca = adreca ?? null;
    this.carrer = carrer != null && String(carrer).trim() !== '' ? String(carrer).trim() : null;
    this.codiPostal = codiPostal != null && String(codiPostal).trim() !== '' ? String(codiPostal).trim() : null;
    this.municipi = municipi != null && String(municipi).trim() !== '' ? String(municipi).trim() : null;
    // Compatibilitat amb camps antics.
    this.volum = this.volumPerCaixa;
    this.quantitat = this.quantitatCaixes;
  }

  /** Factor tipus → caixes equivalents per unitat de línia (CAJ/BRL/UN o defecte 1/12). */
  get factorCaixesPerUnitat() {
    return factorCaixesPerUnitatTipusCarrega(this.tipusCarrega);
  }

  /** Multiplicador Excel del producte; 0 es coneix com a 1. */
  get multiplicadorVolumProducte() {
    const v = Number(this.volumPerCaixa);
    return v > 0 ? v : 1;
  }

  /** Volum logístic total en **caixes equivalents**: quantitat × factor(tipus) × multiplicador producte. */
  get volumTotal() {
    return (
      this.quantitatCaixes *
      this.factorCaixesPerUnitat *
      this.multiplicadorVolumProducte
    );
  }

  get volumTotalCaixes() {
    return this.volumTotal;
  }
}
