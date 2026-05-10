/**
 * Pipeline: Excel → Pedido[] → agrupació Entrega → **horaris.xlsx** (franja per dia setmana + nom comerç) →
 * geocodificació Nominatim → vector d’entregues amb coords →
 * `generarRutes` (sweep) → JSON de rutes + HTML amb mapa OSRM.
 *
 * No inventa dades: entregues sense adreça es salten; errors de Nominatim es registren. Les entregues que acaben sense
 * coordenades vàlides **no entren** a l’optimitzador (com si el pedido no s’hagués fet).
 *
 * Ús:
 *   npm run excel:entregues-geocode
 *   npm run excel:entregues-geocode -- --max 0    (sense límit d’entregues; cal `--` abans dels arguments npm)
 *   node src/scripts/excel-a-entregues-geocodificar.js --salt 1
 *   node src/scripts/excel-a-entregues-geocodificar.js --totes-dies   (geocodifica tots els dies)
 *   node src/scripts/excel-a-entregues-geocodificar.js --dia 2026-03-15   (només aquest dia; mateix format que la columna dia / ISO)
 *   node src/scripts/excel-a-entregues-geocodificar.js --dia 15/03/2026
 *   node src/scripts/excel-a-entregues-geocodificar.js --max 0       (sense límit d’entregues geocodificades)
 *   node src/scripts/excel-a-entregues-geocodificar.js --magatzem 2.22722,41.54714   (lon,lat; per defecte igual que el magatzem fix)
 *   node src/scripts/excel-a-entregues-geocodificar.js --horaris fixtures/excel/horaris.xlsx
 *   node src/scripts/excel-a-entregues-geocodificar.js --sense-geocode   (sense Nominatim: coords deterministes al voltant del magatzem; només proves / estalvi API)
 *
 * Memòria cau temporal de coordenades (per no repetir Nominatim mentre es prova el flux): fitxer
 * `output/geocodificar-cache-coords.json` (la carpeta `output/` ja està ignorada per git). Esborra’l o defineix
 * `GEOCODE_CACHE=false` per forçar peticions fresques; quan el pipeline sigui diari / estable es pot treure aquesta capa.
 *
 * Variables d’entorn opcionals:
 *   EXCEL_PATH — camí absolut o relatiu a un altre xlsx (per defecte fixtures/excel/comandes.xlsx via `llegeixExcelAPedidos`).
 *   `--max N` — prioritari sobre l’entorn: màxim d’entregues a geocodificar (N=0 sense límit).
 *   MAX_GEOCODE_ENTREGUES — mateix límit si no passes `--max`; per defecte al codi **500**.
 *   GEOCODE_TOTES_DIES=true — igual que `--totes-dies`: geocodifica **tots** els dies (per defecte només els **N** calendaris més antics; N = {@link QUANTITAT_DIES_DEFECTE_GEOCODE} o `GEOCODE_QUANTITAT_DIES`).
 *   GEOCODE_QUANTITAT_DIES — enter ≥ 1: quants dies calendarístics més antics incloure quan no és `--totes-dies` ni `--dia` (per defecte {@link QUANTITAT_DIES_DEFECTE_GEOCODE}).
 *   GEOCODE_INTERVAL_MS — pausa entre **entregues** davant Nominatim en ms (per defecte **1100**). Dins cada entrega el servei pot fer diversos intents amb la seva pròpia pausa.
 *   GEOCODE_FAIL_ON_ERRORS=true (o EXCEL_PIPELINE_STRICT=yes) — al finalitzar, codi de sortida ≠ 0 si hi ha hagut errors de geocodificació (Nominatim / coords invàlides).
 *   `--dia` / `EXCEL_DIA` / `GEOCODE_DIA` — filtre manual d’un sol dia calendarístic (té prioritat sobre `--totes-dies` i sobre el filtre de primers dies).
 *   MAGATZEM_XY — «lon,lat» del magatzem (alternativa a `--magatzem`), o bé MAGATZEM_X i MAGATZEM_Y.
 *   Si no es defineix res d’això, el magatzem és **sempre** el punt fix Mollet: **lon** {@link MAGATZEM_LONGITUD_DEFECTE}, **lat** {@link MAGATZEM_LATITUD_DEFECTE}.
 *   HORARIS_EXCEL_PATH — camí a `horaris.xlsx` (per defecte `fixtures/excel/horaris.xlsx`). També `--horaris camí`.
 *   HORARIS_SALT — files a saltar al full d’horaris (per defecte `0`; posa `1` si la primera fila és capçalera).
 *   GEOCODE_CACHE — `false` / `0` / `no`: desactiva la memòria cau de coordenades (per defecte activada).
 *   GEOCODE_CACHE_PATH — camí alternatiu al JSON de memòria cau (per defecte `output/geocodificar-cache-coords.json`).
 *   `--sense-geocode` — no crida Nominatim; assigna coordenades **mock** deterministes (hash de l’adreça) al voltant del magatzem (`--magatzem` / MAGATZEM_* / Mollet per defecte). No és per producció.
 *   EXCEL_SENSE_GEOCODE=true o SKIP_GEOCODE=true — mateix efecte que `--sense-geocode`.
 *
 * Sortida (relativa a l’arrel del backend): `output/excel-rutes.json`, `output/excel-rutes.html`.
 *
 * Per defecte es geocodifiquen les entregues del **primer dia calendarístic** (el més antic de la columna «dia»), llevat que passem **`--dia`** (o `EXCEL_DIA` / `GEOCODE_DIA`).
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { geocodificarAdrecaNominatimCompleta } from '../models/logistica/services/geocodificar-adreca.service.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import {
  aplicaFrangesHorariesALesEntregues,
  llegeixExcelHoraris,
  RUTA_EXCEL_HORARIS_DEFECTE,
} from '../models/logistica/services/excel-horaris.reader.js';
import {
  llegeixExcelAPedidos,
  normalitzaValorDia,
} from '../models/logistica/services/excel-a-pedidos.reader.js';
import { normalitzaCoordenades } from '../models/logistica/utils/coordenades.utils.js';
import { agrupaPedidosEnEntregues } from '../models/logistica/utils/entrega.utils.js';
import {
  calculaGeometriesRutes,
  construeixPayloadVisual,
  escriuHtmlVistaRutes,
} from './utils/rutes-html-visual.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arrelBackend = path.join(__dirname, '..', '..');

/** Sortida del pla de rutes + visualització (relatiu a l’arrel del backend). */
const OUTPUT_RUTES_JSON = path.join(arrelBackend, 'output', 'excel-rutes.json');
const OUTPUT_RUTES_HTML = path.join(arrelBackend, 'output', 'excel-rutes.html');

