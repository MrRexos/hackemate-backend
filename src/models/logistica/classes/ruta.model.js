import { Entrega } from './entrega.model.js';
import { normalitzaEntregues } from '../services/ruta.service.js';

export class Ruta {
  constructor({ camio, entregues = [] }) {
    this.camio = camio;
    this.entregues = normalitzaEntregues(entregues, Entrega);
  }
}
