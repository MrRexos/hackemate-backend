import { Entrega } from './entrega.model.js';
import { calculaTempsRutaAproximat, normalitzaEntregues, obtenirEntreguesAmbAngleDesDeCentre } from '../services/ruta.service.js';
import { normalitzaPuntRuta } from '../utils/coordenades.utils.js';

// Model de ruta assignada a un camio amb el seu vector d'entregues.
export class Ruta {
  constructor({ camio, entregues = [] }) {
    this.camio = camio;
    this.entregues = normalitzaEntregues(entregues, Entrega);
  }

  // Delega el calcul angular al servei de rutes.
  obtenirEntreguesAmbAngleDesDeCentre() {
    return obtenirEntreguesAmbAngleDesDeCentre(this.entregues);
  }

  // Exposa calcul de distancia/temps per carretera (OSRM).
  static async calculaTempsRutaAproximat(origen, desti, options = {}) {
    return calculaTempsRutaAproximat(origen, desti, options);
  }

  // Exposa normalitzacio de punts per compatibilitat d'API.
  static normalitzaPuntRuta(punt, nomCamp) {
    return normalitzaPuntRuta(punt, nomCamp);
  }
}
