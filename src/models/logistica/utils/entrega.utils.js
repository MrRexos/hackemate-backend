export function esInstanciaEntrega(entrega, EntregaClass) {
  return entrega instanceof EntregaClass;
}

export function construeixEntrega(entrega, EntregaClass) {
  return esInstanciaEntrega(entrega, EntregaClass) ? entrega : new EntregaClass(entrega);
}
