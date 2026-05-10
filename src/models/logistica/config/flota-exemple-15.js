import { FlotaCamions } from '../classes/camio.model.js';

/**
 * Flota d’exemple (16 vehicles amb referències VHC-MOL-*).
 * En producció substitueix-la per dades de BD/API; aquí només hi ha valors de referència per desenvolupament.
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
