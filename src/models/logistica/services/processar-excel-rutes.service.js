/**
 * Interfície Excel (exceljs) → {@link Entrega} + {@link Pedido} → {@link generarRutes}.
 *
 * Capçaleres esperades (flexibles; es normalitzen sense accents):
 * ID, Adreça, Producte, Volum, Quantitat, HoraInici, HoraFinal.
 */

import ExcelJS from 'exceljs';

import { Entrega } from '../classes/entrega.model.js';
import { Pedido } from '../classes/pedido.model.js';
import { generarRutes } from './sweep-optimizer.service.js';

/** Variants acceptades per columna → clau interna */
const ALIASES_PER_CAMP = {
  id: ['id', 'identificador', 'idpedido', 'id_pedido', 'id_entrega', 'codigo'],
  adreca: ['adreca', 'adreça', 'direccion', 'dirección', 'address', 'ubicacion', 'ubicació'],
  producte: ['producte', 'product', 'nom', 'nombre', 'nombre_carga', 'nom_carrega', 'producto'],
  volum: ['volum', 'volumen', 'volum_unitat', 'volumen_unidad', 'volumen_caja'],
  quantitat: ['quantitat', 'cantidad', 'qty', 'quantity'],
  horaInici: ['horainici', 'hora_inici', 'hora_inicio', 'inicio', 'h_inicio'],
  horaFinal: ['horafinal', 'hora_final', 'hora_fin', 'fin', 'h_fin'],
};

const CAMPS_REQUERITS = ['id', 'adreca', 'producte', 'volum', 'quantitat', 'horaInici', 'horaFinal'];

export function normalitzaClauCapcalera(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');
}

function construeixMapaAliasACamp() {
  const map = new Map();
  for (const [camp, variants] of Object.entries(ALIASES_PER_CAMP)) {
    for (const v of variants) {
      map.set(normalitzaClauCapcalera(v), camp);
    }
  }
  return map;
}

const ALIAS_A_CAMP = construeixMapaAliasACamp();

function text(valor) {
  if (valor == null || valor === '') return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor === 'object' && valor !== null && 'richText' in valor) {
    return valor.richText.map((t) => t.text).join('').trim();
  }
  return String(valor).trim();
}

function numero(valor) {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function valorCellaExcelJS(cell) {
  if (!cell || cell.value == null || cell.value === '') return null;
  if (cell.type === ExcelJS.ValueType.Formula) {
    return cell.result ?? null;
  }
  return cell.value;
}

/**
 * Converteix valor de cel·la (Excel serial 0–1, Date, string) a "HH:mm".
 */
export function valorAHoraHhMm(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'string') {
    const t = val.trim();
    return t || null;
  }
  if (val instanceof Date) {
    const h = val.getHours();
    const m = val.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return text(val) || null;
}

function normalitzaAdreca(valor) {
  return text(valor).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resol adreça amb Nominatim (lon = x, lat = y), mateixa convenció que el sweep.
 *
 * @param {string} adreca
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ x: number, y: number }>}
 */
export async function obtenirCoordenades(adreca, fetchImpl = fetch) {
  const q = text(adreca);
  if (!q) {
    throw new Error("obtenirCoordenades: adreça buida.");
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', q);

  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'HackeMate/1.0 (processar-excel-rutes)' },
  });

  if (!response.ok) {
    throw new Error(`Error geocodificant l'adreca (${response.status}).`);
  }

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`No s'han trobat coordenades per a: ${q}`);
  }

  return {
    x: Number(resultats[0].lon),
    y: Number(resultats[0].lat),
  };
}

function parsejaCapcaleres(worksheet) {
  const headerRow = worksheet.getRow(1);
  const maxCol = worksheet.actualColumnCount || worksheet.columnCount || 50;

  /** @type {Record<string, number>} */
  const campAColumna = {};

  for (let col = 1; col <= maxCol; col += 1) {
    const cell = headerRow.getCell(col);
    const brut = valorCellaExcelJS(cell);
    const etiqueta = text(brut);
    if (!etiqueta) continue;

    const camp = ALIAS_A_CAMP.get(normalitzaClauCapcalera(etiqueta));
    if (!camp) continue;

    if (campAColumna[camp] != null) {
      throw new Error(
        `Capçalera duplicada o ambigüa: dues columnes resolen al mateix camp («${camp}»).`,
      );
    }
    campAColumna[camp] = col;
  }

  const falten = CAMPS_REQUERITS.filter((c) => campAColumna[c] == null);
  if (falten.length > 0) {
    throw new Error(
      `Falten columnes obligatòries a la primera fila: ${falten.join(', ')}. `
      + `Columnes trobades: ${Object.keys(campAColumna).join(', ') || '(cap)'}.`,
    );
  }

  return campAColumna;
}

