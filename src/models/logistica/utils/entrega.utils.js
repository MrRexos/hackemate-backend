// Comprova si una entrada ja es una instancia del model Entrega.
export function esInstanciaEntrega(entrega, EntregaClass) {
  return entrega instanceof EntregaClass;
}

// Construeix Entrega nomes quan la dada encara no es instancia.
export function construeixEntrega(entrega, EntregaClass) {
  return esInstanciaEntrega(entrega, EntregaClass) ? entrega : new EntregaClass(entrega);
}