/** Longitud / latitud fixes del magatzem de sortida (convenció: `x` = lon, `y` = lat). */
export const MAGATZEM_LONGITUD_DEFECTE = 2.22722;
export const MAGATZEM_LATITUD_DEFECTE = 41.54714;

/** Magatzem per defecte del script (Mollet) si no sobreescrius amb `--magatzem` / MAGATZEM_*. */
const MAGATZEM_FALLBACK = {
  x: MAGATZEM_LONGITUD_DEFECTE,
  y: MAGATZEM_LATITUD_DEFECTE,
};

const TOTAL_PASSOS = 7;

/** Sense `--totes-dies`: nombre de dies calendarístics més antics a incloure (per defecte només el primer dia). */
export const QUANTITAT_DIES_DEFECTE_GEOCODE = 1;

/** Per defecte només es geocodifiquen les primeres N entregues (després d’agrupar). `0` = sense límit. */
export const DEFAULT_MAX_ENTREGUES_GEOCODE = 500;

function pasLog(pas, msg, ok = true) {
  const estat = ok ? 'OK' : 'KO';
  console.log(`[excel→rutes] pas ${pas}/${TOTAL_PASSOS} · ${msg} · ${estat}`);
}

/** Centre mitjà de les coordenades vàlides (útil per anàlisi; el pla de rutes usa magatzem fix Mollet per defecte). */
export function centreMitjanaEntregues(entregues) {
  const punts = [];
  for (const e of entregues) {
    const c = normalitzaCoordenades(e.coordenades);
    if (c) punts.push(c);
  }
  if (punts.length === 0) return null;
  const sx = punts.reduce((a, p) => a + p.x, 0);
  const sy = punts.reduce((a, p) => a + p.y, 0);
  return { x: sx / punts.length, y: sy / punts.length };
}

/**
 * @param {string} str «lon,lat» o separadors espais
 * @returns {{ x: number, y: number }|null}
 */
export function parseMagatzemString(str) {
  if (str == null || String(str).trim() === '') return null;
  const parts = String(str)
    .trim()
    .split(/[\s,;]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length < 2) return null;
  return { x: parts[0], y: parts[1] };
}

/**
 * Coordenades deterministes al voltant del magatzem (proves quan no es vol Nominatim).
 * @param {string|null|undefined} adreca
 * @param {{ x: number, y: number }} magatzem
 */
export function coordenadesMockDesAdreca(adreca, magatzem) {
  const base =
    magatzem && Number.isFinite(Number(magatzem.x)) && Number.isFinite(Number(magatzem.y))
      ? magatzem
      : { ...MAGATZEM_FALLBACK };
  let hash = 0;
  const s = String(adreca ?? '');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const spread = 0.22;
  const dx = ((Math.abs(hash) % 1000) / 1000 - 0.5) * 2 * spread;
  const dy = ((Math.abs(hash >> 7) % 1000) / 1000 - 0.5) * 2 * spread;
  return { x: base.x + dx, y: base.y + dy };
}

