/**
 * Vehicle de repartiment amb dades estables (flota fixa).
 * Compatible amb {@link generarRutes}: usa `id` i `capacitatMaxima` via getters.
 */
export class Camio {
  /**
   * @param {object} params
   * @param {number} params.capacitat Màxim de caixes equivalents transportables (mateixa unitat que entregues.volumTotal).
   * @param {string|number} params.numeroReferencia Identificador de vehicle / flota (matrícula, codi intern, etc.).
   * @param {string} params.tipus Categoria de vehicle (p. ex. rígid, articulat, furgoneta).
   * @param {string} [params.id] Per a l’optimizador; per defecte es deriva de `numeroReferencia`.
   */
  constructor({ capacitat, numeroReferencia, tipus, id }) {
    this.capacitat = Number(capacitat) || 0;
    this.numeroReferencia = numeroReferencia ?? null;
    this.tipus = tipus ?? null;
    const ref = this.numeroReferencia != null ? String(this.numeroReferencia) : null;
    this.id = id != null ? String(id) : ref ?? 'camio-sense-ref';
  }

  /** Alias esperat per sweep / ruta.service. */
  get capacitatMaxima() {
    return this.capacitat;
  }
}

/**
 * Conjunt fixe de camions (mateixa definició entre execucions).
 * Passa `flota.perOptimizador()` (o `[...flota.camions]`) a `generarRutes`.
 */
export class FlotaCamions {
  /**
   * @param {Array<Camio | { capacitat: number, numeroReferencia: string|number, tipus: string, id?: string }>} definicions
   */
  constructor(definicions) {
    if (!Array.isArray(definicions)) {
      throw new Error("FlotaCamions: cal un array de Camio o objectes { capacitat, numeroReferencia, tipus }.");
    }
    this._camions = definicions.map((c) => (c instanceof Camio ? c : new Camio(c)));
  }

  get camions() {
    return this._camions;
  }

  get mida() {
    return this._camions.length;
  }

  /** Còpia superficial de la llista (mateixes instàncies {@link Camio}). */
  perOptimizador() {
    return [...this._camions];
  }
}
