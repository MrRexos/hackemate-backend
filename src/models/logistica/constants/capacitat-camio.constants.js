/** Fracció màxima de la capacitat nominal utilitzable amb càrrega (reserva ~7%). */
export const FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO = 0.93;

/**
 * Marge relatiu **per sota** del límit operatiu només per a assignacions: evita que errors de punt flotant
 * acumulats facin superar la fracció {@link FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO}. Ha de ser petit (ppm).
 */
export const MARGE_ESTRICTE_UTILITZACIO_RELATIU = 1e-6;

/** Volum màxim operatiu (fracció de la capacitat nominal del camió). */
export function volumCarregaMaximaOperativa(camio) {
  const cap = Number(camio?.capacitatMaxima ?? camio?.capacitat ?? 0);
  if (!Number.isFinite(cap) || cap < 0) return 0;
  return cap * FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO;
}

/**
 * Límit efectiu per **carregar** la ruta: una fracció lleugerament inferior al volum operatiu teòric,
 * per aplicar la política de {@link FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO} de forma estricta.
 * Els camions virtuals (p. ex. `__camioVirtual`) no apliquen el marge: el nominal es dimensiona al carreg.
 */
export function volumLimitOperatiuPerAssignacio(camio) {
  const base = volumCarregaMaximaOperativa(camio);
  if (!(base > 0)) return 0;
  if (camio?.__camioVirtual) return base;
  return base * (1 - MARGE_ESTRICTE_UTILITZACIO_RELATIU);
}

/**
 * True si `volumOcupatActual + volumExtra` no supera el límit operatiu (**estricte**, amb {@link volumLimitOperatiuPerAssignacio}).
 * Comparació amb arrodoniment estable per evitar sobrepassaments per float.
 */
export function volumPermetAfegirACamio(volumOcupatActual, volumExtra, camio) {
  const maxPermes = volumLimitOperatiuPerAssignacio(camio);
  const sum = Number(volumOcupatActual || 0) + Number(volumExtra || 0);
  if (!(maxPermes > 0)) return sum <= 1e-15;
  return Math.round(sum * 1e9) <= Math.round(maxPermes * 1e9);
}

/**
 * True si el volum total de càrrega supera el límit operatiu (mateixa escala d’arrodoniment que {@link volumPermetAfegirACamio}).
 * Útil per validar una ruta després de `recalculaVolum`.
 */
export function volumSuperaLimitOperatiu(volum, camio) {
  const vol = Number(volum ?? 0);
  const maxPermes = volumLimitOperatiuPerAssignacio(camio);
  if (!(maxPermes > 0)) return vol > 1e-15;
  return Math.round(vol * 1e9) > Math.round(maxPermes * 1e9);
}
