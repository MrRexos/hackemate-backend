/**
 * CLI i pipeline: Excel → instàncies Entrega (amb Pedidos) → {@link generarRutes}.
 * No modifica l’algoritme del sweep; només enllaça les funcions existents.
 *
 * Ús:
 *   node src/main-rutes-excel.js ./comandes.xlsx
 *   node src/main-rutes-excel.js ./comandes.xlsx --magatzem 2.1718,41.5278 --mock-geocode
 *   node src/main-rutes-excel.js ./antic.xlsx --format motor   # Excel antic (VolumUnitari + union-find)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { volumCarregaMaximaOperativa } from './models/logistica/constants/capacitat-camio.constants.js';
import { Entrega } from './models/logistica/classes/entrega.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from './models/logistica/config/flota-exemple-15.js';
import { excelToEntregas } from './models/logistica/services/excel-to-entregas.converter.js';
import { generarRutes } from './models/logistica/services/sweep-optimizer.service.js';
import { MOLLET_MAGATZEM_AFORES } from './scripts/utils/punts-sobre-carrer.js';

/** Geocodificació determinista offline (mateixa idea que mocks dels scripts de prova). */
export async function geocodificarMockDeterminista(adreca) {
  let hash = 0;
  const s = String(adreca || '');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const lon = 2.1 + ((Math.abs(hash) % 1000) / 1000) * 0.15;
  const lat = 41.35 + ((Math.abs(hash >> 8) % 1000) / 1000) * 0.12;
  return { x: lon, y: lat };
}

/**
 * @typedef {object} ExecutarRutesExcelOptions
 * @property {{ x: number, y: number }} [magatzem] - Lon/lat magatzem (defecte: Mollet afores).
 * @property {import('./models/logistica/classes/camio.model.js').Camio[]} [flota] - Llista per `generarRutes`.
 * @property {object} [excelToEntregasOptions] - Pass-through a `excelToEntregas` (geocodificar, fetchImpl, pausa…).
 * @property {object} [generarRutesOptions] - Opcions addicionals per `generarRutes` (fusionades amb les per defecte del CLI).
 */

/**
 * Llegeix l’Excel per defecte amb **files de pedido agrupades per ID d’entrega** (columnes tipus
 * ID entrega, nom entrega, direcció, nom pedido, tipus càrrega, quantitat, hora inici entrega, hora inici pedido).
 * Opció `excelToEntregasOptions.format === 'motor'` per l’Excel antic (VolumUnitari, union-find…).
 *
 * @param {string} excelPath - Camí al `.xlsx` (absolut o relatiu al `cwd`).
 * @param {ExecutarRutesExcelOptions} [options]
 * @returns {Promise<{ entregues: Entrega[], resultat: Awaited<ReturnType<typeof generarRutes>> }>}
 */
export async function executarRutesDesDeExcel(excelPath, options = {}) {
  const magatzem = options.magatzem ?? MOLLET_MAGATZEM_AFORES;
  const flota = options.flota ?? FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  const resolved = path.isAbsolute(excelPath) ? excelPath : path.resolve(process.cwd(), excelPath);

  const entregues = await excelToEntregas(resolved, options.excelToEntregasOptions ?? {});

  const defecteGenerarRutes = {
    EntregaClass: Entrega,
    usaMock: true,
    fetchImpl: fetch,
    assignacioCompleta: true,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
  };

  const resultat = await generarRutes(entregues, flota, magatzem, {
    ...defecteGenerarRutes,
    ...(options.generarRutesOptions ?? {}),
  });

  return { entregues, resultat };
}

function parseArgs(argv) {
  const args = {
    positional: [],
    mockGeo: false,
    magatzem: null,
    formatMotor: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mock-geocode') {
      args.mockGeo = true;
    } else if (a === '--format' && argv[i + 1] === 'motor') {
      args.formatMotor = true;
      i += 1;
    } else if (a === '--magatzem') {
      const raw = argv[i + 1];
      if (raw == null) continue;
      i += 1;
      const parts = String(raw).split(',').map((x) => Number(String(x).trim()));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        args.magatzem = { x: parts[0], y: parts[1] };
      }
    } else if (!a.startsWith('-')) {
      args.positional.push(a);
    }
  }

  return args;
}

