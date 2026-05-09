import { Entrega } from './entrega.model.js';
import { calculaTempsRutaAproximat, normalitzaEntregues, obtenirEntreguesAmbAngleDesDeCentre } from '../services/ruta.service.js';
import { geocodificarAdreces, generarRutes } from '../services/sweep-optimizer.service.js';
import { normalitzaPuntRuta } from '../utils/coordenades.utils.js';

// Model de ruta assignada a un camio amb el seu vector d'entregues.
export class Ruta {
  constructor({ camio, entregues = [], volumOcupat = 0 }) {
    this.camio = camio;
    this.entregues = normalitzaEntregues(entregues, Entrega);
    this.volumOcupat = Number(volumOcupat) || this.entregues.reduce((acc, e) => acc + Number(e.volumTotal || 0), 0);
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

  static async geocodificarAdreces(entregues, options = {}) {
    return geocodificarAdreces(entregues, options);
  }

  static async generarRutes(llistaEntregues, flotaCamions, puntMagatzem, options = {}) {
    return generarRutes(llistaEntregues, flotaCamions, puntMagatzem, {
      ...options,
      EntregaClass: Entrega,
    });
  }

  teCapacitatPer(entrega) {
    return this.volumOcupat + Number(entrega.volumTotal || 0) <= Number(this.camio?.capacitatMaxima || 0);
  }

  afegirEntrega(entrega) {
    this.entregues.push(entrega);
    this.volumOcupat += Number(entrega.volumTotal || 0);
  }
}
