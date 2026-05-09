import { Pedido } from './pedido.model.js';
import { coordenadesPolarsRespecteCentre, normalitzaCoordenades } from '../utils/coordenades.utils.js';

export class Entrega {
  constructor({ ubicacio, pedidos = [], horaInici, horaFinal, identificador, coordenades }) {
    this.ubicacio = ubicacio;
    this.pedidos = Entrega.normalitzaPedidos(pedidos);
    this.volumTotal = Entrega.calculaVolumTotal(this.pedidos);
    this.horaInici = horaInici;
    this.horaFinal = horaFinal;
    this.identificador = identificador;
    this.coordenades = Entrega.normalitzaCoordenades(coordenades);
  }

  static normalitzaPedidos(pedidos) {
    if (!Array.isArray(pedidos)) return [];
    return pedidos.map((pedido) => (pedido instanceof Pedido ? pedido : new Pedido(pedido)));
  }

  static calculaVolumTotal(pedidos) {
    return pedidos.reduce((total, pedido) => total + Number(pedido.volum || 0), 0);
  }

  static normalitzaCoordenades(coordenades) {
    return normalitzaCoordenades(coordenades);
  }

  static coordenadesPolarsRespecteMagatzem(coordenades, magatzem) {
    return coordenadesPolarsRespecteCentre(coordenades, magatzem);
  }

  async actualitzaCoordenadesDesDeAdreca(fetchImpl = fetch) {
    if (!this.ubicacio || typeof this.ubicacio !== 'string') {
      throw new Error("L'entrega no te una adreca valida a 'ubicacio'.");
    }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', this.ubicacio);

    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'HackeMate/1.0' },
    });

    if (!response.ok) {
      throw new Error(`Error geocodificant l'adreca (${response.status}).`);
    }

    const resultats = await response.json();
    if (!Array.isArray(resultats) || resultats.length === 0) {
      throw new Error(`No s'han trobat coordenades per a: ${this.ubicacio}`);
    }

    const primerResultat = resultats[0];
    this.coordenades = {
      x: Number(primerResultat.lon),
      y: Number(primerResultat.lat),
    };

    return this.coordenades;
  }

  obtenirCoordenadesPolars(magatzem) {
    return Entrega.coordenadesPolarsRespecteMagatzem(this.coordenades, magatzem);
  }
}