/** @param {{ senseGeocode?: boolean }} args */
export function senseGeocodeActiu(args) {
  if (args?.senseGeocode === true) return true;
  const v = String(process.env.EXCEL_SENSE_GEOCODE ?? process.env.SKIP_GEOCODE ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Prioritat: `--magatzem` / MAGATZEM_XY / MAGATZEM_X+Y → sinó magatzem fix Mollet
 * ({@link MAGATZEM_LONGITUD_DEFECTE}, {@link MAGATZEM_LATITUD_DEFECTE}). No s’usa el centre mitjà de les entregues.
 *
 * @param {unknown[]} _entreguesValides Es manté per compatibilitat amb crides anteriors; no s’utilitzen per triar el magatzem.
 * @param {{ magatzemStr?: string|null }} args
 */
export function resolMagatzem(_entreguesValides, args) {
  const cli = parseMagatzemString(args.magatzemStr);
  if (cli) return { punt: cli, origen: 'CLI (--magatzem)' };

  const envXy = process.env.MAGATZEM_XY?.trim();
  if (envXy) {
    const p = parseMagatzemString(envXy);
    if (p) return { punt: p, origen: 'MAGATZEM_XY' };
  }

  const ex = process.env.MAGATZEM_X;
  const ey = process.env.MAGATZEM_Y;
  if (ex != null && ey != null) {
    const x = Number(ex);
    const y = Number(ey);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { punt: { x, y }, origen: 'MAGATZEM_X / MAGATZEM_Y' };
    }
  }

  return {
    punt: { ...MAGATZEM_FALLBACK },
    origen: `defecte (Mollet · ${MAGATZEM_LATITUD_DEFECTE}°, ${MAGATZEM_LONGITUD_DEFECTE}°)`,
  };
}

function serialitzaResultatOptim(resultat, magatzem, meta) {
  return {
    generat: new Date().toISOString(),
    magatzem,
    meta,
    rutes: resultat.rutes.map((ruta) => ({
      camio: {
        id: ruta.camio.id,
        capacitatMaxima: ruta.camio.capacitatMaxima ?? ruta.camio.capacitat,
      },
      horaSortidaMagatzem: ruta.horaSortidaMagatzem ?? null,
      horaTornadaMagatzem: ruta.horaTornadaMagatzem ?? null,
      volumOcupat: ruta.volumOcupat,
      entregues: ruta.entregues.map((e, idx) => ({
        ordre: idx + 1,
        identificador: e.identificador,
        coordenades: e.coordenades,
        carrer: e.carrer ?? null,
        codiPostal: e.codiPostal ?? null,
        municipi: e.municipi ?? null,
        volumTotal: e.volumTotal,
        horaInici: e.horaInici ?? null,
        horaFinal: e.horaFinal ?? null,
        arribadaHoraAproximada: e.arribadaHora ?? e.horaDEntrega ?? null,
        sortidaHoraAproximada: e.sortidaHora ?? null,
        arribadaMinutsDesDeMitjanit: Number.isFinite(Number(e.arribadaMinuts)) ? e.arribadaMinuts : null,
        sortidaMinutsDesDeMitjanit: Number.isFinite(Number(e.sortidaMinuts)) ? e.sortidaMinuts : null,
        tempsDescarregaAproximMinuts:
          e.tempsDescarregaMinuts != null && Number.isFinite(Number(e.tempsDescarregaMinuts))
            ? Number(e.tempsDescarregaMinuts)
            : null,
        pedidos: (e.pedidos || []).map((p) => ({
          nom: p.nom,
          dia: p.dia ?? null,
          producte: p.producte ?? null,
          tipusCarrega: p.tipusCarrega ?? null,
          factorCaixesPerUnitat: p.factorCaixesPerUnitat,
          quantitatCaixes: p.quantitatCaixes,
          volumTotal: p.volumTotal,
        })),
      })),
    })),
    entreguesNoAssignades: resultat.entreguesNoAssignades.map((e) => ({
      identificador: e.identificador,
      adreca: e.adreca ?? null,
      volumTotal: e.volumTotal,
    })),
  };
}

function espera(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  /** @type {{ salt: number|null, rutaExcel: string|null, totesDies: boolean, diaManual?: string|null, maxEntregues?: number, magatzemStr?: string|null, rutaHoraris?: string|null, senseGeocode?: boolean, flagsDesconeguts: string[] }} */
  const out = {
    salt: null,
    rutaExcel: null,
    totesDies: false,
    diaManual: null,
    magatzemStr: null,
    rutaHoraris: null,
    senseGeocode: false,
    flagsDesconeguts: [],
  };
  const consumits = new Set();

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--salt' && argv[i + 1] != null) {
      out.salt = Math.max(0, parseInt(argv[i + 1], 10) || 0);
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--excel' && argv[i + 1] != null) {
      out.rutaExcel = path.resolve(process.cwd(), argv[i + 1]);
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--dia' && argv[i + 1] != null) {
      out.diaManual = String(argv[i + 1]).trim();
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--totes-dies') {
      consumits.add(i);
      out.totesDies = true;
    } else if (a === '--max' && argv[i + 1] != null) {
      out.maxEntregues = parseInt(argv[i + 1], 10);
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--magatzem' && argv[i + 1] != null) {
      out.magatzemStr = argv[i + 1];
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--horaris' && argv[i + 1] != null) {
      out.rutaHoraris = path.resolve(process.cwd(), argv[i + 1]);
      consumits.add(i);
      consumits.add(i + 1);
      i += 1;
    } else if (a === '--sense-geocode') {
      consumits.add(i);
      out.senseGeocode = true;
    }
  }

  const desconeguts = [];
  for (let i = 2; i < argv.length; i += 1) {
    if (consumits.has(i)) continue;
    const token = argv[i];
    if (typeof token === 'string' && token.startsWith('-')) desconeguts.push(token);
  }
  out.flagsDesconeguts = desconeguts;
  return out;
}

function resolRutaHorarisExcel(args) {
  if (args.rutaHoraris) return args.rutaHoraris;
  const env = process.env.HORARIS_EXCEL_PATH?.trim();
  if (env) return path.resolve(process.cwd(), env);
  return RUTA_EXCEL_HORARIS_DEFECTE;
}

/**
 * Límit d’entregues a geocodificar: defecte {@link DEFAULT_MAX_ENTREGUES_GEOCODE}.
 * Prioritat: `--max` (CLI) → `MAX_GEOCODE_ENTREGUES` (entorn) → defecte.
 * Valor **0** = sense límit (totes les entregues del lot actual).
 */
