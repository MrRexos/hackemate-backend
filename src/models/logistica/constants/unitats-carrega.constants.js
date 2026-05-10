/** Un barril compta com aquest nombre de caixes equivalents en càrrega / capacitat del camió. */
export const CAIXES_PER_BARRIL = 4;

/**
 * True si el tipus de càrrega o el nom del producte indiquen barril (caixa verbal «barril»).
 * @param {string|null|undefined} tipusCarregaONom
 */
export function tipusEsBarril(tipusCarregaONom) {
  if (tipusCarregaONom == null || tipusCarregaONom === '') return false;
  return /\bbarril\b/i.test(String(tipusCarregaONom));
}
