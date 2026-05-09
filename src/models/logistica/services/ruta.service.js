import { asseguraArray } from '../validators/logistica.validators.js';
import { construeixEntrega } from '../utils/entrega.utils.js';

export function normalitzaEntregues(entregues, EntregaClass) {
  const entreguesArray = asseguraArray(entregues, 'entregues');
  return entreguesArray.map((entrega) => construeixEntrega(entrega, EntregaClass));
}
