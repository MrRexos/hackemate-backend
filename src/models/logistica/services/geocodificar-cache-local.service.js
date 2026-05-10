import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Memòria cau local de coordenades (JSON a `output/`) per evitar repetir peticions Nominatim
 * mentre es desenvolupa el flux. Es pot esborrar el fitxer o desactivar amb `GEOCODE_CACHE=false`.
 * Pensada per ser substituïda quan hi hagi recàlcul diari / backend estable.
 */

/** @type {string|null} */
let rutaCacheResolta = null;

/** @type {{ versio: number, entrades: Record<string, { x: number, y: number }> }|null} */
let magatzemMemoria = null;

/** Indica si ja hem intentat llegir el fitxer (per no tornar a llegir si no existeix). */
let inicialitzat = false;

export const RUTA_CACHE_GEOCODIFICACIO_DEFECTE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../output/geocodificar-cache-coords.json',
);

function resolRutaCacheFitxer() {
  if (rutaCacheResolta != null) return rutaCacheResolta;
  const env = process.env.GEOCODE_CACHE_PATH;
  rutaCacheResolta =
    env != null && String(env).trim() !== ''
      ? path.resolve(process.cwd(), String(env).trim())
      : RUTA_CACHE_GEOCODIFICACIO_DEFECTE;
  return rutaCacheResolta;
}

/** Cache activada per defecte; `GEOCODE_CACHE=false|0|no` la desactiva. */
export function geocodeCacheActiu() {
  const v = process.env.GEOCODE_CACHE;
  if (v === undefined || v === '') return true;
  const s = String(v).trim().toLowerCase();
  return s !== 'false' && s !== '0' && s !== 'no';
}

function normText(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Clau estable després de tenir carrer/CP/municipi/adreça plena com els usa Nominatim.
 * Retorna cadena buida si no hi ha res per cachejar.
 *
 * @param {{ adreca?: string|null, carrer?: string|null, codiPostal?: string|null, municipi?: string|null }} opts
 */
export function clauCacheGeocodificacio(opts) {
  const adreca = normText(opts.adreca ?? '');
  const carrer = normText(opts.carrer ?? '');
  const cp = String(opts.codiPostal ?? '').trim();
  const mun = normText(opts.municipi ?? '');
  if (!adreca && !carrer && !cp && !mun) return '';
  return `${adreca}|${carrer}|${cp}|${mun}`;
}

function carregaMagatzemDesDeFitxer() {
  const ruta = resolRutaCacheFitxer();
  if (!existsSync(ruta)) {
    magatzemMemoria = { versio: 1, entrades: {} };
    return;
  }
  try {
    const raw = readFileSync(ruta, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.entrades &&
      typeof parsed.entrades === 'object' &&
      !Array.isArray(parsed.entrades)
    ) {
      magatzemMemoria = {
        versio: typeof parsed.versio === 'number' ? parsed.versio : 1,
        entrades: /** @type {Record<string, { x: number, y: number }>} */ (parsed.entrades),
      };
    } else {
      magatzemMemoria = { versio: 1, entrades: {} };
    }
  } catch {
    magatzemMemoria = { versio: 1, entrades: {} };
  }
}

function asseguraMagatzem() {
  if (!inicialitzat) {
    inicialitzat = true;
    carregaMagatzemDesDeFitxer();
  }
  if (magatzemMemoria == null) {
    magatzemMemoria = { versio: 1, entrades: {} };
  }
}

/**
 * @param {string} clau
 * @returns {{ x: number, y: number }|null}
 */
export function obtenDesCacheLocal(clau) {
  if (!clau) return null;
  asseguraMagatzem();
  const v = magatzemMemoria.entrades[clau];
  if (
    !v ||
    typeof v !== 'object' ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y)
  ) {
    return null;
  }
  return { x: v.x, y: v.y };
}

/**
 * @param {string} clau
 * @param {{ x: number, y: number }} coords
 */
export function desaEnCacheLocal(clau, coords) {
  if (!clau || !coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return;
  asseguraMagatzem();
  magatzemMemoria.entrades[clau] = { x: coords.x, y: coords.y };
  const ruta = resolRutaCacheFitxer();
  const dir = path.dirname(ruta);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    ruta,
    `${JSON.stringify({ versio: magatzemMemoria.versio, entrades: magatzemMemoria.entrades }, null, 2)}\n`,
    'utf8',
  );
}