export function resolLimitGeocodeMaxEntregues(args) {
  if (args.maxEntregues !== undefined && args.maxEntregues !== null) {
    const n = Number(args.maxEntregues);
    if (Number.isFinite(n) && n >= 0) return n === 0 ? Infinity : n;
  }
  const envRaw = process.env.MAX_GEOCODE_ENTREGUES?.trim();
  if (envRaw !== undefined && envRaw !== '') {
    const n = parseInt(envRaw, 10);
    if (Number.isFinite(n) && n >= 0) return n === 0 ? Infinity : n;
  }
  return DEFAULT_MAX_ENTREGUES_GEOCODE;
}

/**
 * Pausa entre geocodificacions d’**entregues** consecutives (Nominatim). Variable `GEOCODE_INTERVAL_MS`; defecte 1100 ms.
 */
export function resolIntervalMsGeocode() {
  const raw = process.env.GEOCODE_INTERVAL_MS?.trim();
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 1100;
}

/**
 * Dies calendarístics més antics a incloure sense `--totes-dies` ni `--dia`. Variable `GEOCODE_QUANTITAT_DIES`; defecte {@link QUANTITAT_DIES_DEFECTE_GEOCODE}.
 */
export function resolQuantitatDiesPrimersGeocode() {
  const raw = process.env.GEOCODE_QUANTITAT_DIES?.trim();
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return QUANTITAT_DIES_DEFECTE_GEOCODE;
}

