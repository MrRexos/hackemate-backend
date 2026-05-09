import { FlotaCamions } from '../classes/camio.model.js';

/**
 * Flota d’exemple (15 vehicles). Els scripts de prova i qualsevol crida a `generarRutes`
 * poden importar aquesta instància per tenir sempre la mateixa flota.
 *
 * Per substituir per dades reals, edita aquest fitxer o importa una altra `FlotaCamions`.
 */
export const FLOTA_EXEMPLE_15_CAMIONS = new FlotaCamions([
  { capacitat: 120, numeroReferencia: 'VHC-MOL-01', tipus: 'rígid' },
  { capacitat: 120, numeroReferencia: 'VHC-MOL-02', tipus: 'rígid' },
  { capacitat: 110, numeroReferencia: 'VHC-MOL-03', tipus: 'rígid' },
  { capacitat: 105, numeroReferencia: 'VHC-MOL-04', tipus: 'rígid' },
  { capacitat: 100, numeroReferencia: 'VHC-MOL-05', tipus: 'rígid' },
  { capacitat: 95, numeroReferencia: 'VHC-MOL-06', tipus: 'furgoneta gran' },
  { capacitat: 95, numeroReferencia: 'VHC-MOL-07', tipus: 'furgoneta gran' },
  { capacitat: 90, numeroReferencia: 'VHC-MOL-08', tipus: 'furgoneta gran' },
  { capacitat: 88, numeroReferencia: 'VHC-MOL-09', tipus: 'furgoneta' },
  { capacitat: 88, numeroReferencia: 'VHC-MOL-10', tipus: 'furgoneta' },
  { capacitat: 130, numeroReferencia: 'VHC-MOL-11', tipus: 'articulat' },
  { capacitat: 125, numeroReferencia: 'VHC-MOL-12', tipus: 'articulat' },
  { capacitat: 115, numeroReferencia: 'VHC-MOL-13', tipus: 'rígid' },
  { capacitat: 108, numeroReferencia: 'VHC-MOL-14', tipus: 'rígid' },
  { capacitat: 102, numeroReferencia: 'VHC-MOL-15', tipus: 'rígid' },
]);
