import { normalitzaCoordenades } from '../utils/coordenades.utils.js';
import {
  clauCacheGeocodificacio,
  desaEnCacheLocal,
  geocodeCacheActiu,
  obtenDesCacheLocal,
} from './geocodificar-cache-local.service.js';

function espera(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pausa entre intents Nominatim dins la mateixa entrega (política ~1 req/s). */
const INTERVAL_MS_ENTRE_INTENTS_NOMINATIM = 1100;

/**
 * Intenta extreure via, CP i municipi d’una sola cadena «carrer, CP, municipi» (comú als Excels).
 * @param {string|null|undefined} s
 * @returns {{ carrer: string|null, codiPostal: string|null, municipi: string|null }}
 */
export function parseAdrecaConcatenadaEspanya(s) {
  if (s == null || String(s).trim() === '') {
    return { carrer: null, codiPostal: null, municipi: null };
  }
  const parts = String(s)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { carrer: null, codiPostal: null, municipi: null };
  if (parts.length === 1) {
    return { carrer: parts[0], codiPostal: null, municipi: null };
  }

  let idxCp = -1;
  let cp = null;
  for (let i = 0; i < parts.length; i += 1) {
    const m = parts[i].match(/\b(\d{5})\b/);
    if (m) {
      cp = m[1];
      idxCp = i;
      break;
    }
  }

  if (idxCp === -1) {
    return { carrer: parts.join(', '), codiPostal: null, municipi: null };
  }

  const carrer = parts.slice(0, idxCp).join(', ') || null;
  const municipi = parts.slice(idxCp + 1).join(', ') || null;
  return { carrer, codiPostal: cp, municipi };
}

/**
 * @param {URLSearchParams} paramsIntent Paràmetres de cerca (`q` **o** street/city/postalcode…).
 * @param {typeof fetch} fetchImpl
 */
async function nominatimCerca(paramsIntent, fetchImpl) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '0');
  paramsIntent.forEach((val, key) => {
    url.searchParams.set(key, val);
  });

  const response = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': 'HackeMate/1.0 (logistica)' },
  });

  if (!response.ok) {
    throw new Error(`Geocodificació HTTP ${response.status}`);
  }

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    return null;
  }

  const primer = resultats[0];
  return {
    x: Number(primer.lon),
    y: Number(primer.lat),
  };
}

function construeixCadenaCercaLliure(opts) {
  const parts = [];
  const v = opts.carrer != null && String(opts.carrer).trim() !== '' ? String(opts.carrer).trim() : '';
  const cp = opts.codiPostal != null && String(opts.codiPostal).trim() !== '' ? String(opts.codiPostal).trim() : '';
  const m = opts.municipi != null && String(opts.municipi).trim() !== '' ? String(opts.municipi).trim() : '';
  if (v) parts.push(v);
  if (cp) parts.push(cp);
  if (m) parts.push(m);
  if (parts.length > 0) parts.push('Spain');
  return parts.length > 0 ? parts.join(', ') : '';
}

/**
 * Diverses estratègies Nominatim (estructurada + text + variants) per millorar el rati d’encerts.
 *
 * @param {object} opts
 * @param {string|null} [opts.adreca] Cadena completa (fallback).
 * @param {string|null} [opts.carrer]
 * @param {string|null} [opts.codiPostal]
 * @param {string|null} [opts.municipi]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ x: number, y: number }>}
 */
