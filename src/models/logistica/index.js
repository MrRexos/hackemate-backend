// Punt d'entrada public del modul de logistica.
export { Pedido } from './classes/pedido.model.js';
export { Entrega } from './classes/entrega.model.js';
export { Ruta } from './classes/ruta.model.js';
export { Flota } from './classes/flota.model.js';
export { CAIXES_PER_PALE, FROTA_BASE, FROTA_BASE_AMB_CAIXES } from './config/camions.constants.js';
export { crearCamionsFixos, crearFlotaFixa } from './services/camions-fixos.service.js';
export { convertirExcelAProductes } from './services/excel-to-productes.converter.js';
export { convertirExcelAEntregas } from './services/excel-to-entregas.converter.js';
export { geocodificarAdreces, generarRutes } from './services/sweep-optimizer.service.js';
