/**
 * Generació de coordenades de prova sobre la xarxa viària (OSRM nearest),
 * dins d'un requadre urbà de Barcelona per evitar mar obert i zones de muntanya.
 */

const DEFAULT_OSRM = 'https://router.project-osrm.org';

/** Trama urbana densa (Eixample, Gràcia baixa, Sants, Poblenou interior, etc.). */
export const BCN_BBOX_CARRER = {
  minLon: 2.128,
  maxLon: 2.19,
  minLat: 41.37,
  maxLat: 41.428,
};

/**
 * Comarca del Barcelonès: Barcelona, L'Hospitalet de Llobregat,
 * Badalona, Santa Coloma de Gramenet i Sant Adrià de Besòs.
 * S'eviten franges de muntanya (Collserola alta) i mar.
 */
export const BARCELONES_BBOX_CARRER = {
  minLon: 2.092,
  maxLon: 2.252,
  minLat: 41.352,
  maxLat: 41.468,
};

function aleatoriEntre(min, max) {
  return min + Math.random() * (max - min);
}

function normalitzaBaseOsrm(osrmBaseUrl) {
  return String(osrmBaseUrl || DEFAULT_OSRM).replace(/\/+$/, '');
}

/**
 * Projecta un punt al node de conducció més proper (OSRM).
 * @returns {{ x: number, y: number, distanciaMetres: number } | null}
 */
export async function projectaAlCarrerMesProper(lon, lat, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = normalitzaBaseOsrm(options.osrmBaseUrl);
  const url = `${base}/nearest/v1/driving/${lon},${lat}?number=1`;

  let res;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const wp = data?.waypoints?.[0];
  if (!wp?.location || !Array.isArray(wp.location) || wp.location.length < 2) return null;

  const [snapLon, snapLat] = wp.location;
  const dist = Number(wp.distance ?? 0);

  if (!Number.isFinite(snapLon) || !Number.isFinite(snapLat)) return null;

  return { x: snapLon, y: snapLat, distanciaMetres: dist };
}

/**
 * Una coordenada aleatòria sobre carrer dins del bbox (amb reintents).
 */
export async function generaCoordenadaSobreCarrer(options = {}) {
  const bbox = options.bbox ?? BCN_BBOX_CARRER;
  const maxIntents = Number(options.maxIntents) || 30;
  const maxSnapMetres = Number(options.maxSnapMetres) || 450;
  const marginaBbox = Number.isFinite(Number(options.marginaBboxGraus))
    ? Number(options.marginaBboxGraus)
    : 0.012;

  for (let intent = 0; intent < maxIntents; intent += 1) {
    const lon = aleatoriEntre(bbox.minLon, bbox.maxLon);
    const lat = aleatoriEntre(bbox.minLat, bbox.maxLat);
    const proj = await projectaAlCarrerMesProper(lon, lat, options);
    if (!proj) continue;
    if (!Number.isFinite(proj.distanciaMetres) || proj.distanciaMetres > maxSnapMetres) continue;

    if (
      proj.x < bbox.minLon - marginaBbox
      || proj.x > bbox.maxLon + marginaBbox
      || proj.y < bbox.minLat - marginaBbox
      || proj.y > bbox.maxLat + marginaBbox
    ) {
      continue;
    }

    return { x: proj.x, y: proj.y };
  }

  throw new Error(
    "No s'ha pogut obtenir un punt sobre carrer (OSRM nearest). Revisa la xarxa o el servidor OSRM.",
  );
}

/**
 * Genera `total` punts únics (arrodonits) sobre carrer.
 */
export async function generaPuntsSobreCarrer(total, options = {}) {
  const n = Number(total);
  if (!Number.isFinite(n) || n < 1) return [];

  const punts = [];
  const vist = new Set();
  const decimals = Number(options.decimalsArrodoniment) >= 4 ? Number(options.decimalsArrodoniment) : 5;
  let buitsSeguits = 0;
  const maxBuitsSeguits = Math.max(500, n * 80);

  while (punts.length < n) {
    if (buitsSeguits > maxBuitsSeguits) {
      throw new Error(
        `No s'han pogut generar ${n} punts únics sobre carrer (massa col·lisions o fallades OSRM).`,
      );
    }

    const p = await generaCoordenadaSobreCarrer(options);
    const clau = `${p.x.toFixed(decimals)},${p.y.toFixed(decimals)}`;
    if (vist.has(clau)) {
      buitsSeguits += 1;
      continue;
    }
    vist.add(clau);
    punts.push(p);
    buitsSeguits = 0;
  }

  return punts;
}
