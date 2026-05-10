import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Converteix el retorn de {@link generarRutes} en un objecte JSON‑serialitzable (sense classes).
 *
 * @param {{ rutes: object[], entreguesNoAssignades: object[] }} resultat
 * @param {{ x: number, y: number }} magatzem Lon/lat (WGS84).
 * @param {Record<string, unknown>} [meta]
 */
export function serialitzaResultatGenerarRutes(resultat, magatzem, meta = {}) {
  return {
    generat: new Date().toISOString(),
    magatzem,
    meta,
    rutes: (resultat.rutes || []).map((ruta) => ({
      camio: {
        id: ruta.camio?.id ?? null,
        capacitatMaxima: ruta.camio?.capacitatMaxima ?? ruta.camio?.capacitat ?? null,
        __camioVirtual: ruta.camio?.__camioVirtual === true,
      },
      horaSortidaMagatzem: ruta.horaSortidaMagatzem ?? null,
      horaTornadaMagatzem: ruta.horaTornadaMagatzem ?? null,
      sortidaMagatzemMinuts: ruta.sortidaMagatzemMinuts ?? null,
      tornadaMagatzemMinuts: ruta.tornadaMagatzemMinuts ?? null,
      volumOcupat: ruta.volumOcupat,
      entregues: (ruta.entregues || []).map((e, idx) => ({
        ordre: idx + 1,
        identificador: e.identificador ?? null,
        idEntrega: e.idEntrega ?? e.identificador ?? null,
        nom: e.nom ?? null,
        adreca: e.adreca ?? null,
        carrer: e.carrer ?? null,
        codiPostal: e.codiPostal ?? null,
        municipi: e.municipi ?? null,
        coordenades: e.coordenades ?? null,
        volumTotal: e.volumTotal,
        horaInici: e.horaInici ?? null,
        horaFinal: e.horaFinal ?? null,
        horaDEntrega: e.horaDEntrega ?? null,
        arribadaHora: e.arribadaHora ?? null,
        sortidaHora: e.sortidaHora ?? null,
        pedidos: (e.pedidos || []).map((p) => ({
          nom: p.nom ?? null,
          dia: p.dia ?? null,
          producte: p.producte ?? null,
          tipusCarrega: p.tipusCarrega ?? null,
          factorCaixesPerUnitat: p.factorCaixesPerUnitat,
          quantitatCaixes: p.quantitatCaixes,
          volumTotal: p.volumTotal,
        })),
      })),
    })),
    entreguesNoAssignades: (resultat.entreguesNoAssignades || []).map((e) => ({
      identificador: e.identificador ?? null,
      idEntrega: e.idEntrega ?? e.identificador ?? null,
      nom: e.nom ?? null,
      adreca: e.adreca ?? null,
      volumTotal: e.volumTotal,
      motiuNoAssignacio: e.motiuNoAssignacio ?? null,
    })),
  };
}

/**
 * Escriu el resultat del pla de rutes en un fitxer JSON (crea directoris si cal).
 *
 * @param {string} rutaFitxer Ruta absoluta o relativa al cwd.
 * @param {{ rutes: object[], entreguesNoAssignades: object[] }} resultat
 * @param {{ x: number, y: number }} magatzem
 * @param {Record<string, unknown>} [meta]
 * @returns {Promise<string>} Mateixa ruta escrita.
 */
export async function guardarResultatGenerarRutesJson(rutaFitxer, resultat, magatzem, meta = {}) {
  const payload = serialitzaResultatGenerarRutes(resultat, magatzem, meta);
  const dir = dirname(rutaFitxer);
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(rutaFitxer, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return rutaFitxer;
}
