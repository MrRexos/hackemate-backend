import { asseguraObjecte } from '../validators/logistica.validators.js';

export class Entrega {
  constructor(data) {
    const { ubicacio, producte, franjaHoraria, identificador } = asseguraObjecte(data, 'entrega');
    this.ubicacio = ubicacio;
    this.producte = producte;
    this.franjaHoraria = franjaHoraria;
    this.identificador = identificador;
  }
}