function retalla(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Sortida llegible: ordre de visita, camió, hores magatzem i ETA per parada.
 * @param {{ rutes: object[], entreguesNoAssignades: object[] }} resultat
 */
export function pintaRutesDetallades(resultat) {
  console.log('\n========== RUTES (ordre de visita) ==========\n');

  if (!resultat.rutes.length) {
    console.log('  (cap ruta amb parades)\n');
    return;
  }

  resultat.rutes.forEach((ruta, idxRuta) => {
    const n = idxRuta + 1;
    const idCamio = ruta.camio?.id ?? '?';
    const virt = ruta.__camioVirtual ? ' [camió virtual]' : '';
    const capNom = Number(ruta.camio?.capacitatMaxima || 0);
    const capOp = volumCarregaMaximaOperativa(ruta.camio);
    const vol = Number(ruta.volumOcupat || 0);
    const pctNom = capNom > 0 ? ((vol / capNom) * 100).toFixed(1) : '—';
    const pctOp = capOp > 0 ? ((vol / capOp) * 100).toFixed(1) : '—';

    console.log(`─── Ruta ${n} · Camió ${idCamio}${virt} ───`);
    console.log(
      `    Càrrega: ${vol} / ${capOp.toFixed(0)} màx. útil (${pctOp}% ple del límit 97%) · capacitat nominal camió ${capNom} (${pctNom}% respecte nominal)`,
    );
    console.log(
      `    Sortida magatzem (aprox.) ≈ ${ruta.horaSortidaMagatzemAproximada ?? ruta.horaSortidaMagatzem ?? '—'} · Arribada magatzem (aprox.) ≈ ${ruta.horaArribadaMagatzemAproximada ?? ruta.horaTornadaMagatzem ?? '—'}`,
    );
    const nParades = ruta.entregues?.length ?? 0;
    if (nParades === 0) {
      console.log('    (sense parades)\n');
      return;
    }

    console.log(`    Parades (${nParades}):`);
    ruta.entregues.forEach((e, i) => {
      const ordre = String(i + 1).padStart(2, ' ');
      const id = e.identificador ?? '?';
      const nom = e.nom ? ` «${retalla(e.nom, 26)}»` : '';
      const arrib = e.horaDEntrega ?? e.arribadaHora ?? '—';
      const finestra =
        e.horaInici || e.horaFinal ? `${e.horaInici ?? '—'}–${e.horaFinal ?? '—'}` : 'sense finestra';
      const coords =
        e.coordenades?.x != null && e.coordenades?.y != null
          ? `${Number(e.coordenades.x).toFixed(4)}, ${Number(e.coordenades.y).toFixed(4)}`
          : '—';
      console.log(
        `      ${ordre}. ${id}${nom}  |  arribada ~${arrib}  |  client ${finestra}  |  volum ${e.volumTotal ?? '—'}`,
      );
      console.log(`          ${retalla(e.adreca, 78)}`);
      console.log(`          coords: ${coords}`);
      const peds = Array.isArray(e.pedidos) ? e.pedidos : [];
      if (peds.length > 0) {
        const linies = peds
          .map((p) => {
            const nm = p?.nom ?? '?';
            const q = p?.quantitatCaixes ?? p?.quantitat ?? '';
            const tip = p?.tipusCarrega ? ` [${p.tipusCarrega}]` : '';
            return `${nm} ×${q}${tip}`;
          })
          .join(' · ');
        console.log(`          pedidos: ${retalla(linies, 76)}`);
      }
    });
    console.log('');
  });

  console.log('==========================================\n');
}

function pintaResum({ entregues, resultat }) {
  console.log('\n--- Entregues (després de l’Excel) ---');
  console.log(`Total entregues: ${entregues.length}`);
  entregues.forEach((e, idx) => {
    const nPed = e.pedidos?.length ?? 0;
    const ad = e.adreca ? `${String(e.adreca).slice(0, 56)}${String(e.adreca).length > 56 ? '…' : ''}` : '';
    const nomEtiqueta = e.nom ? ` «${String(e.nom).slice(0, 28)}${String(e.nom).length > 28 ? '…' : ''}»` : '';
    console.log(
      `  ${String(idx + 1).padStart(2, ' ')}. ${e.identificador ?? '?'}${nomEtiqueta} | ${nPed} producte(s) | volum=${e.volumTotal} | ${ad}`,
    );
  });

  console.log('\n--- Resultat rutes ---');
  console.log(`Rutes amb parades: ${resultat.rutes.length}`);
  console.log(`No assignades: ${resultat.entreguesNoAssignades.length}`);

  const sumCapOp = resultat.rutes.reduce((acc, r) => acc + volumCarregaMaximaOperativa(r.camio), 0);
  const sumVol = resultat.rutes.reduce((acc, r) => acc + Number(r.volumOcupat || 0), 0);
  const pctGOp = sumCapOp > 0 ? ((sumVol / sumCapOp) * 100).toFixed(1) : '0.0';
  console.log(
    `Ocupació vs límit útil (97%): ${sumVol}/${sumCapOp.toFixed(0)} (${pctGOp}% del total útil de les rutes)`,
  );

  resultat.rutes.forEach((ruta, i) => {
    const capNom = Number(ruta.camio.capacitatMaxima || 0);
    const capOp = volumCarregaMaximaOperativa(ruta.camio);
    const vol = Number(ruta.volumOcupat || 0);
    const pctOp = capOp > 0 ? ((vol / capOp) * 100).toFixed(1) : '—';
    const virt = ruta.__camioVirtual ? ' [virtual]' : '';
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}. ${ruta.camio.id}${virt} → ${vol}/${capOp.toFixed(0)} útil (${pctOp}% del 97%) · nominal ${capNom} · ${ruta.entregues.length} parades`,
    );
  });

  pintaRutesDetallades(resultat);

  if (resultat.entreguesNoAssignades.length > 0) {
    console.log('\nMotius (no assignades):');
    resultat.entreguesNoAssignades.forEach((e) => {
      console.log(`  - ${e.identificador ?? '?'} | ${e.motiuNoAssignacio?.codi ?? ''}`);
    });
  }
}

async function main() {
  const { positional, mockGeo, magatzem, formatMotor } = parseArgs(process.argv);
  const excelPath = positional[0];

  if (!excelPath) {
    console.error(
      'Ús: node src/main-rutes-excel.js <fitxer.xlsx> [--magatzem lon,lat] [--mock-geocode] [--format motor]\n'
      + 'Exemple: node src/main-rutes-excel.js ./comandes.xlsx --magatzem 2.17,41.39 --mock-geocode',
    );
    process.exitCode = 1;
    return;
  }

  const excelToEntregasOptions = mockGeo
    ? {
        geocodificar: geocodificarMockDeterminista,
        pausaEntreGeocodificacionsMs: 0,
      }
    : {
        fetchImpl: fetch,
        pausaEntreGeocodificacionsMs: 1100,
      };

  console.log(`Fitxer: ${path.resolve(process.cwd(), excelPath)}`);
  console.log(mockGeo ? 'Geocodificació: mock (sense xarxa)\n' : 'Geocodificació: Nominatim (requereix xarxa)\n');

  try {
    const pipeline = await executarRutesDesDeExcel(excelPath, {
      magatzem: magatzem ?? undefined,
      excelToEntregasOptions: {
        ...excelToEntregasOptions,
        ...(formatMotor ? { format: 'motor' } : {}),
      },
    });
    pintaResum(pipeline);
  } catch (err) {
    console.error(err?.message || err);
    process.exitCode = 1;
  }
}

const __filename = fileURLToPath(import.meta.url);
const execDesDelCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (execDesDelCli) {
  main();
}
