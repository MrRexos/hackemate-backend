import { CAIXES_PER_BARRIL, tipusEsBarril } from '../constants/unitats-carrega.constants.js';

export class Pedido {
  /**
   * Tot el model de càrrega treballa en **caixes equivalents** (mateixa unitat que `Camio.capacitat`).
   * Una línia amb tipus/nom que indiquen **barril**: `quantitat` = nombre de barrils; es converteix amb
   * {@link CAIXES_PER_BARRIL} caixes per barril abans de multiplicar per `volum` (multiplicador en caixes eq.).
   *
   * @param {object} params
   * @param {string} [params.nom]
   * @param {number} [params.volum] Multiplicador en caixes equivalents per unitat física (abans `volumPerCaixa`; per defecte 1).
   * @param {number} [params.quantitat] Unitats físiques: caixes (per defecte) o barrils si el tipus/nom indiquen barril.
   * @param {string|null} [params.tipusCarrega]
   * @param {string|null} [params.tipus] Alias de `tipusCarrega` (p. ex. columnes Excel «Tipo»).
   * @param {string|null} [params.horaIniciPedido] Finestra opcional a nivell de línia (no la usa l’optimizer actual).
   */
  constructor({ nom, volum, quantitat, tipusCarrega = null, tipus = null, horaIniciPedido = null }) {
    this.nom = nom;

    const tipusMerged = tipusCarrega ?? tipus ?? null;
    this.tipusCarrega = tipusMerged ?? null;
    this.horaIniciPedido = horaIniciPedido ?? null;

    const volumNum = Number(volum);
    this.volumPerCaixa =
      Number.isFinite(volumNum) && volumNum > 0 ? volumNum : 1;

    const qRaw = Number(quantitat);
    let unitatsFisiques = 0;
    if (Number.isFinite(qRaw) && qRaw > 0) {
      unitatsFisiques = Math.max(1, Math.floor(qRaw));
    }

    const barril = tipusEsBarril(tipusMerged) || tipusEsBarril(nom);
    const factorBarril = barril ? CAIXES_PER_BARRIL : 1;

    /** Caixes equivalents (després del factor barril → caixes). */
    this.quantitatCaixes = unitatsFisiques * factorBarril;

    // Compatibilitat amb camps antics (`volum` = una unitat; `quantitat` = caixes eq. totals).
    this.volum = this.volumPerCaixa;
    this.quantitat = this.quantitatCaixes;
  }

  /** Caixes equivalents totals de la línia (multiplicador × caixes eq. base). */
  get volumTotal() {
    return this.volumPerCaixa * this.quantitatCaixes;
  }

  get volumTotalCaixes() {
    return this.volumTotal;
  }
}
