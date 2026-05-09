import { FROTA_BASE_AMB_CAIXES } from '../config/camions.constants.js';
import { Flota } from '../classes/flota.model.js';

/**
 * Genera el vector de camions individuals a partir de la flota fixa.
 */
export function crearCamionsFixos() {
  // Deleguem l'expansio de flota al model Flota.
  const flota = new Flota(FROTA_BASE_AMB_CAIXES);
  return flota.toCamions();
}

// Exposa la flota fixa en format resumit per configurar algoritmes.
export function crearFlotaFixa() {
  return new Flota(FROTA_BASE_AMB_CAIXES);
}
