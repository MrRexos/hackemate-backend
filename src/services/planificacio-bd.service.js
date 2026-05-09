/**
 * Pipeline complet: Supabase → {@link Entrega}[] → {@link generarRutes}.
 *
 * El magatzem i la flota es poden passar per opcions o llegir de configuració per defecte.
 */
import { env } from '../config/env.js';
import { fetchEntregasFromSource } from '../data/repository.js';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';

/** Magatzem per defecte (Mollet afores) si no hi ha variables d’entorn. */
export function obtenirMagatzemDesDeEnv() {
  const x = Number(process.env.LOGISTICS_MAGATZEM_LON ?? process.env.MAGATZEM_LON ?? 2.1718);
  const y = Number(process.env.LOGISTICS_MAGATZEM_LAT ?? process.env.MAGATZEM_LAT ?? 41.5278);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('LOGISTICS_MAGATZEM_LON / LOGISTICS_MAGATZEM_LAT han de ser números vàlids.');
  }
  return { x, y };
}

/**
 * @param {object} [options]
 * @param {object} [options.fetchEntregasOptions] — repassa a {@link fetchEntregasFromSource}
 * @param {object[]} [options.flotaCamions] — per defecte flota d’exemple
 * @param {{ x: number, y: number }} [options.magatzem]
 * @param {boolean} [options.assignacioCompleta=false]
 * @param {boolean} [options.optimIntraRutaCarrers=true] — OSRM (requereix xarxa)
 * @param {boolean} [options.usaMockGeocodificacioSweep=true] — només afecta entregues sense coords al pas {@link generarRutes}
 * @param {object} [options.generarRutes] — altres opcions del sweep
 */
export async function planificarRutesDesDeBaseDades(options = {}) {
  const entregues = await fetchEntregasFromSource(options.fetchEntregasOptions ?? {});

  const flota = options.flotaCamions ?? FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();
  const magatzem = options.magatzem ?? obtenirMagatzemDesDeEnv();

  const assignacioCompleta = options.assignacioCompleta === true;
  const optimIntraRutaCarrers = options.optimIntraRutaCarrers !== false;
  const usaMock = options.usaMockGeocodificacioSweep !== false;

  const resultat = await generarRutes(entregues, flota, magatzem, {
    EntregaClass: Entrega,
    usaMock,
    assignacioCompleta,
    optimIntraRutaCarrers,
    velocitatKmH: Number(options.velocitatKmH) > 0 ? Number(options.velocitatKmH) : 38,
    tempsBaseDescarregaMinuts:
      options.tempsBaseDescarregaMinuts != null ? Number(options.tempsBaseDescarregaMinuts) : 10,
    tempsPerCaixaMinuts: options.tempsPerCaixaMinuts != null ? Number(options.tempsPerCaixaMinuts) : 1,
    ...options.generarRutes,
  });

  return {
    magatzem,
    fontConfig: {
      sourceMode: env.logisticsSourceMode,
      flatView: env.logisticsSourceMode === 'flat' ? env.logisticsFlatView : null,
      tableEntregues: env.logisticsSourceMode === 'joined' ? env.logisticsTableEntregues : null,
      tablePedidos: env.logisticsSourceMode === 'joined' ? env.logisticsTablePedidos : null,
    },
    entreguesCarregades: entregues.length,
    resultat,
  };
}
