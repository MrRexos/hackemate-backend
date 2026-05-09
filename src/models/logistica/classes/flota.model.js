// Model de flota: treballa en format resumit i el pot expandir a camions reals.
export class Flota {
  constructor(items = []) {
    this.items = Array.isArray(items) ? items : [];
  }

  // Retorna la capacitat total disponible de la flota en caixes.
  capacitatTotalCaixes() {
    return this.items.reduce(
      (total, item) => total + Number(item.quantitat || 0) * Number(item.capacitatCaixes || 0),
      0,
    );
  }

  // Retorna un resum per tipus amb quantitat i capacitat.
  resumPerTipus() {
    return this.items.map((item) => ({
      tipus: item.tipus,
      quantitat: Number(item.quantitat || 0),
      capacitatPales: Number(item.capacitatPales || 0),
      capacitatCaixes: Number(item.capacitatCaixes || 0),
    }));
  }

  // Expandeix la flota resumida a un vector de camions individuals.
  toCamions() {
    const camions = [];

    for (const item of this.items) {
      const quantitat = Number(item.quantitat || 0);
      for (let i = 0; i < quantitat; i += 1) {
        camions.push({
          tipus: item.tipus,
          capacitatPales: Number(item.capacitatPales || 0),
          capacitatCaixes: Number(item.capacitatCaixes || 0),
        });
      }
    }

    return camions;
  }
}
