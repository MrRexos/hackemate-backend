export { Pedido } from './classes/pedido.model.js';
export {
  extreuCodiTipusCarrega,
  factorCaixesPerUnitatTipusCarrega,
} from './constants/factor-tipus-carrega.constants.js';
export {
  FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO,
  MARGE_ESTRICTE_UTILITZACIO_RELATIU,
  volumCarregaMaximaOperativa,
  volumLimitOperatiuPerAssignacio,
  volumPermetAfegirACamio,
  volumSuperaLimitOperatiu,
} from './constants/capacitat-camio.constants.js';
export { Entrega } from './classes/entrega.model.js';
export { Ruta } from './classes/ruta.model.js';
export { Camio, FlotaCamions } from './classes/camio.model.js';
export { FLOTA_EXEMPLE_15_CAMIONS } from './config/flota-exemple-15.js';
/** Geocodificació Nominatim (opcional abans de {@link generarRutes}). */
export {
  geocodificarAdrecaNominatim,
  geocodificarAdrecaNominatimCompleta,
  geocodificarEntreguesNominatim,
  parseAdrecaConcatenadaEspanya,
} from './services/geocodificar-adreca.service.js';
export { descripcioMotiuNoAssignacio, geocodificarAdreces, generarRutes } from './services/sweep-optimizer.service.js';
export {
  guardarResultatGenerarRutesJson,
  serialitzaResultatGenerarRutes,
} from './services/serialitza-resultat-rutes.js';

export {
  COLUMNES_EXCEL_DEFECTE,
  llegeixExcelAPedidos,
  normalitzaCodiPostalEspanya,
  normalitzaValorDia,
  RUTA_EXCEL_COMANDES_DEFECTE,
} from './services/excel-a-pedidos.reader.js';
export { agrupaPedidosEnEntregues } from './utils/entrega.utils.js';
export {
  capacitatOperativaMaximaFlota,
  empaquetaPedidosEnBinsPerVolumMax,
  fragmentaEntreguesSuperiorsACapacitatMaxCamio,
} from './utils/fragmenta-entregues-capacitat.utils.js';
