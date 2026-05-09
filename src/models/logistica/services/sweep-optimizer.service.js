import { asseguraArray } from '../validators/logistica.validators.js';
import { construeixEntrega } from '../utils/entrega.utils.js';
import { coordenadesPolarsRespecteCentre, normalitzaCoordenades, normalitzaPuntRuta } from '../utils/coordenades.utils.js';

const MIGDIA_MINUTS = 14 * 60;
const TEMPS_SERVEI_MINUTS = 5;

export async function geocodificarAdreces(entregues, options = {}) {
  const { usaMock = true, fetchImpl = fetch } = options;
  const llista = asseguraArray(entregues, 'entregues');
  const resultat = [];

  for (const entrega of llista) {
    if (normalitzaCoordenades(entrega.coordenades)) {
      resultat.push(entrega);
      continue;
    }

    const adreca = entrega.adreca ?? entrega.ubicacio;
    if (!adreca) {
      throw new Error(`Entrega sense adreca: ${entrega.identificador ?? 'sense-id'}`);
    }

    entrega.coordenades = usaMock
      ? await geocodificaAdrecaMockAsync(adreca)
      : await geocodificaAdrecaOSM(adreca, fetchImpl);

    resultat.push(entrega);
  }

  return resultat;
}

export async function generarRutes(llistaEntregues, flotaCamions, puntMagatzem, options = {}) {
  const entreguesInput = asseguraArray(llistaEntregues, 'llistaEntregues');
  const camions = asseguraArray(flotaCamions, 'flotaCamions');
  const magatzem = normalitzaPuntRuta(puntMagatzem, 'puntMagatzem');
  const velocitatKmH = Number(options.velocitatKmH) || 40;
  const tempsDescarregaMinuts = Number(options.tempsDescarregaMinuts) || TEMPS_SERVEI_MINUTS;
  const tempsBaseDescarregaMinuts = Number(options.tempsBaseDescarregaMinuts) || 2;
  const tempsPerCaixaMinuts = Number(options.tempsPerCaixaMinuts) || 0.35;
  const EntregaClass = options.EntregaClass;

  const entreguesNormalitzades = EntregaClass
    ? entreguesInput.map((e) => construeixEntrega(e, EntregaClass))
    : entreguesInput;

  const entregues = await geocodificarAdreces(entreguesNormalitzades, options);
  const ordenadesPerAngle = preprocessaAngles(entregues, magatzem);

  const faseSenseFranja = ordenadesPerAngle.filter((e) => !teFranjaMati(e) && !teFranjaTarda(e));
  const faseMati = ordenadesPerAngle.filter((e) => teFranjaMati(e) || faseSenseFranja.includes(e));
  const faseTarda = ordenadesPerAngle.filter((e) => teFranjaTarda(e) || faseSenseFranja.includes(e));

  const context = {
    camions,
    camionsDisponibles: [...camions],
    magatzem,
    velocitatKmH,
    tempsDescarregaMinuts,
    tempsBaseDescarregaMinuts,
    tempsPerCaixaMinuts,
  };
  const rutes = [];
  const entreguesNoAssignades = [];

  sweepAssignacio(faseMati, rutes, context, entreguesNoAssignades, 'mati', { registrarNoAssignades: false });
  sweepAssignacio(faseTarda, rutes, context, entreguesNoAssignades, 'tarda', { registrarNoAssignades: false });

  const fasePendent = ordenadesPerAngle.filter((e) => !e.__assignada);
  insertaSobrantsPerProximitat(fasePendent, rutes, context, entreguesNoAssignades);

  for (const ruta of rutes) {
    optimitzaRuta2Opt(ruta, context);
  }

  revalidaFinestresDespuesOptimitzar(rutes, context, entreguesNoAssignades);
  actualitzaEtasRutes(rutes, context);

  return {
    rutes: rutes.filter((r) => r.entregues.length > 0),
    entreguesNoAssignades,
  };
}

function preprocessaAngles(entregues, magatzem) {
  return entregues
    .map((entrega) => {
      const polar = coordenadesPolarsRespecteCentre(entrega.coordenades, magatzem);
      entrega.angle = normalitzaAngle360((polar.thetaRadians * 180) / Math.PI);
      return entrega;
    })
    .sort((a, b) => a.angle - b.angle);
}

