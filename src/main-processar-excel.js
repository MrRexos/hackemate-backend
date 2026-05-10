/**
 * Exemple d’integració: `processarExcel` (exceljs) → `generarRutes`.
 *
 * Ús:
 *   node src/main-processar-excel.js ./comandes.xlsx --mock-geocode
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { geocodificarMockDeterminista } from './main-rutes-excel.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from './models/logistica/config/flota-exemple-15.js';
import { processarExcel } from './models/logistica/services/processar-excel-rutes.service.js';
import { MOLLET_MAGATZEM_AFORES } from './scripts/utils/punts-sobre-carrer.js';

function parseArgs(argv) {
  const out = { positional: [], mockGeo: false, magatzem: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mock-geocode') out.mockGeo = true;
    else if (a === '--magatzem' && argv[i + 1]) {
      const parts = String(argv[i + 1]).split(',').map((x) => Number(String(x).trim()));
      i += 1;
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        out.magatzem = { x: parts[0], y: parts[1] };
      }
    } else if (!a.startsWith('-')) out.positional.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const excelPath = args.positional[0];

  if (!excelPath) {
    console.error('Ús: node src/main-processar-excel.js <fitxer.xlsx> [--mock-geocode] [--magatzem lon,lat]');
    process.exitCode = 1;
    return;
  }

  const resolved = path.isAbsolute(excelPath) ? excelPath : path.resolve(process.cwd(), excelPath);
  const magatzem = args.magatzem ?? MOLLET_MAGATZEM_AFORES;
  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  try {
    const { entregues, resultat } = await processarExcel(resolved, {
      flota,
      magatzem,
      obtenirCoordenades: args.mockGeo
        ? (adreca) => geocodificarMockDeterminista(adreca)
        : undefined,
      pausaEntreGeocodificacionsMs: args.mockGeo ? 0 : 1100,
      fetchImpl: fetch,
      generarRutesOptions: {
        usaMock: true,
        fetchImpl: fetch,
      },
    });

    console.log(`Entregues: ${entregues.length} · Rutes amb parades: ${resultat.rutes.length}`);
  } catch (err) {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  }
}

const __filename = fileURLToPath(import.meta.url);
const execDesDelCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (execDesDelCli) {
  main();
}
