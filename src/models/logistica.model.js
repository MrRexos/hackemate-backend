export class Pedido {
  constructor({ nom, volum }) {
    this.nom = nom;
    this.volum = volum;
  }
}

export class Entrega {
  constructor({ ubicacio, pedidos = [], franjaHoraria, identificador, coordenades }) {
    this.ubicacio = ubicacio;
    this.pedidos = Entrega.normalitzaPedidos(pedidos);
    this.volumTotal = Entrega.calculaVolumTotal(this.pedidos);
    this.franjaHoraria = franjaHoraria;
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
}
