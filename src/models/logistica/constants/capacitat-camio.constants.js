/** Fracció màxima de la capacitat nominal utilitzable amb càrrega (reserva ~3%). */
export const FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO = 0.97;

/** Volum màxim operatiu (fracció de la capacitat nominal del camió). */
export function volumCarregaMaximaOperativa(camio) {
  const cap = Number(camio?.capacitatMaxima ?? camio?.capacitat ?? 0);
  if (!Number.isFinite(cap) || cap < 0) return 0;
  return cap * FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO;
}

/**
 * True si `volumOcupatActual + volumExtra` no supera el límit operatiu.
 * Comparació amb arrodoniment estable per evitar sobrepassaments per float.
 */
export function volumPermetAfegirACamio(volumOcupatActual, volumExtra, camio) {
  const maxU = volumCarregaMaximaOperativa(camio);
  const sum = Number(volumOcupatActual || 0) + Number(volumExtra || 0);
  return Math.round(sum * 1e9) <= Math.round(maxU * 1e9);
}
