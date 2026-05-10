/**
 * Llegeix entregues des de Supabase, executa l’algoritme de rutes i escriu un informe HTML + resum per consola.
 *
 * Script relacionat (sense BD — 100 entregues aleatòries Barcelona + mapa OSRM): vegeu
 * `src/scripts/prova-100-bcn-html.js` · `npm run prova:100-bcn-html`
 *
 * Ús:
 *   npm run planificacio:informe
 *
 * Opcions amb variables d’entorn (opcional):
 *   PLANIFICACIO_OSRM=false     → desactiva optimització OSRM (més ràpid offline)
 *   PLANIFICACIO_ASSIGNACIO_COMPLETA=true  → intenta assignar-ho tot (més agressiu)
 *
 * Informe: carpeta `output/planificacio-informe-<timestamp>.html` (es mostra la ruta al final).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../config/env.js';
import { generaHtmlInformePlanificacio } from '../services/informe-planificacio-html.js';
import { planificarRutesDesDeBaseDades } from '../services/planificacio-bd.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arrelBackend = path.join(__dirname, '..', '..');
const dirSortida = path.join(arrelBackend, 'output');

async function main() {
  const senseOsrm = process.env.PLANIFICACIO_OSRM === 'false' || process.env.PLANIFICACIO_OSRM === '0';
  const assignacioCompleta =
    process.env.PLANIFICACIO_ASSIGNACIO_COMPLETA === 'true' || process.env.PLANIFICACIO_ASSIGNACIO_COMPLETA === '1';

  console.log('Carregant entregues des de Supabase i planificant rutes…');
  if (senseOsrm) console.log('(OSRM desactivat — PLANIFICACIO_OSRM=false)');

  const payload = await planificarRutesDesDeBaseDades({
    optimIntraRutaCarrers: !senseOsrm,
    assignacioCompleta,
  });

  const { resultat, entreguesCarregades, magatzem } = payload;
  const { rutes, entreguesNoAssignades } = resultat;

  console.log('\n——— Resum ———');
  console.log(`Magatzem: ${magatzem.x}, ${magatzem.y}`);
  console.log(`Entregues carregades (BD): ${entreguesCarregades}`);
  console.log(`Rutes amb parades: ${rutes.length}`);
  console.log(`No assignades: ${entreguesNoAssignades.length}`);
  rutes.forEach((r, i) => {
    console.log(
      `  Ruta ${i + 1}: ${r.camio?.id} · ${r.entregues?.length ?? 0} parades · volum ${r.volumOcupat}/${r.camio?.capacitatMaxima}`,
    );
  });

  await mkdir(dirSortida, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fitxer = path.join(dirSortida, `planificacio-informe-${stamp}.html`);
  const html = generaHtmlInformePlanificacio(payload);
  await writeFile(fitxer, html, 'utf8');

  console.log(`\nInforme HTML: ${fitxer}`);
  console.log('Obre el fitxer amb el navegador per veure el detall.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
