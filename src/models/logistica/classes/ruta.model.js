import { Entrega } from './entrega.model.js';
import { volumPermetAfegirACamio } from '../constants/capacitat-camio.constants.js';
import { calculaTempsRutaAproximat, normalitzaEntregues, obtenirEntreguesAmbAngleDesDeCentre } from '../services/ruta.service.js';
import { geocodificarAdreces, generarRutes } from '../services/sweep-optimizer.service.js';
import { normalitzaPuntRuta } from '../utils/coordenades.utils.js';

export class Ruta {
  constructor({
    camio,
    entregues = [],
    volumOcupat = 0,
    horaSortidaMagatzemAproximada = null,
    horaArribadaMagatzemAproximada = null,
  }) {
    this.camio = camio;
    this.entregues = normalitzaEntregues(entregues, Entrega);
    this.volumOcupat = Number(volumOcupat) || this.entregues.reduce((acc, e) => acc + Number(e.volumTotal || 0), 0);
    /** Sortida aproximada del magatzem (`HH:mm`); `null` fins el pla de rutes. */
    this.horaSortidaMagatzemAproximada = horaSortidaMagatzemAproximada;
    /** Retorn aproximat al magatzem (`HH:mm`); `null` fins el pla de rutes. */
    this.horaArribadaMagatzemAproximada = horaArribadaMagatzemAproximada;
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
    return volumPermetAfegirACamio(this.volumOcupat, entrega?.volumTotal ?? 0, this.camio);
  }

  afegirEntrega(entrega) {
    this.entregues.push(entrega);
    this.volumOcupat += Number(entrega.volumTotal || 0);
  }
}