/** Si és cert, `process.exitCode = 1` quan hi ha geocodificacions fallides al pas Nominatim. */
export function geoFailStrictActiu() {
  const v = String(process.env.GEOCODE_FAIL_ON_ERRORS ?? process.env.EXCEL_PIPELINE_STRICT ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Tots els dies calendarístics únics dels pedidos, ordenats (YYYY-MM-DD; clau amb {@link normalitzaValorDia}).
 * @returns {string[]}
 */
export function obtenDiesCalendaristicsOrdenats(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return [];
  const claus = new Set();
  for (const p of pedidos) {
    const k = normalitzaValorDia(p.dia);
    if (k != null && String(k).trim() !== '') claus.add(String(k).trim());
  }
  return [...claus].sort();
}

/**
 * Dia calendari més antic entre els pedidos (primer element de {@link obtenDiesCalendaristicsOrdenats}).
 * @returns {string|null}
 */
export function obtenPrimerDiaCalendaristic(pedidos) {
  const dies = obtenDiesCalendaristicsOrdenats(pedidos);
  return dies.length > 0 ? dies[0] : null;
}

/**
 * Només pedidos dels N calendaris més antics (p. ex. N=2 → primer i segon dia).
 * @returns {{ pedidos: typeof pedidos, diesSeleccionats: string[] }}
 */
export function filtraPedidosPrimersDies(pedidos, quantitatDies) {
  const ordenats = obtenDiesCalendaristicsOrdenats(pedidos);
  const nIn = Number(quantitatDies);
  const n = Number.isFinite(nIn) && nIn >= 1 ? Math.floor(nIn) : 1;
  if (ordenats.length === 0) {
    return { pedidos, diesSeleccionats: [] };
  }
  const presos = Math.min(n, ordenats.length);
  const seleccionats = new Set(ordenats.slice(0, presos));
  const filtrats = pedidos.filter((p) => {
    const k = normalitzaValorDia(p.dia);
    return k != null && seleccionats.has(String(k).trim());
  });
  return { pedidos: filtrats, diesSeleccionats: ordenats.slice(0, presos) };
}

/**
 * @returns {{ pedidos: typeof pedidos, diaSeleccionat: string|null }}
 */
export function filtraPedidosNomésPrimerDia(pedidos) {
  const { pedidos: filtrats, diesSeleccionats } = filtraPedidosPrimersDies(pedidos, 1);
  return { pedidos: filtrats, diaSeleccionat: diesSeleccionats[0] ?? null };
}

/**
 * Només pedidos la columna «dia» del qual coincideix amb `diaInput` (normalitzat com a l’Excel).
 *
 * @returns {{ pedidos: typeof pedidos, diaNormalitzat: string|null }}
 */
export function filtraPedidosPerDiaConcret(pedidos, diaInput) {
  const diaNorm = normalitzaValorDia(diaInput);
  if (diaNorm == null || String(diaNorm).trim() === '') {
    return { pedidos: [], diaNormalitzat: null };
  }
  const clau = String(diaNorm).trim();
  const filtrats = pedidos.filter((p) => {
    const k = normalitzaValorDia(p.dia);
    return k != null && String(k).trim() === clau;
  });
  return { pedidos: filtrats, diaNormalitzat: clau };
}

function coordenadesValides(entrega) {
  return normalitzaCoordenades(entrega.coordenades) != null;
}

function imprimeixVeredicte(resum) {
  const {
    pedidosExcelTotals = null,
    diesGeocode = null,
    nomesPrimerDia = false,
    filtreDiaManual = false,
    pedidosLlegits,
    entreguesAgrupadesTotals = null,
    entreguesTotals,
    ambAdreca,
    senseAdreca,
    geocodeOk,
    geocodeFallides,
    intervalMs,
    totesTenenCoordenadesValides,
    entreguesAmbCoords,
  } = resum;

  console.log('\n=== Veredicte ===\n');
  if (pedidosExcelTotals != null) {
    console.log(`Pedidos a l’Excel (abans de filtrar per dia): ${pedidosExcelTotals}`);
  }
  if (filtreDiaManual && diesGeocode && diesGeocode.length > 0) {
    const diesTxt = diesGeocode.join('», «');
    console.log(`Filtre actiu: només dia «${diesTxt}» (triat manualment amb --dia / EXCEL_DIA / GEOCODE_DIA).`);
  } else if (nomesPrimerDia && diesGeocode && diesGeocode.length > 0) {
    const diesTxt = diesGeocode.join('», «');
    console.log(
      diesGeocode.length === 1
        ? `Filtre actiu: només dia «${diesTxt}» (el més antic trobat).`
        : `Filtre actiu: els ${diesGeocode.length} primers dies calendarístics («${diesTxt}»), els més antics trobats.`,
    );
  } else if (nomesPrimerDia && (!diesGeocode || diesGeocode.length === 0)) {
    console.log(
      'Filtre per dies: no s’ha pogut detectar cap dia vàlid a la columna; s’han usat tots els pedidos.',
    );
  } else {
    console.log('Filtre per dia: desactivat (--totes-dies o GEOCODE_TOTES_DIES=true).');
  }
  console.log(`Pedidos usats per agrupar / geocodificar: ${pedidosLlegits}`);
  if (resum.entreguesAgrupadesTotals != null && resum.entreguesAgrupadesTotals !== entreguesTotals) {
    console.log(`Entregues agrupades (abans del límit de geocodificació): ${resum.entreguesAgrupadesTotals}`);
  }
  console.log(`Entregues processades en aquesta execució (geocodificació): ${entreguesTotals}`);
  console.log(`Entregues amb adreça (geocodificables): ${ambAdreca}`);
  console.log(`Entregues sense adreça (s’han saltat; sense coords): ${senseAdreca}`);
  console.log(`Geocodificacions Nominatim correctes: ${geocodeOk}`);
  console.log(`Geocodificacions fallides: ${geocodeFallides.length}`);
  if (geocodeFallides.length > 0 && geocodeFallides.length <= 30) {
    for (const f of geocodeFallides) {
      console.log(`  · ${f.identificador}: ${f.motiu}`);
    }
  } else if (geocodeFallides.length > 30) {
    console.log(`  (primeres 10)`);
    geocodeFallides.slice(0, 10).forEach((f) => {
      console.log(`  · ${f.identificador}: ${f.motiu}`);
    });
  }

  const totesAmbAdrecaTenenCoords =
    ambAdreca === 0 || (geocodeFallides.length === 0 && geocodeOk === ambAdreca);

  console.log('\n--- Conclusió ---');
  if (entreguesTotals === 0) {
    console.log(
      'No hi ha cap Entrega: revisa l’Excel (columnes, capçaleres, opció --salt) o el camí del fitxer.',
    );
    return;
  }

  console.log(
    `Vector d’Entregues amb coordenades vàlides a totes les entregues: ${totesTenenCoordenadesValides ? 'SÍ' : 'NO'} (${entreguesAmbCoords}/${entreguesTotals}).`,
  );

  if (totesTenenCoordenadesValides) {
    console.log(
      'Totes les entregues tenen { x: lon, y: lat } vàlids (cap inventada; geocodificació Nominatim per adreça).',
    );
  } else if (senseAdreca > 0 && totesAmbAdrecaTenenCoords) {
    console.log(
      'PARCIAL: les entregues amb adreça tenen coordenades; les que no tenien adreça al Excel segueixen sense coordenades (es descarten, sense inventar).',
    );
  } else if (geocodeFallides.length > 0) {
    console.log(
      'NO COMPLET: alguna entrega amb adreça no té coordenades (error Nominatim, xarxa o resposta buida).',
    );
  } else {
    console.log('Revisa els recomptes anteriors i l’Excel (files buides, columnes).');
  }

  console.log(
    `\n(Nominatim: ~1 req/s; interval entre peticions ≈ ${intervalMs} ms; moltes entregues → execució llarga.)\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.flagsDesconeguts.length > 0) {
    console.warn(
      `[excel→rutes] · Arguments CLI no reconeguts (reviseu l’ortografia): ${args.flagsDesconeguts.join(', ')}`,
    );
  }

  const envPath = process.env.EXCEL_PATH?.trim();
  const quantitatDiesCalendariFiltre = resolQuantitatDiesPrimersGeocode();
  const intervalMsEntreEntregues = resolIntervalMsGeocode();
  const opcionsExcel = {};
  if (args.salt != null) opcionsExcel.filesSaltadesInici = args.salt;

  let pedidos;
  if (args.rutaExcel) {
    pedidos = llegeixExcelAPedidos(args.rutaExcel, opcionsExcel);
  } else if (envPath) {
    pedidos = llegeixExcelAPedidos(path.resolve(process.cwd(), envPath), opcionsExcel);
  } else {
    pedidos = llegeixExcelAPedidos(opcionsExcel);
  }

  const pedidosExcelTotals = pedidos.length;
  pasLog(1, `Excel · ${pedidosExcelTotals} pedidos llegits des del full`, true);

  const totesDiesActiuEnv =
    args.totesDies === true || String(process.env.GEOCODE_TOTES_DIES ?? '').toLowerCase() === 'true';

  const diaManualRaw =
    (args.diaManual != null && String(args.diaManual).trim() !== '' ? String(args.diaManual).trim() : '') ||
    process.env.EXCEL_DIA?.trim() ||
    process.env.GEOCODE_DIA?.trim() ||
    '';

  let diesGeocode = null;
  let nomesPrimerDia = false;
  let filtreDiaManual = false;

  if (diaManualRaw !== '') {
    if (totesDiesActiuEnv) {
      console.warn(
        '[excel→rutes] · S’ha definit un dia manual (`--dia` o EXCEL_DIA / GEOCODE_DIA); s’ignora `--totes-dies` / GEOCODE_TOTES_DIES.',
      );
    }
    const { pedidos: pedDia, diaNormalitzat } = filtraPedidosPerDiaConcret(pedidos, diaManualRaw);
    if (diaNormalitzat == null) {
      const disponibles = obtenDiesCalendaristicsOrdenats(pedidos);
      console.error(
        `[excel→rutes] · Data no vàlida per al filtre «--dia»: «${diaManualRaw}». Dies trobats a l’Excel: ${disponibles.length ? disponibles.join(', ') : '(cap)'}`,
      );
      process.exitCode = 1;
      return;
    }
    diesGeocode = [diaNormalitzat];
    if (pedDia.length === 0) {
      const disponibles = obtenDiesCalendaristicsOrdenats(pedidos);
      console.error(
        `[excel→rutes] · Cap pedido per al dia ${diaNormalitzat} (entrada: «${diaManualRaw}»). Dies a l’Excel: ${disponibles.length ? disponibles.join(', ') : '(cap)'}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[excel→rutes] · Filtre dia manual (${diaNormalitzat}): ${pedDia.length} pedidos (de ${pedidosExcelTotals} a l’Excel).`,
    );
    pedidos = pedDia;
    nomesPrimerDia = false;
    filtreDiaManual = true;
  } else {
    const totesDiesActiu = totesDiesActiuEnv;
    nomesPrimerDia = !totesDiesActiu;

    if (nomesPrimerDia) {
      const { pedidos: pedFiltrats, diesSeleccionats } = filtraPedidosPrimersDies(
        pedidos,
        quantitatDiesCalendariFiltre,
      );
      diesGeocode = diesSeleccionats.length > 0 ? diesSeleccionats : null;
      if (diesSeleccionats.length > 0) {
        console.log(
          diesSeleccionats.length === 1
            ? `[excel→rutes] · Filtre «primer dia» (${diesSeleccionats[0]}): ${pedFiltrats.length} pedidos (de ${pedidosExcelTotals} a l’Excel).`
            : `[excel→rutes] · Filtre «${diesSeleccionats.length} primers dies» (${diesSeleccionats.join(', ')}): ${pedFiltrats.length} pedidos (de ${pedidosExcelTotals} a l’Excel).`,
        );
        pedidos = pedFiltrats;
      } else {
        console.warn(
          '[excel→rutes] · Filtre per dies: cap valor vàlid a la columna dia; es continua amb tots els pedidos.',
        );
      }
    }
  }

  let entregues = agrupaPedidosEnEntregues(pedidos, { EntregaClass: Entrega });

  const entreguesAgrupadesTotals = entregues.length;
  const limitGeo = resolLimitGeocodeMaxEntregues(args);
  if (Number.isFinite(limitGeo) && entregues.length > limitGeo) {
    console.warn(
      `[excel→rutes] · Geocodificació limitada a les primeres ${limitGeo} entregues (de ${entreguesAgrupadesTotals}). Per totes: --max 0 o MAX_GEOCODE_ENTREGUES=0`,
    );
    entregues = entregues.slice(0, limitGeo);
  }

  pasLog(
    2,
    `Agrupació · ${pedidos.length} pedidos → ${entreguesAgrupadesTotals} entregues agrupades; lot geocode: ${entregues.length}`,
    true,
  );

  const rutaHorarisResolta = resolRutaHorarisExcel(args);
  const saltHorarisRaw = process.env.HORARIS_SALT ?? process.env.HORARIS_FILES_SALT ?? '0';
  const saltHoraris = Math.max(0, parseInt(String(saltHorarisRaw), 10) || 0);

  /** @type {Record<string, unknown>|null} */
  let metaHoraris = null;

  if (!existsSync(rutaHorarisResolta)) {
    console.warn(
      `[excel→rutes] · Horaris: no existeix el fitxer (${rutaHorarisResolta}); es continua sense franjes de l’Excel d’horaris.`,
    );
    pasLog(3, 'Horaris · fitxer absent; cap franja assignada des del full (opcional)', true);
    metaHoraris = {
      fitxerUsat: null,
      aplicades: 0,
      senseFitxer: true,
    };
  } else {
    try {
      const { mapa, duplicats, filesRellevants } = llegeixExcelHoraris(rutaHorarisResolta, {
        filesSaltadesInici: saltHoraris,
      });
      if (duplicats.length > 0) {
        console.warn(
          `[excel→rutes] · Horaris: ${duplicats.length} entrades duplicades (mateix dia setmana + nom); es conserva l’última franja.`,
        );
      }
      const stats = aplicaFrangesHorariesALesEntregues(entregues, mapa);
      metaHoraris = {
        fitxerUsat: rutaHorarisResolta,
        saltFiles: saltHoraris,
        filesRellevants,
        clausAlMapa: mapa.size,
        aplicades: stats.aplicades,
        totalEntregues: stats.total,
        senseCoincidencia: stats.senseCoincidencia,
        capDeSetmana: stats.capDeSetmana,
        senseNom: stats.senseNom,
      };

      pasLog(
        3,
        `Horaris · ${stats.aplicades}/${stats.total} entregues amb franja (dia laborable 1–5 + nom comerç) · mapa ${mapa.size} regles`,
        stats.aplicades > 0 || mapa.size === 0,
      );
      if (stats.senseCoincidencia > 0) {
        console.warn(
          `[excel→rutes] · Horaris: ${stats.senseCoincidencia} entregues sense fila coincident al full (revisa nom i dia).`,
        );
      }
      if (stats.capDeSetmana > 0) {
        console.warn(
          `[excel→rutes] · Horaris: ${stats.capDeSetmana} entregues amb «dia» en cap de setmana (el full només té dilluns–divendres).`,
        );
      }
    } catch (err) {
      pasLog(
        3,
        `Horaris · error: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
      throw err;
    }
  }

  if (pedidosExcelTotals > 5000) {
    console.warn(
      `[excel→rutes] · Avís: ${pedidosExcelTotals} pedidos a l’Excel; revisa files buides o usa --salt 1 si hi ha capçalera.`,
    );
  }

  const ambAdrecaPrevist = entregues.filter(
    (e) => e.adreca != null && String(e.adreca).trim() !== '',
  ).length;
  const senseGeo = senseGeocodeActiu(args);
  const { punt: magatzemPerMock } = resolMagatzem([], args);

  pasLog(
    4,
    senseGeo
      ? `Coords mock (sense Nominatim) · ${ambAdrecaPrevist} entregues amb adreça · magatzem ref lon=${magatzemPerMock.x}, lat=${magatzemPerMock.y}`
      : `Geocodificació Nominatim · ${ambAdrecaPrevist} entregues amb adreça (interval ≈ ${intervalMsEntreEntregues} ms entre entregues; cada entrega pot fer diversos intents interns)`,
    true,
  );

  const geocodeFallides = [];
  let geocodeOk = 0;
  let senseAdreca = 0;
  let ambAdreca = 0;
  const INTERVAL_MS = intervalMsEntreEntregues;
  let primeraPeticioGeocode = true;
  let comptadorGeocode = 0;

  for (const entrega of entregues) {
    const teAdreca = entrega.adreca != null && String(entrega.adreca).trim() !== '';
    if (!teAdreca) {
      senseAdreca += 1;
      continue;
    }

    ambAdreca += 1;
    comptadorGeocode += 1;

    let okFila = false;

    if (senseGeo) {
      entrega.coordenades = coordenadesMockDesAdreca(entrega.adreca, magatzemPerMock);
      if (coordenadesValides(entrega)) {
        geocodeOk += 1;
        okFila = true;
      } else {
        geocodeFallides.push({
          identificador: entrega.identificador ?? '?',
          motiu: 'Coords mock invàlides (intern)',
        });
      }
    } else {
      if (!primeraPeticioGeocode && INTERVAL_MS > 0) {
        await espera(INTERVAL_MS);
      }
      primeraPeticioGeocode = false;

      try {
        entrega.coordenades = await geocodificarAdrecaNominatimCompleta(
          {
            adreca: String(entrega.adreca).trim(),
            carrer: entrega.carrer ?? null,
            codiPostal: entrega.codiPostal ?? null,
            municipi: entrega.municipi ?? null,
          },
          fetch,
        );
        if (coordenadesValides(entrega)) {
          geocodeOk += 1;
          okFila = true;
        } else {
          geocodeFallides.push({
            identificador: entrega.identificador ?? '?',
            motiu: 'Coordenades no vàlides després de Nominatim',
          });
        }
      } catch (err) {
        geocodeFallides.push({
          identificador: entrega.identificador ?? '?',
          motiu: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const id = entrega.identificador ?? '?';
    const etiquetaPas = senseGeo ? 'mock-coords' : 'geocode';
    console.log(
      `[excel→rutes] pas 4/${TOTAL_PASSOS} · ${etiquetaPas} ${comptadorGeocode}/${ambAdrecaPrevist} · ${id} · ${okFila ? 'coords OK' : 'sense coords vàlides'}`,
    );
  }

  pasLog(
    4,
    senseGeo
      ? `Coords mock acabades · ${geocodeOk} vàlides · ${geocodeFallides.length} fallides`
      : `Geocodificació acabada · ${geocodeOk} amb coords vàlides · ${geocodeFallides.length} fallides`,
    geocodeFallides.length === 0 || geocodeOk > 0,
  );

  const entreguesPlanificables = entregues.filter((e) => coordenadesValides(e));
  const entreguesAmbCoords = entreguesPlanificables.length;
  const descartadesSenseCoords = entregues.length - entreguesPlanificables.length;
  const totesTenenCoordenadesValides =
    entregues.length > 0 && entregues.every((e) => coordenadesValides(e));

  imprimeixVeredicte({
    pedidosExcelTotals,
    diesGeocode,
    nomesPrimerDia,
    filtreDiaManual,
    pedidosLlegits: pedidos.length,
    entreguesAgrupadesTotals,
    entreguesTotals: entregues.length,
    ambAdreca,
    senseAdreca,
    geocodeOk,
    geocodeFallides,
    intervalMs: INTERVAL_MS,
    totesTenenCoordenadesValides,
    entreguesAmbCoords,
  });

  pasLog(
    5,
    `Coordenades per al pla de rutes · ${entreguesPlanificables.length} vàlides · ${descartadesSenseCoords} ignorades (sense coords vàlides, no entren al sweep)`,
    true,
  );
  if (descartadesSenseCoords > 0 && descartadesSenseCoords <= 25) {
    const ids = entregues
      .filter((e) => !coordenadesValides(e))
      .map((e) => e.identificador ?? '?');
    console.log(`[excel→rutes] · Descartades (mostra): ${ids.join(', ')}`);
  }

  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();
  const { punt: magatzem, origen: origenMagatzem } = resolMagatzem(entreguesPlanificables, args);
  console.log(
    `[excel→rutes] · Magatzem (${origenMagatzem}): lon=${magatzem.x}, lat=${magatzem.y}`,
  );

  let resultat = { rutes: [], entreguesNoAssignades: [] };
  if (entreguesPlanificables.length === 0) {
    pasLog(6, 'generarRutes (sweep) · cap entrega amb coordenades; vector de rutes buit', false);
  } else {
    console.log('[excel→rutes] pas 6 · Executant generarRutes (sweep optimizer, coordenades reals ja definides)…');
    try {
      resultat = await generarRutes(entreguesPlanificables, flota, magatzem, {
        EntregaClass: Entrega,
        usaMock: false,
        assignacioCompleta: true,
        optimIntraRutaCarrers: true,
      });
      pasLog(
        6,
        `generarRutes · ${resultat.rutes.length} rutes · ${resultat.entreguesNoAssignades.length} entregues no assignades`,
        resultat.rutes.length > 0 || resultat.entreguesNoAssignades.length === entreguesPlanificables.length,
      );
    } catch (err) {
      pasLog(6, `generarRutes · error: ${err instanceof Error ? err.message : String(err)}`, false);
      throw err;
    }
  }

  console.log('[excel→rutes] pas 7 · Calculant geometries OSRM (tram per tram) per al mapa…');
  let visualData = [];
  try {
    visualData = await calculaGeometriesRutes(resultat.rutes, magatzem);
  } catch (err) {
    pasLog(7, `OSRM/export · error: ${err instanceof Error ? err.message : String(err)}`, false);
    throw err;
  }

  const titolHtml = 'Comandes Excel → rutes (sweep)';
  const payload = construeixPayloadVisual(resultat, visualData, magatzem, {
    titol: titolHtml,
    entreguesTotals: entreguesPlanificables.length,
  });

  const GEOCODE_FALIDES_JSON_MAX = 50;
  const metaJson = {
    titol: titolHtml,
    senseGeocodeNominatim: senseGeo,
    origenMagatzem,
    filtreDiaManual,
    ingressDiaManual: filtreDiaManual ? diaManualRaw : null,
    quantitatDiesCalendariFiltre: filtreDiaManual || totesDiesActiuEnv ? null : quantitatDiesCalendariFiltre,
    geocodeIntervalMsEntreEntregues: INTERVAL_MS,
    geoFailStrict: geoFailStrictActiu(),
    pedidosExcelTotals,
    pedidosUsats: pedidos.length,
    entreguesAgrupadesTotals,
    entreguesGeocodificadesLot: entregues.length,
    entreguesAmbCoordsVàlides: entreguesPlanificables.length,
    entreguesDescartadesSenseCoords: descartadesSenseCoords,
    geocodeFallidesCount: geocodeFallides.length,
    geocodeFallidesMostra: geocodeFallides.slice(0, GEOCODE_FALIDES_JSON_MAX),
    rutesGenerades: resultat.rutes.length,
    entreguesNoAssignades: resultat.entreguesNoAssignades.length,
    horaris: metaHoraris,
  };

  await mkdir(path.dirname(OUTPUT_RUTES_JSON), { recursive: true });
  const jsonExport = serialitzaResultatOptim(resultat, magatzem, metaJson);
  await writeFile(OUTPUT_RUTES_JSON, JSON.stringify(jsonExport, null, 2), 'utf8');

  const htmlPath = await escriuHtmlVistaRutes(payload, OUTPUT_RUTES_HTML);

  console.log(`[excel→rutes] · JSON: ${OUTPUT_RUTES_JSON}`);
  console.log(`[excel→rutes] · HTML: ${htmlPath}`);
  pasLog(
    7,
    `OSRM (${visualData.length} geometries) + JSON + HTML · exportació completada`,
    true,
  );

  console.log('\n=== Resum pla de rutes ===\n');
  console.log(`Vector de rutes: ${resultat.rutes.length}`);
  console.log(`Entregues no assignades (al sweep): ${resultat.entreguesNoAssignades.length}`);
  console.log(`Obre el mapa: ${pathToFileURL(htmlPath).href}\n`);

  if (geoFailStrictActiu() && geocodeFallides.length > 0) {
    process.exitCode = 1;
    console.warn(
      `[excel→rutes] · GEOCODE_FAIL_ON_ERRORS / EXCEL_PIPELINE_STRICT: ${geocodeFallides.length} geocodificació(ns) fallida(es); codi de sortida 1.`,
    );
  }
}

const execDesDelCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (execDesDelCli) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { main };
