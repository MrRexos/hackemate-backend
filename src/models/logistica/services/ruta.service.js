import { asseguraArray } from '../validators/logistica.validators.js';
import { construeixEntrega } from '../utils/entrega.utils.js';
import { coordenadesPolarsRespecteCentre, normalitzaCoordenades, normalitzaPuntRuta } from '../utils/coordenades.utils.js';

export function normalitzaEntregues(entregues, EntregaClass) {
  const entreguesArray = asseguraArray(entregues, 'entregues');
  return entreguesArray.map((entrega) => construeixEntrega(entrega, EntregaClass));
}

export function obtenirEntreguesAmbAngleDesDeCentre(entregues) {
  const entreguesValides = entregues.filter((entrega) => entrega.constructor.normalitzaCoordenades(entrega.coordenades));

  if (entreguesValides.length === 0) {
    throw new Error("No hi ha entregues amb coordenades valides per calcular el centre.");
  }

  const suma = entreguesValides.reduce(
    (acc, entrega) => {
      const { x, y } = entrega.constructor.normalitzaCoordenades(entrega.coordenades);
      return { x: acc.x + x, y: acc.y + y };
    },
    { x: 0, y: 0 },
  );

  const centre = {
    x: suma.x / entreguesValides.length,
    y: suma.y / entreguesValides.length,
  };

  const entreguesAmbAngle = entreguesValides
    .map((entrega) => {
      const polar = coordenadesPolarsRespecteCentre(entrega.coordenades, centre);
      return {
        entrega,
        angleRadians: polar.thetaRadians,
        angleGraus: polar.thetaGraus,
        radi: polar.r,
      };
    })
    .sort((a, b) => a.angleRadians - b.angleRadians);

  return { centre, entreguesAmbAngle };
}

