/**
 * Conversió de tipus de càrrega a **caixes equivalents** (unitat global de la flota).
 *
 * - **CAJ**: 1 unitat de línia = 1 caixa.
 * - **BRL**: 1 barril = 4 caixes.
 * - **UN**: 24 unitats = 1 caixa (factor 1/24 per unitat).
 * - Qualsevol altre codi (incloent buit): unitats genèriques empaquetades de **12 per caixa** (factor 1/12).
 */

/** @param {string|null|undefined} raw */
export function extreuCodiTipusCarrega(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  const t = String(raw).trim().toUpperCase();
  const token = t.split(/[\s\-_/]+/)[0] ?? '';
  if (token.startsWith('CAJ')) return 'CAJ';
  if (token.startsWith('BRL')) return 'BRL';
  if (token === 'UN') return 'UN';
  return '';
}

/**
 * Caixes equivalents per **una unitat** de la línia de comanda (segons `tipusCarrega`).
 *
 * @param {string|null|undefined} tipusCarrega Codi o text curt (p. ex. `CAJ`, `BRL`, `UN`).
 * @returns {number}
 */
export function factorCaixesPerUnitatTipusCarrega(tipusCarrega) {
  const codi = extreuCodiTipusCarrega(tipusCarrega);
  switch (codi) {
    case 'CAJ':
      return 1;
    case 'BRL':
      return 4;
    case 'UN':
      return 1 / 24;
    default:
      return 1 / 12;
  }
}
