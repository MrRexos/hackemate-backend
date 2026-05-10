/**
 * Genera `fixtures/excel/comandes-prova.xlsx` amb el format per defecte d’excelToEntregas:
 * ID entrega, nom entrega, direcció, nom pedido, tipus càrrega, quantitat, hora inici entrega, hora inici pedido.
 *
 * Ús: node src/scripts/genera-fixture-excel-prova.js
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const CAPCALERA = [
  'ID Entrega',
  'Nom Entrega',
  'Dirección',
  'Nom Pedido',
  'Tipus carrega',
  'Quantitat',
  'Hora Inici Entrega',
  'Hora Inici Pedido',
];

const FILES = [
  [
    'ENT-BAR-01',
    'Bar Balmes',
    'Carrer de Balmes 90, Barcelona',
    'Begudes',
    'caixa',
    12,
    '09:00',
    '09:15',
  ],
  [
    'ENT-BAR-01',
    'Bar Balmes',
    'Carrer de Balmes 90, Barcelona',
    'Menjar sec',
    'caixa',
    8,
    '09:00',
    '10:00',
  ],
  [
    'ENT-BAR-02',
    'Cafè Diagonal',
    'Avinguda Diagonal 420, Barcelona',
    'Càpsules',
    'caixa',
    20,
    '15:30',
    '15:45',
  ],
];

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..', '..');
  const dir = path.join(root, 'fixtures', 'excel');
  await mkdir(dir, { recursive: true });

  const outPath = path.join(dir, 'comandes-prova.xlsx');

  const sheet = XLSX.utils.aoa_to_sheet([CAPCALERA, ...FILES]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Comandes');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await writeFile(outPath, buf);

  console.log(`Fixture generat: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