function llegeixFilaComObjecte(worksheet, rowNumber, campAColumna) {
  const row = worksheet.getRow(rowNumber);
  /** @type {Record<string, unknown>} */
  const obj = {};

  for (const camp of CAMPS_REQUERITS) {
    const col = campAColumna[camp];
    const cell = row.getCell(col);
    obj[camp] = valorCellaExcelJS(cell);
  }

  return obj;
}

function filaBuida(obj) {
  const id = text(obj.id);
  const adreca = text(obj.adreca);
  const prod = text(obj.producte);
  return !id && !adreca && !prod && (obj.volum == null || obj.volum === '')
    && (obj.quantitat == null || obj.quantitat === '');
}

/**
 * Clau d'agrupació: si hi ha ID(s) no buit → una entrega per ID; si no, adreça normalitzada + finestra horària.
 */
function clauAgrupacio(fila) {
  const id = text(fila.id);
  const addr = normalitzaAdreca(fila.adreca);
  const hi = valorAHoraHhMm(fila.horaInici) ?? '';
  const hf = valorAHoraHhMm(fila.horaFinal) ?? '';

  if (id) {
    return { tipus: 'id', clau: `id:${id}`, id, addrNorm: addr };
  }
  return { tipus: 'addr', clau: `addr:${addr}|${hi}|${hf}`, id: '', addrNorm: addr };
}

/**
 * @typedef {object} ProcessarExcelOptions
 * @property {import('../classes/camio.model.js').Camio[]} flota - Vehicles per `generarRutes`.
 * @property {{ x: number, y: number }} magatzem - Lon/lat magatzem.
 * @property {(adreca: string) => Promise<{ x: number, y: number }>} [obtenirCoordenades] - Per defecte Nominatim.
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [pausaEntreGeocodificacionsMs] - Per defecte 1100 (política Nominatim).
 * @property {number} [sheetIndex] - Índex 0-based de la fulla (per defecte 0).
 * @property {object} [generarRutesOptions] - Opcions addicionals per `generarRutes`.
 */

/**
 * Llegeix un `.xlsx` amb exceljs, agrupa files per identificador o adreça+finestra,
 * construeix {@link Entrega} (amb {@link Pedido}), geocodifica i executa el motor de rutes.
 *
 * **Agrupació:** si la columna ID té valor, la clau és l’identificador (repetiu el mateix ID a
 * cada fila de la mateixa entrega). Si ID és buit, s’agrupa per adreça normalitzada + HoraInici + HoraFinal.
 *
 * @param {string} filePath - Camí al fitxer Excel.
 * @param {ProcessarExcelOptions} options
 * @returns {Promise<{ entregues: Entrega[], resultat: Awaited<ReturnType<typeof generarRutes>> }>}
 */
