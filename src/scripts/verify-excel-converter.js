/**
 * Comprova agrupació per ID d’entrega i coherència de coordenades (mock dins bbox inland).
 *
 * Ús:
 *   node src/scripts/verify-excel-converter.js
 *   node src/scripts/verify-excel-converter.js path/al/arxiu.xlsx
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { excelToEntregas } from '../models/logistica/services/excel-to-entregas.converter.js';
import { geocodificarMockDeterminista, MOCK_GEOCODIFICACIO_BBOX } from '../main-rutes-excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function esTextCapcaleraIdEntrega(valor) {
  const s = String(valor ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!s) return true;
  const prohibits = new Set([
    'id entrega',
    'id_entrega',
    'identificador',
    'id pedido',
    'id_pedido',
    'pedido',
    'entrega',
  ]);
  return prohibits.has(s) || s === 'id' || s.startsWith('columna');
}

function esCapcaleraFila(row) {
  if (!Array.isArray(row) || !row.length) return false;
  const c0 = String(row[0] ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (c0 === 'id_entrega' || c0 === 'identificador') return true;
  if (c0.includes('id') && c0.includes('entrega')) return true;
  if (c0.includes('id') && c0.includes('pedido')) return true;
  return false;
}

function comptaFilesDades(excelPath) {
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const primera = workbook.SheetNames[0];
  if (!primera) return { files: 0, ambCapcalera: false };
  const ws = workbook.Sheets[primera];
  const matriu = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!Array.isArray(matriu) || matriu.length === 0) return { files: 0, ambCapcalera: false };

  const capcalera = esCapcaleraFila(matriu[0]);
  let n = 0;
  const inici = capcalera ? 1 : 0;
  for (let i = inici; i < matriu.length; i += 1) {
    const fila = matriu[i];
    if (!Array.isArray(fila) || fila.length < 3) continue;
    const id = String(fila[0] ?? '').trim();
    const dir = String(fila[2] ?? '').trim();
    if (id && dir && !esTextCapcaleraIdEntrega(id)) n += 1;
  }
  return { files: n, ambCapcalera: capcalera };
}

function puntDinsBbox(p, bbox) {
  return (
    p.x >= bbox.minLon - 1e-9
    && p.x <= bbox.maxLon + 1e-9
    && p.y >= bbox.minLat - 1e-9
    && p.y <= bbox.maxLat + 1e-9
  );
}

async function main() {
  const excelArg = process.argv[2];
  const excelPath = excelArg
    ? path.resolve(process.cwd(), excelArg)
    : path.join(BACKEND_ROOT, 'fixtures', 'excel', 'comandes-prova.xlsx');

  console.log(`Fitxer: ${excelPath}\n`);

  const { files: filesExcel } = comptaFilesDades(excelPath);
  if (filesExcel === 0) {
    console.error('No s’han trobat files vàlides (ID + direcció).');
    process.exitCode = 1;
    return;
  }

  const entregues = await excelToEntregas(excelPath, {
    geocodificar: geocodificarMockDeterminista,
    pausaEntreGeocodificacionsMs: 0,
  });

  const sumPedidos = entregues.reduce((acc, e) => acc + (e.pedidos?.length ?? 0), 0);

  console.log('--- Agrupació ---');
  console.log(`Files amb pedido al Excel (aprox.): ${filesExcel}`);
  console.log(`Entregues després d’agrupar:       ${entregues.length}`);
  console.log(`Suma de pedidos (totes les entregues): ${sumPedidos}`);

  if (sumPedidos !== filesExcel) {
    console.error(
      `\nFAIL: el nombre de pedidos (${sumPedidos}) no coincideix amb el nombre de files (${filesExcel}). Revisa IDs duplicats o files sense ID/direcció.`,
    );
    process.exitCode = 1;
  } else {
    console.log('OK: cada fila de pedido compta i els mateix ID queden agrupats en una entrega.');
  }

  console.log('\n--- Coordenades (mock) ---');
  let fora = 0;
  for (const e of entregues) {
    const p = e.coordenades;
    if (!p || p.x == null || p.y == null) {
      console.error(`FAIL: entrega sense coordenades: ${e.identificador}`);
      fora += 1;
      continue;
    }
    if (!puntDinsBbox(p, MOCK_GEOCODIFICACIO_BBOX)) {
      console.warn(
        `Fora del bbox inland mock: ${e.identificador} → ${p.x.toFixed(5)}, ${p.y.toFixed(5)} (GPS explícit al Excel?)`,
      );
      fora += 1;
    }
  }
  if (fora === 0) {
    console.log(
      `Totes les coordenades mock estan dins el rectangle inland (${MOCK_GEOCODIFICACIO_BBOX.minLon}–${MOCK_GEOCODIFICACIO_BBOX.maxLon}, ${MOCK_GEOCODIFICACIO_BBOX.minLat}–${MOCK_GEOCODIFICACIO_BBOX.maxLat}).`,
    );
  }

  console.log('\n--- Detall per entrega (primeres 8) ---');
  entregues.slice(0, 8).forEach((e, i) => {
    const n = e.pedidos?.length ?? 0;
    const c = e.coordenades;
    const coordsTxt = c ? `${Number(c.x).toFixed(5)}, ${Number(c.y).toFixed(5)}` : '—';
    console.log(`  ${i + 1}. ${e.identificador}  ·  ${n} pedido(s)  ·  ${coordsTxt}`);
  });
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
