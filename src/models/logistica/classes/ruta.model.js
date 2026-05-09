import { Entrega } from './entrega.model.js';
import { calculaTempsRutaAproximat, normalitzaEntregues, obtenirEntreguesAmbAngleDesDeCentre } from '../services/ruta.service.js';
import { normalitzaPuntRuta } from '../utils/coordenades.utils.js';

export class Ruta {
  constructor({ camio, entregues = [] }) {
    this.camio = camio;
    this.entregues = normalitzaEntregues(entregues, Entrega);
  }

  obtenirEntreguesAmbAngleDesDeCentre() {
    return obtenirEntreguesAmbAngleDesDeCentre(this.entregues);
  }

  static async calculaTempsRutaAproximat(origen, desti, options = {}) {
    return calculaTempsRutaAproximat(origen, desti, options);
  }

  static normalitzaPuntRuta(punt, nomCamp) {
    return normalitzaPuntRuta(punt, nomCamp);
  }
}
