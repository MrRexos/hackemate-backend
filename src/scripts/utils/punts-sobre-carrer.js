/**
 * Generació de coordenades de prova sobre la xarxa viària (OSRM nearest),
 * dins d'un bbox o d'un disc geogràfic (p. ex. rodona de Mollet).
 */

const DEFAULT_OSRM = 'https://router.project-osrm.org';

/** Centre de Mollet (rodona de referència per a punts de prova). Lon, lat. */
export const MOLLET_CENTRE_RODONA = { x: 2.2136, y: 41.5403 };

/** Magatzem a les afores (polígon / rodalies oest, aprox.). Lon, lat. */
export const MOLLET_MAGATZEM_AFORES = { x: 2.1718, y: 41.5278 };

/**
 * Trama urbana plana i densa (Eixample, Sants, Poblenou interior, part de L’Hospitalet…).
 * Es limita al nord per reduir punts projectats sobre vials de muntanya (Collserola).
 */
export const BCN_BBOX_CARRER = {
  minLon: 2.112,
  maxLon: 2.205,
  minLat: 41.355,
  maxLat: 41.418,
};

/**
 * @deprecated Preferir {@link BCN_BBOX_CARRER}: aquest rectangle inclou vessants i zones
 * on OSRM pot projectar sobre carreteres de muntanya. Es manté per compatibilitat.
 */
export const BARCELONES_BBOX_CARRER = {
  minLon: 2.092,
  maxLon: 2.252,
  minLat: 41.352,
  maxLat: 41.468,
};

/**
 * Heurística: rebutja punts projectats en sectors típicament muntanyosos (Collserola / Vallvidrera),
 * encara que siguin “driving” al mapa. Ajustable amb `excloureZonaMuntanya: false`.
 */
export function coordenadaEnSectorMuntanyosAprox(lon, lat) {
  const lo = Number(lon);
  const la = Number(lat);
  if (!Number.isFinite(lo) || !Number.isFinite(la)) return true;
  if (la >= 41.418 && lo <= 2.118) return true;
  if (la >= 41.405 && lo <= 2.095) return true;
  return false;
}

function aleatoriEntre(min, max) {
  return min + Math.random() * (max - min);
}

function normalitzaBaseOsrm(osrmBaseUrl) {
  return String(osrmBaseUrl || DEFAULT_OSRM).replace(/\/+$/, '');
}

function distanciaKmHaversineCoords(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const la1 = toR(lat1);
  const la2 = toR(lat2);
  const dLa = la2 - la1;
  const dLo = toR(lon2 - lon1);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

/** Punt final (lon, lat) desplaçat `distKm` des de (lon0, lat0) amb angle `bearingRad` (respecte nord, horari). */
function desplacamentKmDesDeCentre(lon0, lat0, distKm, bearingRad) {
  const R = 6371;
  const lon1 = (lon0 * Math.PI) / 180;
  const lat1 = (lat0 * Math.PI) / 180;
  const dr = distKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(bearingRad));
  const lon2 =
    lon1
    + Math.atan2(
      Math.sin(bearingRad) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: (lon2 * 180) / Math.PI, lat: (lat2 * 180) / Math.PI };
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
  const maxSnapMetres = Number(options.maxSnapMetres) || 350;
  const marginaBbox = Number.isFinite(Number(options.marginaBboxGraus))
    ? Number(options.marginaBboxGraus)
    : 0.01;
  const exclouMuntanya = options.excloureZonaMuntanya !== false;

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

    if (exclouMuntanya && coordenadaEnSectorMuntanyosAprox(proj.x, proj.y)) {
      continue;
    }

    return { x: proj.x, y: proj.y };
  }

  throw new Error(
    "No s'ha pogut obtenir un punt sobre carrer (OSRM nearest). Revisa la xarxa o el servidor OSRM.",
  );
}

/**
 * Punt aleatori uniforme en un disc (projectat al vial més proper), fins a `radiKm` del centre.
 * @param {object} options
 * @param {{ x: number, y: number }} [options.centreRodona] — lon, lat del centre del disc (per defecte {@link MOLLET_CENTRE_RODONA} si es passa `centre`).
 * @param {{ x: number, y: number }} [options.centre] — alias de centreRodona
 * @param {number} [options.radiKm=100]
 * @param {number} [options.margeKmSnap=3] — tolerància extra per al snap OSRM respecte al radi
 * @param {number} [options.maxSnapMetres=900]
 */
export async function generaCoordenadaSobreCarrerRodona(options = {}) {
  const c = options.centreRodona ?? options.centre ?? MOLLET_CENTRE_RODONA;
  const cx = Number(c.x);
  const cy = Number(c.y);
  const radiKm = Number(options.radiKm) > 0 ? Number(options.radiKm) : 100;
  const maxIntents = Number(options.maxIntents) || 45;
  const maxSnapMetres = Number(options.maxSnapMetres) > 0 ? Number(options.maxSnapMetres) : 900;
  const margeKmExtra = Number(options.margeKmSnap) >= 0 ? Number(options.margeKmSnap) : 3;
  const exclouMuntanya = options.excloureZonaMuntanya === true;

  for (let intent = 0; intent < maxIntents; intent += 1) {
    const bearing = Math.random() * 2 * Math.PI;
    const r = radiKm * Math.sqrt(Math.random());
    const { lon, lat } = desplacamentKmDesDeCentre(cx, cy, r, bearing);
    const proj = await projectaAlCarrerMesProper(lon, lat, options);
    if (!proj || !Number.isFinite(proj.distanciaMetres) || proj.distanciaMetres > maxSnapMetres) continue;

    const dCentreProj = distanciaKmHaversineCoords(cx, cy, proj.x, proj.y);
    if (dCentreProj > radiKm + margeKmExtra) continue;

    if (exclouMuntanya && coordenadaEnSectorMuntanyosAprox(proj.x, proj.y)) continue;

    return { x: proj.x, y: proj.y };
  }

  throw new Error(
    "No s'ha pogut obtenir un punt sobre carrer dins la rodona (OSRM nearest). Revisa radi o xarxa.",
  );
}

/**
 * Genera `total` punts únics sobre vial dins un disc de `radiKm` al voltant del centre.
 */
export async function generaPuntsSobreCarrerRodona(total, options = {}) {
  const n = Number(total);
  if (!Number.isFinite(n) || n < 1) return [];

  const punts = [];
  const vist = new Set();
  const decimals = Number(options.decimalsArrodoniment) >= 4 ? Number(options.decimalsArrodoniment) : 5;
  let buitsSeguits = 0;
  const maxBuitsSeguits = Math.max(800, n * 100);

  while (punts.length < n) {
    if (buitsSeguits > maxBuitsSeguits) {
      throw new Error(
        `No s'han pogut generar ${n} punts únics dins la rodona (col·lisions o fallades OSRM).`,
      );
    }

    const p = await generaCoordenadaSobreCarrerRodona(options);
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
