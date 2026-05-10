import { Pedido } from './pedido.model.js';
import { coordenadesPolarsRespecteCentre, normalitzaCoordenades } from '../utils/coordenades.utils.js';

export class Entrega {
  /**
   * @param {object} params
   * @param {string|null} [params.horaDEntrega] — `null` fins el pla de rutes (`actualitzaEtasRutes`).
   */
  constructor({
    adreca,
    nom,
    pedidos = [],
    horaInici,
    horaFinal,
    identificador,
    coordenades,
    angle = null,
    horaDEntrega = null,
  }) {
    this.adreca = adreca ?? null;
    this.nom = nom ?? null;
    this.pedidos = Entrega.normalitzaPedidos(pedidos);
    this.volumTotal = Entrega.calculaVolumTotal(this.pedidos);
    this.horaInici = horaInici;
    this.horaFinal = horaFinal;
    this.identificador = identificador;
    this.coordenades = Entrega.normalitzaCoordenades(coordenades);
    this.angle = Number.isFinite(Number(angle)) ? Number(angle) : null;
    this.horaDEntrega = horaDEntrega ?? null;
  }

  static normalitzaPedidos(pedidos) {
    if (!Array.isArray(pedidos)) return [];
    return pedidos.map((pedido) => (pedido instanceof Pedido ? pedido : new Pedido(pedido)));
  }

  /** Suma de caixes equivalents de totes les línies de pedido. */
  static calculaVolumTotal(pedidos) {
    return pedidos.reduce((total, pedido) => total + Number(pedido.volumTotal || 0), 0);
  }

  static normalitzaCoordenades(coordenades) {
    return normalitzaCoordenades(coordenades);
  }

  static coordenadesPolarsRespecteMagatzem(coordenades, magatzem) {
    return coordenadesPolarsRespecteCentre(coordenades, magatzem);
  }

  async actualitzaCoordenadesDesDeAdreca(fetchImpl = fetch) {
    if (!this.adreca || typeof this.adreca !== 'string') {
      throw new Error("L'entrega no te una adreca valida.");
    }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', this.adreca);

    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'HackeMate/1.0' },
    });

    if (!response.ok) {
      throw new Error(`Error geocodificant l'adreca (${response.status}).`);
    }

    const resultats = await response.json();
    if (!Array.isArray(resultats) || resultats.length === 0) {
      throw new Error(`No s'han trobat coordenades per a: ${this.adreca}`);
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