function sweepAssignacio(entregues, rutes, context, noAssignades, fase, options = {}) {
  const { registrarNoAssignades = true } = options;
  for (const entrega of entregues) {
    if (entrega.__assignada) continue;
    entrega.__fase = fase;

    const candidates = [...rutes]
      .filter((ruta) => teCapacitatPer(ruta, entrega))
      .sort((a, b) => b.volumOcupat - a.volumOcupat);

    let assignada = false;
    for (const ruta of candidates) {
      afegeixEntrega(ruta, entrega);
      if (teFinestresValides(ruta, context)) {
        intentaOptimitzacioIncremental(ruta, context);
        entrega.__assignada = true;
        assignada = true;
        break;
      }
      desfesUltimaEntrega(ruta);
    }

    if (assignada) continue;

    const novaRuta = creaRutaNova(entrega, context, rutes.length + 1);
    if (!novaRuta) {
      if (registrarNoAssignades) noAssignades.push(entrega);
      continue;
    }

    afegeixEntrega(novaRuta, entrega);
    if (teFinestresValides(novaRuta, context)) {
      intentaOptimitzacioIncremental(novaRuta, context);
      entrega.__assignada = true;
      rutes.push(novaRuta);
    } else {
      if (registrarNoAssignades) noAssignades.push(entrega);
    }
  }
}

function insertaSobrantsPerProximitat(entregues, rutes, context, noAssignades) {
  for (const entrega of entregues) {
    entrega.__fase = 'resta';
    const candidates = [...rutes];

    let assignada = false;
    for (const ruta of candidates) {
      if (insereixEntregaMinimCost(ruta, entrega, context)) {
        intentaOptimitzacioIncremental(ruta, context);
        entrega.__assignada = true;
        assignada = true;
        break;
      }
    }

    if (!assignada) {
      const novaRuta = creaRutaNova(entrega, context, rutes.length + 1);
      if (!novaRuta) {
        noAssignades.push(entrega);
        continue;
      }

      afegeixEntrega(novaRuta, entrega);
      if (teFinestresValides(novaRuta, context)) {
        intentaOptimitzacioIncremental(novaRuta, context);
        entrega.__assignada = true;
        rutes.push(novaRuta);
      } else {
        noAssignades.push(entrega);
      }
    }
  }
}

function revalidaFinestresDespuesOptimitzar(rutes, context, noAssignades) {
  for (const ruta of rutes) {
    if (teFinestresValides(ruta, context)) continue;

    const sobrants = ruta.entregues.filter((e) => e.__fase === 'resta');
    for (const entrega of sobrants) {
      eliminaEntrega(ruta, entrega);
      entrega.__assignada = false;
      noAssignades.push(entrega);
      if (teFinestresValides(ruta, context)) break;
    }

    if (!teFinestresValides(ruta, context)) {
      while (!teFinestresValides(ruta, context) && ruta.entregues.length > 0) {
        const entregaExpulsada = ruta.entregues.pop();
        entregaExpulsada.__assignada = false;
        noAssignades.push(entregaExpulsada);
        recalculaVolum(ruta);
      }
    }
  }
}

function teFinestresValides(ruta, context) {
  return calculaPlanificacioRuta(ruta, context, 0).valida;
}

function calculaPlanificacioRuta(ruta, context, tempsSortidaMin = 0) {
  let tempsActual = Math.max(0, Number(tempsSortidaMin) || 0);
  let puntActual = context.magatzem;
  const parades = [];

  for (const entrega of ruta.entregues) {
    tempsActual += tempsViatgeMinuts(puntActual, entrega.coordenades, context.velocitatKmH);
    const arribadaSenseEspera = tempsActual;

    const inici = horaATotalMinuts(entrega.horaInici);
    const fi = horaATotalMinuts(entrega.horaFinal);

    if (inici != null && tempsActual < inici) {
      tempsActual = inici;
    }

    if (fi != null && tempsActual > fi) {
      return {
        valida: false,
        parades,
      };
    }

    const arribadaMin = tempsActual;
    const tempsDescarregaEntrega = calculaTempsDescarregaEntrega(entrega, context);
    const sortidaMin = arribadaMin + tempsDescarregaEntrega;
    parades.push({
      entrega,
      arribadaMin,
      sortidaMin,
      tempsDescarregaEntrega,
      esperaMin: Math.max(0, arribadaMin - arribadaSenseEspera),
    });

    tempsActual += tempsDescarregaEntrega;
    puntActual = entrega.coordenades;
  }

  return {
    valida: true,
    parades,
  };
}

function optimitzaRuta2Opt(ruta, context) {
  if (ruta.entregues.length < 4) return;
  let millorada = true;

  while (millorada) {
    millorada = false;
    for (let i = 0; i < ruta.entregues.length - 2; i += 1) {
      for (let k = i + 1; k < ruta.entregues.length - 1; k += 1) {
        const candidata = aplica2Opt(ruta.entregues, i, k);
        if (
          distanciaRuta(candidata, context.magatzem) < distanciaRuta(ruta.entregues, context.magatzem)
          && planificacioValidaPerSeq(candidata, context).valida
        ) {
          ruta.entregues = candidata;
          millorada = true;
        }
      }
    }
  }
}