export async function calculaTempsRutaAproximat(origen, desti, options = {}) {
  const { fetchImpl = fetch, osrmBaseUrl = 'https://router.project-osrm.org' } = options;
  const puntOrigen = normalitzaPuntRutaService(origen, 'origen');
  const puntDesti = normalitzaPuntRutaService(desti, 'desti');

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

export async function geocodificarAdreces(entregues, options = {}) {
  const { fetchImpl = fetch, usaMock = true } = options;
  const entreguesArray = asseguraArray(entregues, 'entregues');
  const geocodificades = [];

  for (const entrega of entreguesArray) {
    if (normalitzaCoordenades(entrega.coordenades)) {
      geocodificades.push(entrega);
      continue;
    }

    const adreca = entrega.ubicacio ?? entrega.adreca;
    if (!adreca) {
      throw new Error(`Entrega sense adreca: ${entrega.identificador ?? 'sense-id'}`);
    }

    let coordenades = null;

    if (!usaMock) {
      coordenades = await geocodificaAdrecaOSM(adreca, fetchImpl);
    } else {
      coordenades = geocodificaAdrecaMock(adreca);
    }

    entrega.coordenades = coordenades;
    geocodificades.push(entrega);
  }

  return geocodificades;
}

export async function generarRutes(llistaEntregues, flotaCamions, puntMagatzem, options = {}) {
  const entreguesInput = asseguraArray(llistaEntregues, 'llistaEntregues');
  const camions = asseguraArray(flotaCamions, 'flotaCamions');
  const magatzem = normalitzaPuntRuta(puntMagatzem, 'puntMagatzem');
  const velocitatKmH = Number(options.velocitatKmH) || 40;
  const entregaClass = options.EntregaClass;
  const entreguesNormalitzades = entregaClass
    ? normalitzaEntregues(entreguesInput, entregaClass)
    : entreguesInput;
  const entregues = await geocodificarAdreces(entreguesNormalitzades, options);

  const preprocessades = preprocessaAngles(entregues, magatzem);
  const mati = preprocessades.filter((e) => teFranjaMati(e));
  const tarda = preprocessades.filter((e) => teFranjaTarda(e));
  const resta = preprocessades.filter((e) => !teFranjaMati(e) && !teFranjaTarda(e));

  const context = { magatzem, camions, velocitatKmH };
  const rutes = [];
  const noAssignades = [];

  assignaSweepAFase(mati, rutes, context, noAssignades);
  assignaSweepAFase(tarda, rutes, context, noAssignades);
  insertaSobrantsPerProximitat(resta, rutes, context, noAssignades);

  for (const ruta of rutes) {
    reordenaRutaPerProximitat(ruta, magatzem);
  }

  reubicaEntreguesInvalides(rutes, context, noAssignades);
  const rutesFinals = rutes.filter((ruta) => ruta.entregues.length > 0);

  return {
    rutes: rutesFinals,
    entreguesNoAssignades: noAssignades,
  };
}

function preprocessaAngles(entregues, magatzem) {
  return entregues
    .map((entrega) => {
      const polar = coordenadesPolarsRespecteCentre(entrega.coordenades, magatzem);
      const angle = normalitzaAngle360(polar.thetaGraus);
      entrega.angle = angle;
      return entrega;
    })
    .sort((a, b) => a.angle - b.angle);
}

function assignaSweepAFase(entregues, rutes, context, noAssignades) {
  for (const entrega of entregues) {
    const rutaCompatible = trobaMillorRuta(entrega, rutes, context);
    if (rutaCompatible) {
      rutaCompatible.afegirEntrega(entrega);
      continue;
    }

    const rutaNova = creaRutaNovaPerEntrega(entrega, context.camions, rutes.length + 1);
    if (!rutaNova) {
      noAssignades.push(entrega);
      continue;
    }

    if (esEntregaFactibleARuta(entrega, rutaNova, context)) {
      rutaNova.afegirEntrega(entrega);
      rutes.push(rutaNova);
    } else {
      noAssignades.push(entrega);
    }
  }
}

function insertaSobrantsPerProximitat(entregues, rutes, context, noAssignades) {
  for (const entrega of entregues) {
    const rutesPerDistancia = [...rutes].sort(
      (a, b) => distanciaAlUltimPunt(a, entrega, context.magatzem) - distanciaAlUltimPunt(b, entrega, context.magatzem),
    );

    let assignada = false;
    for (const ruta of rutesPerDistancia) {
      if (!ruta.teCapacitatPer(entrega)) continue;
      ruta.afegirEntrega(entrega);
      if (teFinestresValides(ruta, context)) {
        assignada = true;
        break;
      }
      ruta.entregues.pop();
      ruta.volumOcupat -= Number(entrega.volumTotal || 0);
    }

    if (!assignada) {
      const rutaNova = creaRutaNovaPerEntrega(entrega, context.camions, rutes.length + 1);
      if (rutaNova && esEntregaFactibleARuta(entrega, rutaNova, context)) {
        rutaNova.afegirEntrega(entrega);
        rutes.push(rutaNova);
      } else {
        noAssignades.push(entrega);
      }
    }
  }
}

function reordenaRutaPerProximitat(ruta, magatzem) {
  const pendents = [...ruta.entregues];
  const ordenades = [];
  let puntActual = magatzem;

  while (pendents.length > 0) {
    pendents.sort((a, b) => distanciaEuclidiana(puntActual, a.coordenades) - distanciaEuclidiana(puntActual, b.coordenades));
    const seguent = pendents.shift();
    ordenades.push(seguent);
    puntActual = seguent.coordenades;
  }

  ruta.entregues = ordenades;
}

function reubicaEntreguesInvalides(rutes, context, noAssignades) {
  for (const ruta of rutes) {
    while (!teFinestresValides(ruta, context) && ruta.entregues.length > 0) {
      const expulsada = ruta.entregues.pop();
      ruta.volumOcupat -= Number(expulsada.volumTotal || 0);
      const destinacio = trobaMillorRuta(expulsada, rutes.filter((r) => r !== ruta), context);
      if (destinacio) {
        destinacio.afegirEntrega(expulsada);
      } else {
        noAssignades.push(expulsada);
      }
    }
  }
}

function trobaMillorRuta(entrega, rutes, context) {
  const candidates = rutes
    .filter((ruta) => ruta.teCapacitatPer(entrega))
    .sort((a, b) => b.volumOcupat - a.volumOcupat);

  for (const ruta of candidates) {
    ruta.afegirEntrega(entrega);
    const valida = teFinestresValides(ruta, context);
    if (valida) return ruta;
    ruta.entregues.pop();
    ruta.volumOcupat -= Number(entrega.volumTotal || 0);
  }

  return null;
}

function esEntregaFactibleARuta(entrega, ruta, context) {
  if (!ruta.teCapacitatPer(entrega)) return false;
  const backup = [...ruta.entregues];
  const backupVolum = ruta.volumOcupat;
  ruta.afegirEntrega(entrega);
  const valida = teFinestresValides(ruta, context);
  ruta.entregues = backup;
  ruta.volumOcupat = backupVolum;
  return valida;
}

function teFinestresValides(ruta, context) {
  let tempsMinuts = 0;
  let puntActual = context.magatzem;

  for (const entrega of ruta.entregues) {
    tempsMinuts += tempsViatgeMinuts(puntActual, entrega.coordenades, context.velocitatKmH);
    const arribadaMin = tempsMinuts;

    const inici = horaATotalMinuts(entrega.horaInici);
    const fi = horaATotalMinuts(entrega.horaFinal);

    if (inici != null && arribadaMin < inici) {
      tempsMinuts = inici;
    }

    if (fi != null && arribadaMin > fi) {
      return false;
    }

    puntActual = entrega.coordenades;
  }

  return true;
}

function creaRutaNovaPerEntrega(entrega, flotaCamions, index) {
  const volumEntrega = Number(entrega.volumTotal || 0);
  const camio = flotaCamions.find((c) => Number(c.capacitatMaxima || 0) >= volumEntrega);
  if (!camio) return null;
  return {
    camio: { id: camio.id ?? `camio-${index}`, capacitatMaxima: Number(camio.capacitatMaxima) },
    entregues: [],
    volumOcupat: 0,
    teCapacitatPer(entregaActual) {
      return this.volumOcupat + Number(entregaActual.volumTotal || 0) <= Number(this.camio?.capacitatMaxima || 0);
    },
    afegirEntrega(entregaActual) {
      this.entregues.push(entregaActual);
      this.volumOcupat += Number(entregaActual.volumTotal || 0);
    },
  };
}

function teFranjaMati(entrega) {
  const fi = horaATotalMinuts(entrega.horaFinal);
  return fi != null && fi <= 14 * 60;
}

function teFranjaTarda(entrega) {
  const inici = horaATotalMinuts(entrega.horaInici);
  return inici != null && inici >= 14 * 60;
}

function horaATotalMinuts(hora) {
  if (!hora || typeof hora !== 'string') return null;
  const [h, m] = hora.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function normalitzaAngle360(angleGraus) {
  return ((angleGraus % 360) + 360) % 360;
}

function distanciaAlUltimPunt(ruta, entrega, magatzem) {
  const ultim = ruta.entregues.length > 0 ? ruta.entregues[ruta.entregues.length - 1].coordenades : magatzem;
  return distanciaEuclidiana(ultim, entrega.coordenades);
}

function distanciaEuclidiana(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx ** 2 + dy ** 2);
}

function tempsViatgeMinuts(origen, desti, velocitatKmH) {
  const km = distanciaEuclidiana(origen, desti);
  return (km / velocitatKmH) * 60;
}

async function geocodificaAdrecaOSM(adreca, fetchImpl) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', adreca);

  const response = await fetchImpl(url, { headers: { 'User-Agent': 'HackeMate/1.0' } });
  if (!response.ok) {
    throw new Error(`Error geocodificant l'adreca (${response.status}).`);
  }

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`No s'han trobat coordenades per a: ${adreca}`);
  }

  return {
    x: Number(resultats[0].lon),
    y: Number(resultats[0].lat),
  };
}

function geocodificaAdrecaMock(adreca) {
  let hash = 0;
  for (let i = 0; i < adreca.length; i += 1) {
    hash = (hash << 5) - hash + adreca.charCodeAt(i);
    hash |= 0;
  }

  const baseX = 2.0;
  const baseY = 41.0;
  const x = baseX + ((Math.abs(hash) % 1000) / 1000) * 0.5;
  const y = baseY + ((Math.abs(hash >> 3) % 1000) / 1000) * 0.5;

  return { x, y };
}
