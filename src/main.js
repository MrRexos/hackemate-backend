/**
 * Exemple d’ús del repositori logístic amb Supabase + agrupació + geocodificació amb caché a BD.
 *
 * Execució:
 *   node src/main.js
 *
 * Supabase: definex variables a `.env.local` o `.env` (`.env.local` té prioritat).
 */
import { env } from './config/env.js';
import { fetchEntregasFromSource } from './data/repository.js';

async function main() {
  console.log('Connexió Supabase:', env.supabaseUrl ? `${env.supabaseUrl.slice(0, 32)}…` : '(sense URL)');
  console.log('Mode font:', env.logisticsSourceMode);
  if (env.logisticsSourceMode === 'joined') {
    console.log('Taules:', env.logisticsTableEntregues, '+', env.logisticsTablePedidos);
  } else {
    console.log('Vista/taula pla:', env.logisticsFlatView);
  }
  console.log('Taula persistència coords:', env.logisticsEntreguesTable);

  const entregues = await fetchEntregasFromSource();

  console.log(`Entregues instanciades: ${entregues.length}`);
  for (const e of entregues.slice(0, 5)) {
    console.log(
      ` - ${e.identificador} | volumTotal=${e.volumTotal} | coords (${e.coordenades?.x}, ${e.coordenades?.y}) | pedidos=${e.pedidos.length}`,
    );
  }
  if (entregues.length > 5) console.log(` … i ${entregues.length - 5} més`);

  // Aquí pots encadenar l’optimizer:
  // import { FLOTA_EXEMPLE_15_CAMIONS, generarRutes } from './models/logistica/index.js';
  // const magatzem = { x: 2.1718, y: 41.5278 };
  // const resultat = await generarRutes(entregues, FLOTA_EXEMPLE_15_CAMIONS.perOptimizador(), magatzem, { EntregaClass: Entrega });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