export async function processarExcel(filePath, options) {
  const {
    flota,
    magatzem,
    obtenirCoordenades: geoFn = obtenirCoordenades,
    fetchImpl = fetch,
    pausaEntreGeocodificacionsMs = 1100,
    sheetIndex = 0,
    generarRutesOptions = {},
  } = options ?? {};

  if (!flota) {
    throw new Error('processarExcel: cal `options.flota` (llista de camions per al motor).');
  }
  if (!magatzem || magatzem.x == null || magatzem.y == null) {
    throw new Error('processarExcel: cal `options.magatzem` amb { x, y } (lon/lat).');
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[sheetIndex];
    if (!worksheet) {
      throw new Error(`No existeix la fulla amb índex ${sheetIndex}.`);
    }

    const campAColumna = parsejaCapcaleres(worksheet);
    const rowCount = worksheet.rowCount;
    const grupMap = new Map();

    for (let r = 2; r <= rowCount; r += 1) {
      const raw = llegeixFilaComObjecte(worksheet, r, campAColumna);
      if (filaBuida(raw)) continue;

      const id = text(raw.id);
      const adreca = text(raw.adreca);
      if (!adreca) {
        throw new Error(`Fila ${r}: falta l'adreça (columna Adreça / ID buits invàlids sense adreça).`);
      }

      const volum = numero(raw.volum);
      const quantitat = numero(raw.quantitat);
      if (!Number.isFinite(volum) || !Number.isFinite(quantitat)) {
        throw new Error(`Fila ${r}: Volum i Quantitat han de ser numèrics vàlids.`);
      }

      const producte = text(raw.producte);
      if (!producte) {
        throw new Error(`Fila ${r}: falta el producte.`);
      }

      const horaInici = valorAHoraHhMm(raw.horaInici);
      const horaFinal = valorAHoraHhMm(raw.horaFinal);
      if (!horaInici || !horaFinal) {
        throw new Error(`Fila ${r}: HoraInici i HoraFinal són obligatòries (format HH:mm o cel·la hora Excel).`);
      }

      const pedido = new Pedido({ nom: producte, volum, quantitat });
      const meta = clauAgrupacio({
        id: raw.id,
        adreca: raw.adreca,
        horaInici: raw.horaInici,
        horaFinal: raw.horaFinal,
      });

      if (!grupMap.has(meta.clau)) {
        grupMap.set(meta.clau, {
          identificador: id || null,
          adreca,
          horaInici,
          horaFinal,
          pedidos: [],
          addrNorm: meta.addrNorm,
        });
      }

      const grup = grupMap.get(meta.clau);

      if (normalitzaAdreca(grup.adreca) !== normalitzaAdreca(adreca)) {
        throw new Error(
          `Fila ${r}: mateixa clau d'agrupació («${meta.clau}») però adreces diferents («${grup.adreca}» vs «${adreca}»).`,
        );
      }
      if (grup.horaInici !== horaInici || grup.horaFinal !== horaFinal) {
        throw new Error(`Fila ${r}: finestra horària inconsistent per a la mateixa entrega.`);
      }

      if (meta.tipus === 'id' && grup.identificador && id && grup.identificador !== id) {
        throw new Error(`Fila ${r}: conflicte d'identificador dins del mateix grup.`);
      }
      if (!grup.identificador && id) {
        grup.identificador = id;
      }

      grup.pedidos.push(pedido);
    }

    if (grupMap.size === 0) {
      throw new Error('El full no té files de dades vàlides (només capçalera o buides).');
    }

    /** @type {Entrega[]} */
    const entregues = [];

    for (const grup of grupMap.values()) {
      const identificador = grup.identificador ?? grup.addrNorm ?? '?';

      const coords = await geoFn(grup.adreca, fetchImpl);
      if (!coords || coords.x == null || coords.y == null) {
        throw new Error(`Geocodificació sense resultat vàlid per a: ${grup.adreca}`);
      }

      entregues.push(
        new Entrega({
          identificador,
          adreca: grup.adreca,
          horaInici: grup.horaInici,
          horaFinal: grup.horaFinal,
          pedidos: grup.pedidos,
          coordenades: coords,
        }),
      );

      if (pausaEntreGeocodificacionsMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pausaEntreGeocodificacionsMs));
      }
    }

    const defecteGenerarRutes = {
      EntregaClass: Entrega,
      usaMock: true,
      fetchImpl,
      assignacioCompleta: true,
      tempsBaseDescarregaMinuts: 10,
      tempsPerCaixaMinuts: 1,
    };

    const resultat = await generarRutes(entregues, flota, magatzem, {
      ...defecteGenerarRutes,
      ...generarRutesOptions,
    });

    return { entregues, resultat };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('Cannot find')
      || msg.includes('ENOENT')
      || msg.includes('EACCES')
      || msg.includes('invalid')
    ) {
      throw new Error(`No s'ha pogut llegir el fitxer Excel o el format no és vàlid: ${msg}`);
    }
    throw err;
  }
}