export async function geocodificarAdrecaNominatimCompleta(opts, fetchImpl = fetch) {
  let carrer = opts.carrer != null && String(opts.carrer).trim() !== '' ? String(opts.carrer).trim() : null;
  let codiPostal = opts.codiPostal != null && String(opts.codiPostal).trim() !== '' ? String(opts.codiPostal).trim() : null;
  let municipi = opts.municipi != null && String(opts.municipi).trim() !== '' ? String(opts.municipi).trim() : null;
  const adrecaPlena = opts.adreca != null && String(opts.adreca).trim() !== '' ? String(opts.adreca).trim() : '';

  if (!carrer && !codiPostal && !municipi && adrecaPlena) {
    const ext = parseAdrecaConcatenadaEspanya(adrecaPlena);
    carrer = ext.carrer;
    codiPostal = ext.codiPostal ?? codiPostal;
    municipi = ext.municipi ?? municipi;
  }

  const clauCache =
    geocodeCacheActiu() &&
    clauCacheGeocodificacio({
      adreca: adrecaPlena,
      carrer,
      codiPostal,
      municipi,
    });
  if (clauCache) {
    const desCache = obtenDesCacheLocal(clauCache);
    if (
      desCache &&
      Number.isFinite(desCache.x) &&
      Number.isFinite(desCache.y)
    ) {
      return desCache;
    }
  }

  /** @type {Array<{ desc: string, params: URLSearchParams }>} */
  const intents = [];

  if (carrer && (codiPostal || municipi)) {
    const sp = new URLSearchParams();
    sp.set('street', carrer);
    if (municipi) sp.set('city', municipi);
    if (codiPostal) sp.set('postalcode', codiPostal);
    sp.set('countrycodes', 'es');
    intents.push({ desc: 'Nominatim estructurat (street+city+postalcode, ES)', params: sp });
  }

  const qCompleta = construeixCadenaCercaLliure({ carrer, codiPostal, municipi });
  if (qCompleta) {
    const sp = new URLSearchParams();
    sp.set('q', qCompleta);
    intents.push({ desc: 'Text lliure components+city+Spain', params: sp });
  }

  if (municipi && carrer) {
    const sp = new URLSearchParams();
    sp.set('q', `${carrer}, ${municipi}, Spain`);
    intents.push({ desc: 'Text carrer+municipi+Spain', params: sp });
  }

  if (adrecaPlena) {
    const sp = new URLSearchParams();
    sp.set('q', adrecaPlena);
    intents.push({ desc: 'Text adreça Excel completa', params: sp });

    const spEs = new URLSearchParams();
    spEs.set('q', `${adrecaPlena}, Spain`);
    intents.push({ desc: 'Text adreça + Spain', params: spEs });
  }

  let ultimError = /** @type {Error|null} */ (null);
  const vistos = new Set();
  let primerIntent = true;

  for (const { desc, params } of intents) {
    const clau = params.toString();
    if (vistos.has(clau)) continue;
    vistos.add(clau);

    if (!primerIntent && INTERVAL_MS_ENTRE_INTENTS_NOMINATIM > 0) {
      await espera(INTERVAL_MS_ENTRE_INTENTS_NOMINATIM);
    }
    primerIntent = false;

    try {
      const coords = await nominatimCerca(params, fetchImpl);
      if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
        if (clauCache) desaEnCacheLocal(clauCache, coords);
        return coords;
      }
      ultimError = new Error(`Sense resultats (${desc})`);
    } catch (err) {
      ultimError = err instanceof Error ? err : new Error(String(err));
    }
  }

  const mostra = adrecaPlena || qCompleta || carrer || '';
  throw ultimError ?? new Error(`No s’han trobat coordenades per a: ${mostra}`);
}

/**
 * Geocodifica una adreça amb Nominatim (OSM).
 * Respecta la política d’ús Nominatim (~1 petició/s espaiades si crides en bucle).
 *
 * @param {string} adreca
 * @param {typeof fetch} [fetchImpl=fetch]
 * @returns {Promise<{ x: number, y: number }>} x = lon, y = lat (WGS84). Per Leaflet: `L.marker([y, x])`.
 */
export async function geocodificarAdrecaNominatim(adreca, fetchImpl = fetch) {
  return geocodificarAdrecaNominatimCompleta({ adreca }, fetchImpl);
}

/**
 * Omple les coordenades reals (WGS84) de cada entrega a partir del camp `adreca`,
 * per poder ubicar-les en un mapa (Nominatim / OpenStreetMap).
 *
 * Entre cada geocodificació s’espera `intervalMsEntrePeticions` (per defecte 1100 ms)
 * per respectar el límit d’ús de Nominatim.
 *
 * @param {Array<object>} entregues Instàncies `Entrega` o objectes amb `adreca` i opcionalment `coordenades`.
 * @param {object} [options]
 * @param {boolean} [options.ompleEncaraQueTinguinCoordenades=false] Si és true, torna a geocodificar fins i tot si ja hi ha coords.
 * @param {number} [options.intervalMsEntrePeticions=1100] Pausa entre peticions a Nominatim (no s’aplica abans de la primera ni després de l’última geocodificació feta).
 * @param {typeof fetch} [options.fetchImpl=fetch]
 * @param {new (p: object) => object} [options.EntregaClass] Si es passa, cada element que no sigui instància es converteix amb `new EntregaClass(...)`.
 * @returns {Promise<Array<object>>} El mateix array (referències), amb `coordenades` actualitzades on calgui.
 */
export async function geocodificarEntreguesNominatim(entregues, options = {}) {
  const {
    ompleEncaraQueTinguinCoordenades = false,
    intervalMsEntrePeticions = 1100,
    fetchImpl = fetch,
    EntregaClass,
  } = options;

  if (!Array.isArray(entregues)) {
    throw new Error('geocodificarEntreguesNominatim: cal un array d’entregues.');
  }

  /** @type {object[]} */
  const resultat = [];
  let necessitaEspera = false;

  for (const raw of entregues) {
    const entrega =
      EntregaClass && !(raw instanceof EntregaClass) ? new EntregaClass(raw) : raw;

    if (!ompleEncaraQueTinguinCoordenades && normalitzaCoordenades(entrega.coordenades)) {
      resultat.push(entrega);
      continue;
    }

    const adreca = entrega.adreca;
    if (adreca == null || String(adreca).trim() === '') {
      throw new Error(`Entrega sense adreca vàlida: ${entrega.identificador ?? 'sense-id'}`);
    }

    if (necessitaEspera && intervalMsEntrePeticions > 0) {
      await espera(intervalMsEntrePeticions);
    }

    entrega.coordenades = await geocodificarAdrecaNominatimCompleta(
      {
        adreca: String(adreca),
        carrer: entrega.carrer ?? null,
        codiPostal: entrega.codiPostal ?? null,
        municipi: entrega.municipi ?? null,
      },
      fetchImpl,
    );
    necessitaEspera = true;
    resultat.push(entrega);
  }

  return resultat;
}
