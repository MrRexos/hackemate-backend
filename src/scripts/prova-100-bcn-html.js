/**
 * 100 entregues aleatòries (BCN, sobre vial) → `generarRutes` (sweep) → HTML amb mapa OSRM + taules.
 *
 * Ús:
 *   npm run prova:100-bcn-html
 *
 * Sortida: `output/prova-100-bcn.html` (relativa a l’arrel del backend).
 *
 * La geometria del mapa es calcula **tram per tram** (magatzem→parada→…→magatzem) per no sobrepassar
 * el límit d’URL d’OSRM ni obtenir polilínies truncades (que podien dibuixar rutes absurdes, p. ex. cap a Itàlia).
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { Pedido } from '../models/logistica/classes/pedido.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import { BCN_BBOX_CARRER, generaPuntsSobreCarrer } from './utils/punts-sobre-carrer.js';
import {
  calculaGeometriesRutes,
  construeixPayloadVisual,
  escriuHtmlVistaRutes,
} from './utils/rutes-html-visual.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arrelBackend = path.join(__dirname, '..', '..');

const N_ENTREGUES = 350;

/** Centre aproximat del bbox urbà BCN (lon, lat). */
const MAGATZEM_BCN = { x: 2.1585, y: 41.3865 };

async function generaCentEntreguesAleatoriesBarcelona() {
  const punts = await generaPuntsSobreCarrer(N_ENTREGUES, {
    bbox: BCN_BBOX_CARRER,
    fetchImpl: fetch,
  });

  return punts.map((p, i) => {
    const mod = i % 3;
    const franges =
      mod === 0
        ? { ini: '09:00', fi: '13:30' }
        : mod === 1
          ? { ini: '14:00', fi: '19:00' }
          : { ini: '08:30', fi: '19:30' };
    const volum = 6 + (i % 5);
    const quantitat = 1 + (i % 4);

    return new Entrega({
      identificador: `BCN-${String(i + 1).padStart(3, '0')}`,
      adreca: `Barcelona (aleatori) · punt ${i + 1}`,
      coordenades: { x: p.x, y: p.y },
      horaInici: franges.ini,
      horaFinal: franges.fi,
      pedidos: [
        new Pedido({
          nom: `Article ${i + 1}`,
          tipusCarrega: 'CAJ',
          volum,
          quantitat,
        }),
      ],
    });
  });
}

async function main() {
  console.log(`Generant ${N_ENTREGUES} punts sobre carrer dins BCN_BBOX_CARRER…`);
  const entregues = await generaCentEntreguesAleatoriesBarcelona();
  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  console.log('Executant generarRutes (sweep)…');
  const resultat = await generarRutes(entregues, flota, MAGATZEM_BCN, {
    EntregaClass: Entrega,
    usaMock: true,
    assignacioCompleta: true,
    optimIntraRutaCarrers: true,
  });

  console.log('Calculant geometria OSRM per al mapa…');
  const visualData = await calculaGeometriesRutes(resultat.rutes, MAGATZEM_BCN);
  const payload = construeixPayloadVisual(resultat, visualData, MAGATZEM_BCN, {
    titol: `${N_ENTREGUES} entregues aleatòries Barcelona`,
    entreguesTotals: entregues.length,
  });
  const dirSortida = path.join(arrelBackend, 'output');
  await mkdir(dirSortida, { recursive: true });
  const outputPath = await escriuHtmlVistaRutes(payload, path.join(dirSortida, 'prova-100-bcn.html'));

  const assignades = entregues.length - resultat.entreguesNoAssignades.length;
  console.log(`Assignades: ${assignades} / ${entregues.length}`);
  console.log(`Rutes: ${resultat.rutes.length} · No assignades: ${resultat.entreguesNoAssignades.length}`);
  console.log(`HTML: ${outputPath}`);
}

const execDesDelCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (execDesDelCli) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { main, generaCentEntreguesAleatoriesBarcelona };
