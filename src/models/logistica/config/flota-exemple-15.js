import { FlotaCamions } from '../classes/camio.model.js';

/**
 * Flota d’exemple (15 vehicles). Els scripts de prova i qualsevol crida a `generarRutes`
 * poden importar aquesta instància per tenir sempre la mateixa flota.
 *
 * Les capacitats són en **caixes equivalents** (mateixa unitat que `Pedido.volumTotal` / entrega).
 * `generarRutes` usa **només** aquesta llista com a vehicles (cap camió virtual per defecte) i respecta el **bloqueig**:
 * el mateix id no pot tenir dues rutes amb intervals de torn simultanis.
 * Per substituir per dades reals, edita aquest fitxer o importa una altra `FlotaCamions`.
 */
export const FLOTA_EXEMPLE_15_CAMIONS = new FlotaCamions([
  { capacitat: 360, numeroReferencia: 'VHC-MOL-01', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-02', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-03', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-04', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-05', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-06', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-07', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-08', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-09', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-10', tipus: 'Mitjà' },
  { capacitat: 360, numeroReferencia: 'VHC-MOL-11', tipus: 'Mitjà' },

  { capacitat: 480, numeroReferencia: 'VHC-MOL-12', tipus: 'Gran' },
  { capacitat: 480, numeroReferencia: 'VHC-MOL-13', tipus: 'Gran' },
  { capacitat: 480, numeroReferencia: 'VHC-MOL-14', tipus: 'Gran' },
  { capacitat: 480, numeroReferencia: 'VHC-MOL-15', tipus: 'Gran' },

  { capacitat: 180, numeroReferencia: 'VHC-MOL-1', tipus: 'furgoneta' },
]);