function intentaOptimitzacioIncremental(ruta, context) {
  if (!ruta || !Array.isArray(ruta.entregues) || ruta.entregues.length < 4) return;

  const seqOriginal = [...ruta.entregues];
  optimitzaRuta2Opt(ruta, context);

  // Capa de seguretat: qualsevol optimitzacio incremental ha de mantenir franges.
  if (!teFinestresValides(ruta, context)) {
    ruta.entregues = seqOriginal;
  }
}

function creaRutaNova(entrega, context, index) {
  const volum = Number(entrega.volumTotal || 0);
  const camio = context.camionsDisponibles
    .filter((c) => Number(c.capacitatMaxima || 0) >= volum)
    .sort((a, b) => Number(a.capacitatMaxima || 0) - Number(b.capacitatMaxima || 0))[0];

  if (!camio) return null;

  const idxDisponible = context.camionsDisponibles.indexOf(camio);
  if (idxDisponible >= 0) {
    context.camionsDisponibles.splice(idxDisponible, 1);
  }

  return {
    camio: { id: camio.id ?? `camio-${index}`, capacitatMaxima: Number(camio.capacitatMaxima || 0) },
    entregues: [],
    volumOcupat: 0,
  };
}

function afegeixEntrega(ruta, entrega) {
  ruta.entregues.push(entrega);
  ruta.volumOcupat += Number(entrega.volumTotal || 0);
}

function desfesUltimaEntrega(ruta) {
  const eliminada = ruta.entregues.pop();
  ruta.volumOcupat -= Number(eliminada?.volumTotal || 0);
}

function eliminaEntrega(ruta, entrega) {
  const idx = ruta.entregues.indexOf(entrega);
  if (idx >= 0) {
    ruta.entregues.splice(idx, 1);
    ruta.volumOcupat -= Number(entrega.volumTotal || 0);
  }
}

function teCapacitatPer(ruta, entrega) {
  return ruta.volumOcupat + Number(entrega.volumTotal || 0) <= Number(ruta.camio.capacitatMaxima || 0);
}

function insereixEntregaMinimCost(ruta, entrega, context) {
  if (!teCapacitatPer(ruta, entrega)) return false;

  let millorPosicio = -1;
  let millorCost = Number.POSITIVE_INFINITY;

  for (let pos = 0; pos <= ruta.entregues.length; pos += 1) {
    const seqCandidata = [...ruta.entregues];
    seqCandidata.splice(pos, 0, entrega);

    if (!planificacioValidaPerSeq(seqCandidata, context).valida) continue;

    const cost = incrementDistanciaPerInsercio(ruta.entregues, entrega, pos, context.magatzem);
    if (cost < millorCost) {
      millorCost = cost;
      millorPosicio = pos;
    }
  }

  if (millorPosicio < 0) return false;

  ruta.entregues.splice(millorPosicio, 0, entrega);
  ruta.volumOcupat += Number(entrega.volumTotal || 0);
  return true;
}

function recalculaVolum(ruta) {
  ruta.volumOcupat = ruta.entregues.reduce((acc, e) => acc + Number(e.volumTotal || 0), 0);
}

function teFranjaMati(entrega) {
  const fi = horaATotalMinuts(entrega.horaFinal);
  return fi != null && fi <= MIGDIA_MINUTS;
}

function teFranjaTarda(entrega) {
  const inici = horaATotalMinuts(entrega.horaInici);
  return inici != null && inici >= MIGDIA_MINUTS;
}

function horaATotalMinuts(hora) {
  if (!hora || typeof hora !== 'string') return null;
  const [h, m] = hora.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function normalitzaAngle360(angle) {
  return ((angle % 360) + 360) % 360;
}

function incrementDistanciaPerInsercio(seqActual, entrega, pos, magatzem) {
  const anterior = pos === 0 ? magatzem : seqActual[pos - 1].coordenades;
  const seguent = pos === seqActual.length ? null : seqActual[pos].coordenades;

  if (!seguent) {
    return distanciaEuclidiana(anterior, entrega.coordenades);
  }

  return (
    distanciaEuclidiana(anterior, entrega.coordenades)
    + distanciaEuclidiana(entrega.coordenades, seguent)
    - distanciaEuclidiana(anterior, seguent)
  );
}

function tempsViatgeMinuts(origen, desti, velocitatKmH) {
  return (distanciaEuclidiana(origen, desti) / velocitatKmH) * 60;
}

function distanciaEuclidiana(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx ** 2 + dy ** 2);
}

