import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { normalitzaValorDia } from './excel-a-pedidos.reader.js';

/**
 * Camí per defecte: `fixtures/excel/horaris.xlsx` (relatiu a l’arrel del backend).
 */
export const RUTA_EXCEL_HORARIS_DEFECTE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/excel/horaris.xlsx',
);

/**
 * Índex 0-based de columnes Excel (A=1 …):
 * col 5 → dia setmana (1 Dilluns … 5 Divendres), col 7 → nom comerç, cols 11–12 → franja.
 */
export const COLUMNES_HORARIS_DEFECTE = {
  diaSetmana: 4,
  nomComerc: 6,
  horaInici: 10,
  horaFi: 11,
};

function textPerNomComerc(val) {
  if (val == null || val === '') return '';
  return String(val).trim();
}

/**
 * Converteix cel·la Excel (fracció de dia, Date o text «HH:mm») a «HH:mm».
 */
export function normalitzaHoraExcel(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    let frac = val;
    if (frac >= 1) frac %= 1;
    if (frac < 0) frac = (frac % 1) + 1;
    const totalMin = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const h = val.getHours();
    const mi = val.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  const m = s.match(/(\d{1,2})\s*[:h.]\s*(\d{2})/i);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    return `${String(hh).padStart(2, '0')}:${m[2]}`;
  }
  return s || null;
}

export function normalitzaNomComerc(nom) {
  if (nom == null) return '';
  return String(nom)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Dilluns = 1 … Divendres = 5 (com a l’Excel d’horaris). Caps de setmana → `null`.
 * @param {unknown} diaClau Valor `dia` d’un pedido (normalitzat com a ISO `YYYY-MM-DD` si cal).
 */
export function diaSetmanaLaborableDesDeClauDia(diaClau) {
  const s = normalitzaValorDia(diaClau);
  if (!s) return null;
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return null;
  const y = parseInt(iso[1], 10);
  const mo = parseInt(iso[2], 10) - 1;
  const d = parseInt(iso[3], 10);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  const wd = dt.getUTCDay();
  if (wd === 0 || wd === 6) return null;
  return wd;
}

function resolArgumentsExcelHoraris(arg1, arg2) {
  if (typeof arg1 === 'string') {
    return { rutaFitxer: arg1, options: arg2 ?? {} };
  }
  if (arg1 !== undefined && typeof arg1 === 'object' && !Array.isArray(arg1) && arg2 === undefined) {
    return { rutaFitxer: RUTA_EXCEL_HORARIS_DEFECTE, options: arg1 };
  }
  return { rutaFitxer: RUTA_EXCEL_HORARIS_DEFECTE, options: {} };
}

/**
 * @typedef {object} OpcionsLlegeixExcelHoraris
 * @property {string} [nomFull]
 * @property {number} [indexFull]
 * @property {number} [filesSaltadesInici=0]
 * @property {Partial<typeof COLUMNES_HORARIS_DEFECTE>} [columnes]
 */

/**
 * Llegeix el full d’horaris i construeix un mapa clau `diaSetmana (1–5)\u0001nomNormalitzat` → franja.
 *
 * @param {string | OpcionsLlegeixExcelHoraris} [rutaFitxerOCopcions]
 * @param {OpcionsLlegeixExcelHoraris} [options]
 * @returns {{ mapa: Map<string, { horaInici: string, horaFinal: string }>, filesRellevants: number, duplicats: string[] }}
 */
export function llegeixExcelHoraris(rutaFitxerOCopcions, options) {
  const { rutaFitxer, options: opts } = resolArgumentsExcelHoraris(rutaFitxerOCopcions, options);

  if (!existsSync(rutaFitxer)) {
    throw new Error(
      `No s'ha trobat el fitxer Excel d'horaris: ${rutaFitxer}. Col·loca horaris.xlsx a fixtures/excel/ o passa un camí explícit.`,
    );
  }

  const buf = readFileSync(rutaFitxer);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });

  const nomFull = opts.nomFull ?? workbook.SheetNames[opts.indexFull ?? 0];
  const sheet = workbook.Sheets[nomFull];
  if (!sheet) {
    throw new Error(`Excel horaris: no s'ha trobat el full "${nomFull}".`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const cols = { ...COLUMNES_HORARIS_DEFECTE, ...opts.columnes };
  const salt = Math.max(0, Number(opts.filesSaltadesInici) || 0);

  /** @type {Map<string, { horaInici: string, horaFinal: string }>} */
  const mapa = new Map();
  const duplicats = [];

  for (let i = salt; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const ds = Number(row[cols.diaSetmana]);
    if (!Number.isFinite(ds) || ds < 1 || ds > 5) continue;

    const nomBrut = textPerNomComerc(row[cols.nomComerc]);
    const nomN = normalitzaNomComerc(nomBrut);
    if (!nomN) continue;

    const hi = normalitzaHoraExcel(row[cols.horaInici]);
    const hf = normalitzaHoraExcel(row[cols.horaFi]);
    if (!hi || !hf) continue;

    const key = `${Math.floor(ds)}\u0001${nomN}`;
    if (mapa.has(key)) {
      duplicats.push(key);
    }
    mapa.set(key, { horaInici: hi, horaFinal: hf });
  }

  return {
    mapa,
    filesRellevants: Math.max(0, rows.length - salt),
    duplicats,
  };
}

/**
 * Assigna `horaInici` / `horaFinal` a cada entrega segons el dia de la setmana del pedido i el nom del comerç.
 *
 * @param {Array<{ nom?: string|null, pedidos?: Array<{ dia?: unknown, nom?: string|null }>, horaInici?: unknown, horaFinal?: unknown }>} entregues
 * @param {Map<string, { horaInici: string, horaFinal: string }>} mapaHoraris
 */
export function aplicaFrangesHorariesALesEntregues(entregues, mapaHoraris) {
  let aplicades = 0;
  let senseCoincidencia = 0;
  let capDeSetmana = 0;
  let senseNom = 0;

  for (const entrega of entregues) {
    const primer = Array.isArray(entrega.pedidos) ? entrega.pedidos[0] : null;
    const diaClau = primer?.dia ?? null;
    const ds = diaSetmanaLaborableDesDeClauDia(diaClau);
    const nomFont = entrega.nom ?? primer?.nom ?? null;
    const nomN = normalitzaNomComerc(nomFont);

    if (!nomN) {
      senseNom += 1;
      continue;
    }

    if (ds == null) {
      capDeSetmana += 1;
      continue;
    }

    const key = `${ds}\u0001${nomN}`;
    const franja = mapaHoraris.get(key);
    if (!franja) {
      senseCoincidencia += 1;
      continue;
    }

    entrega.horaInici = franja.horaInici;
    entrega.horaFinal = franja.horaFinal;
    aplicades += 1;
  }

  return {
    aplicades,
    senseCoincidencia,
    capDeSetmana,
    senseNom,
    total: entregues.length,
  };
}
