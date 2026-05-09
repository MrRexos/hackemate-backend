import { asseguraArray } from '../validators/logistica.validators.js';
import { construeixEntrega } from '../utils/entrega.utils.js';
import { coordenadesPolarsRespecteCentre } from '../utils/coordenades.utils.js';

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

function normalitzaPuntRutaService(punt, nomCamp) {
  if (Array.isArray(punt) && punt.length >= 2) {
    return { x: Number(punt[0]), y: Number(punt[1]) };
  }

  if (punt && typeof punt === 'object' && punt.x != null && punt.y != null) {
    return { x: Number(punt.x), y: Number(punt.y) };
  }

  throw new Error(`El punt '${nomCamp}' no te un format de coordenades valid.`);
}