function aplica2Opt(seq, i, k) {
  return [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
}

function distanciaRuta(entregues, magatzem) {
  let total = 0;
  let actual = magatzem;
  for (const entrega of entregues) {
    total += distanciaEuclidiana(actual, entrega.coordenades);
    actual = entrega.coordenades;
  }
  return total;
}

function planificacioValidaPerSeq(entregues, context) {
  const rutaTemp = { entregues };
  return calculaPlanificacioRuta(rutaTemp, context, 0);
}

function actualitzaEtasRutes(rutes, context) {
  for (const ruta of rutes) {
    const sortidaMinuts = calculaSortidaAproximada(ruta, context);
    const planificacio = calculaPlanificacioRuta(ruta, context, sortidaMinuts);
    ruta.esValidaFranges = planificacio.valida;
    ruta.sortidaMagatzemMinuts = sortidaMinuts;
    ruta.horaSortidaMagatzem = minutsAHhMm(sortidaMinuts);

    for (const parada of planificacio.parades) {
      const { entrega, arribadaMin, sortidaMin, tempsDescarregaEntrega } = parada;
      entrega.arribadaMinuts = arribadaMin;
      entrega.sortidaMinuts = sortidaMin;
      entrega.arribadaHora = minutsAHhMm(arribadaMin);
      entrega.sortidaHora = minutsAHhMm(sortidaMin);
      entrega.tempsDescarregaMinuts = tempsDescarregaEntrega;
    }

    if (ruta.entregues.length > 0 && planificacio.parades.length > 0) {
      const primeraEntrega = ruta.entregues[0];
      const tempsFinsPrimera = tempsViatgeMinuts(context.magatzem, primeraEntrega.coordenades, context.velocitatKmH);
      ruta.tempsMagatzemPrimeraEntregaMinuts = tempsFinsPrimera;

      const ultimaEntrega = ruta.entregues[ruta.entregues.length - 1];
      const ultimaParada = planificacio.parades[planificacio.parades.length - 1];
      const tempsRetorn = tempsViatgeMinuts(ultimaEntrega.coordenades, context.magatzem, context.velocitatKmH);
      const arribadaTornadaMinuts = ultimaParada.sortidaMin + tempsRetorn;
      ruta.tornadaMagatzemMinuts = arribadaTornadaMinuts;
      ruta.horaTornadaMagatzem = minutsAHhMm(arribadaTornadaMinuts);
    } else {
      ruta.tempsMagatzemPrimeraEntregaMinuts = 0;
      ruta.tornadaMagatzemMinuts = sortidaMinuts;
      ruta.horaTornadaMagatzem = minutsAHhMm(sortidaMinuts);
    }
  }
}

function calculaSortidaAproximada(ruta, context) {
  if (!ruta.entregues || ruta.entregues.length === 0) return 0;
  const primeraEntrega = ruta.entregues[0];
  const iniciPrimera = horaATotalMinuts(primeraEntrega.horaInici);
  if (iniciPrimera == null) return 0;

  const tempsFinsPrimera = tempsViatgeMinuts(context.magatzem, primeraEntrega.coordenades, context.velocitatKmH);
  const sortida = iniciPrimera - tempsFinsPrimera;
  return Math.max(0, sortida);
}

function minutsAHhMm(minutsTotals) {
  const minutsNormalitzats = Math.max(0, Math.round(minutsTotals));
  const h = Math.floor(minutsNormalitzats / 60);
  const m = minutsNormalitzats % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function calculaTempsDescarregaEntrega(entrega, context) {
  const caixes = calculaQuantitatCaixesEntrega(entrega);
  const tempsVariable = context.tempsBaseDescarregaMinuts + caixes * context.tempsPerCaixaMinuts;
  const fallback = context.tempsDescarregaMinuts;

  return Math.max(1, Number.isFinite(tempsVariable) ? tempsVariable : fallback);
}

function calculaQuantitatCaixesEntrega(entrega) {
  if (!Array.isArray(entrega?.pedidos)) return 0;

  return entrega.pedidos.reduce((acc, pedido) => {
    const q = Number(pedido?.quantitatCaixes ?? pedido?.quantitat ?? 0);
    return acc + (Number.isFinite(q) ? q : 0);
  }, 0);
}

async function geocodificaAdrecaOSM(adreca, fetchImpl) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', adreca);

  const response = await fetchImpl(url, { headers: { 'User-Agent': 'HackeMate/1.0' } });
  if (!response.ok) throw new Error(`Error geocodificant l'adreca (${response.status}).`);

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`No s'han trobat coordenades per a: ${adreca}`);
  }

  return { x: Number(resultats[0].lon), y: Number(resultats[0].lat) };
}

async function geocodificaAdrecaMockAsync(adreca) {
  await new Promise((resolve) => setTimeout(resolve, 5));

  let hash = 0;
  for (let i = 0; i < adreca.length; i += 1) {
    hash = (hash << 5) - hash + adreca.charCodeAt(i);
    hash |= 0;
  }

  return {
    x: 2 + ((Math.abs(hash) % 1000) / 1000) * 0.5,
    y: 41 + ((Math.abs(hash >> 3) % 1000) / 1000) * 0.5,
  };
}
