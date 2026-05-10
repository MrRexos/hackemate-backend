/**
 * Geocodificació Nominatim (OpenStreetMap): retorna el punt de l’adreça en WGS84.
 * Si falla la cerca (xarxa, timeout, sense resultats…), per defecte es retorna un punt
 * **determinista dins l’AMB** (no correspon a l’adreça real) per no interrompre el flux.
 *
 * @returns {Promise<{ x: number, y: number }>} `x` = longitud (graus), `y` = latitud (graus).
 */

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Rectangle aproximat dins l’Àrea Metropolitana de Barcelona (terra ferma;
 * punts simulats quan Nominatim no pot resoldre l’adreça).
 */
export const AMB_FALLBACK_BBOX = {
  minLon: 2.088,
  maxLon: 2.205,
  minLat: 41.332,
  maxLat: 41.452,
};

/**
 * Coordenades fictícies però **ubicables al mapa** dins l’AMB; deterministes per `adreca`.
 * @param {string} adreca
 * @returns {{ x: number, y: number }}
 */
export function coordenadesFallbackAmb(adreca) {
  let hash = 0;
  const s = String(adreca ?? 'sense-adreca');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const u = (Math.abs(hash) % 10000) / 10000;
  const v = (Math.abs(hash >> 11) % 10000) / 10000;
  const { minLon, maxLon, minLat, maxLat } = AMB_FALLBACK_BBOX;
  return {
    x: minLon + u * (maxLon - minLon),
    y: minLat + v * (maxLat - minLat),
  };
}

/** Resultats que solen caure al mar / massa genèrics per a repartiment porta a porta. */
function puntuacioDesconfiancaResultat(r) {
  const cls = String(r.class ?? '').toLowerCase();
  const typ = String(r.type ?? '').toLowerCase();
  let penal = 0;
  if (cls === 'water') penal += 100;
  if (['sea', 'ocean', 'bay', 'dock', 'harbour', 'marina'].includes(typ)) penal += 80;
  if (cls === 'natural' && ['bay', 'coastline', 'water'].includes(typ)) penal += 80;
  if (cls === 'boundary' && typ === 'administrative') penal += 15;
  if (['building', 'amenity', 'shop', 'tourism'].includes(cls)) penal -= 8;
  if (cls === 'highway') penal -= 5;
  if (
    cls === 'place'
    && ['house', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'].includes(typ)
  )
    penal -= 6;
  if (cls === 'place' && typ === 'locality') penal -= 3;
  const imp = Number(r.importance);
  if (Number.isFinite(imp)) penal -= imp * 2;
  return penal;
}

function escullMillorResultatNominatim(resultats) {
  if (!Array.isArray(resultats) || resultats.length === 0) return null;
  const ordenats = [...resultats].sort(
    (a, b) => puntuacioDesconfiancaResultat(a) - puntuacioDesconfiancaResultat(b),
  );
  return ordenats[0];
}

function enriquirConsultaAdreca(adreca) {
  const s = String(adreca ?? '').trim();
  if (!s) return s;
  const baix = s.toLowerCase();
  if (
    baix.includes('españa')
    || baix.includes('espanya')
    || baix.includes('spain')
    || /\b\d{5}\b/.test(s)
  ) {
    return s;
  }
  return `${s}, España`;
}

/**
 * @param {string} adreca
 * @param {typeof fetch} [fetchImpl]
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.countrycodes] - ISO (per defecte `es`).
 * @param {number} [opts.limit] - candidats a avaluar (per defecte 5).
 * @param {boolean} [opts.fallbackAmb=true] - Si és fals, es manté el comportament d’error (throw).
 */
export async function geocodificarAdrecaNominatim(adreca, fetchImpl = fetch, opts = {}) {
  const usarFallback = opts.fallbackAmb !== false;

  const q = enriquirConsultaAdreca(adreca);
  if (!String(q).trim()) {
    if (!usarFallback) {
      throw new Error("Adreça buida: no es pot geocodificar.");
    }
    console.warn('[geocodificació] Adreça buida → coordenades fallback AMB (no reals).');
    return coordenadesFallbackAmb(adreca);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const countrycodes = opts.countrycodes ?? 'es';
  const limit = Number(opts.limit) > 0 ? Math.min(10, Number(opts.limit)) : 5;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', countrycodes);
  url.searchParams.set('addressdetails', '0');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const ambFallback = (motiu) => {
    console.warn(`${motiu} → fallback AMB (no correspon a l’adreça) · ${String(adreca).slice(0, 72)}`);
    return coordenadesFallbackAmb(adreca);
  };

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'HackeMate/1.0 (logistica; contacte dev)' },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (!usarFallback) {
        throw new Error(`Error geocodificant l'adreca (${response.status}).`);
      }
      return ambFallback(`[geocodificació] HTTP ${response.status}`);
    }

    const resultats = await response.json();
    if (!Array.isArray(resultats) || resultats.length === 0) {
      if (!usarFallback) {
        throw new Error(`No s'han trobat coordenades per a: ${adreca}`);
      }
      return ambFallback('[geocodificació] Sense resultats Nominatim');
    }

    const millor = escullMillorResultatNominatim(resultats);
    if (!millor) {
      if (!usarFallback) {
        throw new Error(`No s'han trobat coordenades per a: ${adreca}`);
      }
      return ambFallback('[geocodificació] Cap candidat vàlid');
    }

    const lon = Number(millor.lon);
    const lat = Number(millor.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      if (!usarFallback) {
        throw new Error(`Coordenades invàlides retornades per a: ${adreca}`);
      }
      return ambFallback('[geocodificació] Coordenades invàlides');
    }

    return { x: lon, y: lat };
  } catch (err) {
    if (!usarFallback) {
      if (err?.name === 'AbortError') {
        throw new Error(`Temps esgotat geocodificant (>${timeoutMs} ms): ${adreca}`);
      }
      throw err;
    }
    const motiu =
      err?.name === 'AbortError'
        ? `[geocodificació] Timeout ${timeoutMs} ms`
        : `[geocodificació] ${err?.message ?? err}`;
    return ambFallback(motiu);
  } finally {
    clearTimeout(timer);
  }
}
