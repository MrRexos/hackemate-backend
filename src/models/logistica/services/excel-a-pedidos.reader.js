import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { Pedido } from '../classes/pedido.model.js';

/**
 * Camí absolut per defecte: `fixtures/excel/comandes.xlsx` a l’arrel del backend
 * (`hackemate-backend/fixtures/excel/comandes.xlsx`).
 */
export const RUTA_EXCEL_COMANDES_DEFECTE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/excel/comandes.xlsx',
);

/**
 * Índex 0-based de columnes Excel (A=1 …): dia, producte, quantitat, tipus, nom;
 * adreca14–16: **carrer**, **codi postal**, **municipi** (es llegeixen per separat i es concatena per `adreca`).
 * @see {@link COLUMNES_EXCEL_DEFECTE}
 */
export const COLUMNES_EXCEL_DEFECTE = {
  dia: 0,
  producte: 7,
  quantitat: 8,
  tipusCarrega: 9,
  nom: 11,
  adreca14: 13,
  adreca15: 14,
  adreca16: 15,
};

/**
 * @typedef {object} OpcionsLlegeixExcelPedidos
 * @property {string} [nomFull] — Nom del full (per defecte el primer full del llibre).
 * @property {number} [indexFull] — Índex del full si no es passa `nomFull`.
 * @property {number} [filesSaltadesInici=0] — Files a ignorar des del principi (p. ex. 1 per una capçalera).
 * @property {number} [volumPerDefecte=0] — Volum per unitat si l’Excel no porta columna de volum.
 * @property {Partial<typeof COLUMNES_EXCEL_DEFECTE>} [columnes] — Sobreescriu índex de columnes (0-based).
 */

/**
 * Normalitza el valor de «dia» (text, número serial Excel o Date).
 */
export function normalitzaValorDia(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(val) * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let y = parseInt(slash[3], 10);
    if (y < 100) y += 2000;
    const month = parseInt(slash[2], 10) - 1;
    const day = parseInt(slash[1], 10);
    const dt = new Date(Date.UTC(y, month, day));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return s;
}

function textCel·la(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

/** Text brut de cel·la (només trim); adequat per carrer / municipi sense tractar dates. */
function textPlana(val) {
  if (val == null || val === '') return '';
  return String(val).trim();
}

/** CP espanyol (5 xifres); si Excel guarda el número sense zeros a l’esquerra, es reomplen. */
export function normalitzaCodiPostalEspanya(val) {
  if (val == null || val === '') return null;
  const t = String(val).trim();
  const m = t.match(/\b(\d{5})\b/);
  if (m) return m[1];
  if (typeof val === 'number' && Number.isFinite(val)) {
    const s = String(Math.round(Math.abs(val)));
    if (/^\d{3,5}$/.test(s)) return s.padStart(5, '0').slice(-5);
  }
  if (/^\d{4,5}$/.test(t)) return t.padStart(5, '0').slice(-5);
  return null;
}

function numeroCel·la(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function concatenaAdreca(row, col14, col15, col16) {
  const parts = [row[col14], row[col15], row[col16]]
    .map((x) => textPlana(x))
    .filter(Boolean);
  const s = parts.join(', ').replace(/\s+/g, ' ').trim();
  return s || null;
}

function filaBuida(row, cols) {
  const prod = textCel·la(row[cols.producte]);
  const qt = numeroCel·la(row[cols.quantitat]);
  return !prod && qt === 0;
}

/**
 * Resol crida `llegeixExcelAPedidos()` sense camí, només opcions, o camí + opcions.
 * @returns {{ rutaFitxer: string, options: OpcionsLlegeixExcelPedidos }}
 */
function resolArgumentsExcelPedidos(arg1, arg2) {
  if (typeof arg1 === 'string') {
    return { rutaFitxer: arg1, options: arg2 ?? {} };
  }
  if (arg1 !== undefined && typeof arg1 === 'object' && !Array.isArray(arg1) && arg2 === undefined) {
    return { rutaFitxer: RUTA_EXCEL_COMANDES_DEFECTE, options: arg1 };
  }
  if ((arg1 === undefined || arg1 === null) && arg2 !== undefined && typeof arg2 === 'object' && !Array.isArray(arg2)) {
    return { rutaFitxer: RUTA_EXCEL_COMANDES_DEFECTE, options: arg2 };
  }
  return { rutaFitxer: RUTA_EXCEL_COMANDES_DEFECTE, options: {} };
}

/**
 * Llegeix un Excel (.xlsx / .xls) i construeix un array de {@link Pedido}.
 *
 * Per defecte llegeix {@link RUTA_EXCEL_COMANDES_DEFECTE} (`fixtures/excel/comandes.xlsx`).
 *
 * Layout esperat per defecte (columnes 1-based Excel):
 * - 1: dia · 8: producte · 9: quantitat · 10: tipus càrrega (`CAJ`, `BRL`, `UN`; altres → 12 unitats/caixa) · 12: nom · 14–16: adreça (tres cel·les).
 *
 * @param {string | OpcionsLlegeixExcelPedidos} [rutaFitxerOCopcions] Camí al fitxer, o només opcions (objecte).
 * @param {OpcionsLlegeixExcelPedidos} [options] Opcions si el primer argument és el camí.
 * @returns {Pedido[]}
 */
export function llegeixExcelAPedidos(rutaFitxerOCopcions, options) {
  const { rutaFitxer, options: opts } = resolArgumentsExcelPedidos(rutaFitxerOCopcions, options);

  if (!existsSync(rutaFitxer)) {
    throw new Error(
      `No s'ha trobat el fitxer Excel: ${rutaFitxer}. Col·loca el xlsx a fixtures/excel/comandes.xlsx o passa un camí explícit.`,
    );
  }

  const buf = readFileSync(rutaFitxer);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });

  const nomFull = opts.nomFull ?? workbook.SheetNames[opts.indexFull ?? 0];
  const sheet = workbook.Sheets[nomFull];
  if (!sheet) {
    throw new Error(`Excel: no s'ha trobat el full "${nomFull}". Fulls disponibles: ${workbook.SheetNames.join(', ')}`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const cols = { ...COLUMNES_EXCEL_DEFECTE, ...opts.columnes };
  const salt = Math.max(0, Number(opts.filesSaltadesInici) || 0);
  const volumPerDefecte =
    opts.volumPerDefecte != null && Number.isFinite(Number(opts.volumPerDefecte))
      ? Number(opts.volumPerDefecte)
      : 0;

  /** @type {Pedido[]} */
  const pedidos = [];

  for (let i = salt; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (filaBuida(row, cols)) continue;

    const dia = normalitzaValorDia(row[cols.dia]);
    const producte = textCel·la(row[cols.producte]);
    const quantitat = numeroCel·la(row[cols.quantitat]);
    const tipusCarrega = textCel·la(row[cols.tipusCarrega]) || null;
    const nom = textCel·la(row[cols.nom]) || null;
    const carrer = textPlana(row[cols.adreca14]) || null;
    const codiPostal = normalitzaCodiPostalEspanya(row[cols.adreca15]);
    const municipi = textPlana(row[cols.adreca16]) || null;
    const adreca = concatenaAdreca(row, cols.adreca14, cols.adreca15, cols.adreca16);

    pedidos.push(
      new Pedido({
        dia,
        nom,
        producte,
        volum: volumPerDefecte,
        quantitat,
        tipusCarrega,
        adreca,
        carrer,
        codiPostal,
        municipi,
      }),
    );
  }

  return pedidos;
}
