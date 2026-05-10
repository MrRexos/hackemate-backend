/**
 * Capacitat nominal vs útil operativa (marge de seguretat sobre el volum màxim del camió).
 * Mateixa unitat que {@link Entrega#volumTotal} i {@link Camio#capacitatMaxima}.
 */

/** Fracció màxima d’ús de la capacitat nominal (per defecte 97%). */
export const FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO = 0.97;

/**
 * Volum màxim que es pot carregar tenint en compte el límit operatiu (no 100% del nominal).
 * @param {{ capacitatMaxima?: number, capacitat?: number }} camio
 */
export function volumCarregaMaximaOperativa(camio) {
  const cap = Number(camio?.capacitatMaxima ?? camio?.capacitat ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return cap * FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO;
}

/**
 * Comprova si cap afegir una entrega respectant el límit útil del camió.
 * @param {number} volumOcupat
 * @param {number} volumEntrega
 * @param {{ capacitatMaxima?: number, capacitat?: number }} camio
 */
export function volumPermetAfegirACamio(volumOcupat, volumEntrega, camio) {
  const maxOp = volumCarregaMaximaOperativa(camio);
  const vo = Number(volumOcupat) || 0;
  const ve = Number(volumEntrega) || 0;
  return vo + ve <= maxOp + 1e-9;
}
