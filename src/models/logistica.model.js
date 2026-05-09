export class Entrega {
  constructor({ ubicacio, producte, franjaHoraria, identificador }) {
    this.ubicacio = ubicacio;
    this.producte = producte;
    this.franjaHoraria = franjaHoraria;
    this.identificador = identificador;
  }
}

export class Ruta {
  constructor({ camio, entregues = [] }) {
    this.camio = camio;
    this.entregues = entregues.map((entrega) =>
      entrega instanceof Entrega ? entrega : new Entrega(entrega),
    );
  }
}
