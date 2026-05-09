export { Pedido } from './classes/pedido.model.js';
export { Entrega } from './classes/entrega.model.js';
export { Ruta } from './classes/ruta.model.js';
export { Camio, FlotaCamions } from './classes/camio.model.js';
export { FLOTA_EXEMPLE_15_CAMIONS } from './config/flota-exemple-15.js';
/** Geocodificació Nominatim (opcional abans de {@link generarRutes}). Les entregues i flota vindran del teu API/BD. */
export { geocodificarAdrecaNominatim } from './services/geocodificar-adreca.service.js';
export { descripcioMotiuNoAssignacio, geocodificarAdreces, generarRutes } from './services/sweep-optimizer.service.js';

/** Pont BD ↔ optimizer (Supabase); vegeu també `src/data/database.js` i `src/data/repository.js`. */
export { createSupabaseClient, assertSupabaseConfigured } from '../../data/database.js';
export {
  agrupaFilesPerEntrega,
  agrupaTaulesEntregaPedido,
  fetchEntregasFromSource,
  fetchGroupedEntregues,
  persistirCoordenadesEntrega,
} from '../../data/repository.js';
export { generaHtmlInformePlanificacio } from '../../services/informe-planificacio-html.js';
export { obtenirMagatzemDesDeEnv, planificarRutesDesDeBaseDades } from '../../services/planificacio-bd.service.js';
