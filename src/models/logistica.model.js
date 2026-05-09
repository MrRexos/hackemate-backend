export class Pedido { 
  constructor({ nom, volum, quantitat }) {
    this.nom = nom;
    this.volum = volum * quantitat;
    this.quantitat = quantitat;
  }
}

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
    if (!coordenades) return null;

    if (Array.isArray(coordenades)) {
      const [x, y] = coordenades;
      return { x: Number(x), y: Number(y) };
    }

    if (typeof coordenades === 'object' && coordenades.x != null && coordenades.y != null) {
      return { x: Number(coordenades.x), y: Number(coordenades.y) };
    }

    return null;
  }

  /**
   * Converteix coordenades cartesianes (x, y) a polars prenent el magatzem com a centre.
   * Retorna { r, thetaRadians, thetaGraus }.
   */
  static coordenadesPolarsRespecteMagatzem(coordenades, magatzem) {
    const punt = Entrega.normalitzaCoordenades(coordenades);
    const centre = Entrega.normalitzaCoordenades(magatzem);

    if (!punt) {
      throw new Error("Les coordenades de l'entrega no son valides.");
    }

    if (!centre) {
      throw new Error("Les coordenades del magatzem no son valides.");
    }

    const dx = punt.x - centre.x;
    const dy = punt.y - centre.y;

    const r = Math.sqrt(dx ** 2 + dy ** 2);
    const thetaRadians = Math.atan2(dy, dx);
    const thetaGraus = (thetaRadians * 180) / Math.PI;

    return { r, thetaRadians, thetaGraus };
  }

  /**
   * Geocodifica una adreca i desa les coordenades en format { x, y }.
   * x = longitud, y = latitud.
   */
  async actualitzaCoordenadesDesDeAdreca(fetchImpl = fetch) {
    if (!this.ubicacio || typeof this.ubicacio !== 'string') {
      throw new Error("L'entrega no te una adreca valida a 'ubicacio'.");
    }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', this.ubicacio);

    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': 'HackeMate/1.0',
      },
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

  /**
   * Calcula les coordenades polars de l'entrega respecte al magatzem.
   */
  obtenirCoordenadesPolars(magatzem) {
    return Entrega.coordenadesPolarsRespecteMagatzem(this.coordenades, magatzem);
  }
}

export class Ruta {
  constructor({ camio, entregues = [] }) {
    this.camio = camio;
    this.entregues = entregues.map((entrega) =>
      entrega instanceof Entrega ? entrega : new Entrega(entrega),
    );
  }

  /**
   * Calcula el centre (mitjana de coordenades) i retorna totes les entregues amb angle polar.
   */
  obtenirEntreguesAmbAngleDesDeCentre() {
    const entreguesValides = this.entregues.filter((entrega) => Entrega.normalitzaCoordenades(entrega.coordenades));

    if (entreguesValides.length === 0) {
      throw new Error("No hi ha entregues amb coordenades valides per calcular el centre.");
    }

    const suma = entreguesValides.reduce(
      (acc, entrega) => {
        const { x, y } = Entrega.normalitzaCoordenades(entrega.coordenades);
        return { x: acc.x + x, y: acc.y + y };
      },
      { x: 0, y: 0 },
    );

    const centre = {
      x: suma.x / entreguesValides.length,
      y: suma.y / entreguesValides.length,
    };

    const entreguesAmbAngle = entreguesValides.map((entrega) => {
      const polar = Entrega.coordenadesPolarsRespecteMagatzem(entrega.coordenades, centre);
      return {
        entrega,
        angleRadians: polar.thetaRadians,
        angleGraus: polar.thetaGraus,
        radi: polar.r,
      };
    })
      .sort((a, b) => a.angleRadians - b.angleRadians);

    return {
      centre,
      entreguesAmbAngle,
    };
  }

  /**
   * Calcula temps i distancia aproximats entre dos punts
   * tenint en compte la xarxa de carreteres (OSRM).
   */
  static async calculaTempsRutaAproximat(origen, desti, options = {}) {
    const { fetchImpl = fetch, osrmBaseUrl = 'https://router.project-osrm.org' } = options;
    const puntOrigen = Ruta.normalitzaPuntRuta(origen, 'origen');
    const puntDesti = Ruta.normalitzaPuntRuta(desti, 'desti');

    const coordenades = `${puntOrigen.x},${puntOrigen.y};${puntDesti.x},${puntDesti.y}`;
    const url = new URL(`${osrmBaseUrl}/route/v1/driving/${coordenades}`);
    url.searchParams.set('overview', 'false');
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`No s'ha pogut calcular la ruta per carretera (${response.status}).`);
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error("L'API de rutes no ha retornat cap trajecte valid.");
    }

    const millorRuta = data.routes[0];
    const distanciaMetres = Number(millorRuta.distance);
    const duradaSegons = Number(millorRuta.duration);

    return {
      distanciaMetres,
      distanciaKm: distanciaMetres / 1000,
      duradaSegons,
      duradaMinuts: duradaSegons / 60,
    };
  }

  static normalitzaPuntRuta(punt, nomCamp) {
    if (Array.isArray(punt) && punt.length >= 2) {
      return { x: Number(punt[0]), y: Number(punt[1]) };
    }

    if (punt && typeof punt === 'object' && punt.x != null && punt.y != null) {
      return { x: Number(punt.x), y: Number(punt.y) };
    }

    throw new Error(`El punt '${nomCamp}' no te un format de coordenades valid.`);
  }
}
