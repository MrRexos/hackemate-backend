import { Entrega as EntregaModel } from '../classes/entrega.model.js';
import { asseguraArray } from '../validators/logistica.validators.js';
import { construeixEntrega } from '../utils/entrega.utils.js';
import { fragmentaEntreguesSuperiorsACapacitatMaxCamio } from '../utils/fragmenta-entregues-capacitat.utils.js';
import { coordenadesPolarsRespecteCentre, normalitzaCoordenades, normalitzaPuntRuta } from '../utils/coordenades.utils.js';
import {
  volumCarregaMaximaOperativa,
  volumPermetAfegirACamio,
  volumSuperaLimitOperatiu,
} from '../constants/capacitat-camio.constants.js';
import { guardarResultatGenerarRutesJson } from './serialitza-resultat-rutes.js';

const MIGDIA_MINUTS = 14 * 60;
const TEMPS_SERVEI_MINUTS = 5;

/**
 * Instant final després de `minutsConduccio` minuts de conducció efectiva, sense circular dins
 * [pausaInici, pausaFi) (el vehicle espera fins a pausaFi si el trajecte toparia amb aquesta franja).
 */
function addMinutsConduccioAmbPausa(instantInici, minutsConduccio, context) {
  const d = Number(minutsConduccio) || 0;
  if (d <= 0) return instantInici;
  const p0 = context.pausaCirculacioIniciMinuts;
  const p1 = context.pausaCirculacioFiMinuts;
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 >= p1) {
    return instantInici + d;
  }
  let t = instantInici;
  let left = d;
  const eps = 1e-9;
  let guard = 0;
  while (left > eps && guard < 10000) {
    guard += 1;
    if (t >= p1 - eps) {
      t += left;
      left = 0;
      break;
    }
    if (t >= p0 - eps && t < p1) {
      t = p1;
      continue;
    }
    if (t < p0 - eps) {
      const finsPausa = p0 - t;
      if (left <= finsPausa + eps) {
        t += left;
        left = 0;
      } else {
        left -= finsPausa;
        t = p1;
      }
    } else {
      t += left;
      left = 0;
    }
  }
  return t;
}

/** Mode antic: tallar la conducció cada `maxConduccioContinuaMinuts` i inserir pauses obligatòries. */
function usaLlindarConduccioContinua(context) {
  if (context.conduccioContinuaDesactivada) return false;
  const m = Number(context.maxConduccioContinuaMinuts);
  return Number.isFinite(m) && m > 0;
}

/**
 * Temps sense conduir (espera finestra, descàrrega, pausa obligatòria): si dura prou, reinicia el comptador de conducció seguida (només mode llindar).
 */
function aplicarEsperaSenseConduccio(tempsActual, minutsEspera, context, estatConductor) {
  const w = Number(minutsEspera) || 0;
  if (w <= 0) return tempsActual;
  if (context.conduccioContinuaDesactivada) return tempsActual + w;
  const umbral =
    Number(context.minEsperaResetConduccioMinuts) > 0 ? Number(context.minEsperaResetConduccioMinuts) : 45;
  if (estatConductor && w >= umbral - 1e-9) estatConductor.conduccioAcumuladaDesDeDescans = 0;
  return tempsActual + w;
}

/**
 * Insereix `minutsConduccio` de conducció efectiva (amb pausa migdia). En mode llindar (`maxConduccioContinuaMinuts` finit),
 * es pausa `pausaObligatoriaConduccioMinuts` quan s’assoleix el límit acumulat. Sense llindar, només `addMinutsConduccioAmbPausa`.
 */
function avancaConduccioAmbLimitsConductor(t0, minutsConduccio, context, estatConductor) {
  const d = Number(minutsConduccio) || 0;
  if (d <= 0) return t0;
  if (context.conduccioContinuaDesactivada || !usaLlindarConduccioContinua(context)) {
    return addMinutsConduccioAmbPausa(t0, d, context);
  }
  const maxC = Number(context.maxConduccioContinuaMinuts);
  const pausaObl =
    Number(context.pausaObligatoriaConduccioMinuts) > 0 ? Number(context.pausaObligatoriaConduccioMinuts) : 45;
  const umbralReset =
    Number(context.minEsperaResetConduccioMinuts) > 0 ? Number(context.minEsperaResetConduccioMinuts) : 45;
  let t = t0;
  let left = d;
  const eps = 1e-9;
  while (left > eps) {
    if (estatConductor.conduccioAcumuladaDesDeDescans >= maxC - eps) {
      t = aplicarEsperaSenseConduccio(t, pausaObl, context, estatConductor);
      continue;
    }
    const room = maxC - estatConductor.conduccioAcumuladaDesDeDescans;
    const chunk = Math.min(left, room);
    const tBefore = t;
    t = addMinutsConduccioAmbPausa(tBefore, chunk, context);
    const esperaExtra = t - tBefore - chunk;
    if (esperaExtra >= umbralReset - eps) {
      estatConductor.conduccioAcumuladaDesDeDescans = chunk;
    } else {
      estatConductor.conduccioAcumuladaDesDeDescans += chunk;
    }
    left -= chunk;
    if (left > eps && estatConductor.conduccioAcumuladaDesDeDescans >= maxC - eps) {
      t = aplicarEsperaSenseConduccio(t, pausaObl, context, estatConductor);
    }
  }
  return t;
}

function marcaNoAssignada(entrega, codi) {
  entrega.motiuNoAssignacio = { codi };
}

/** Passades màximes fusionant rutes per alliberar un camió físic quan cal obrir ruta nova. */
const MAX_PASSADES_ALLIBERACIO_FLOTTA = 40;

/** Reservat per compatibilitat; no s’exposen textos explicatius del motiu. */
export function descripcioMotiuNoAssignacio(_entrega) {
  return '';
}

/** Distància geodèsica (km) magatzem ↔ punt; serveix per segmentar urbà / perifèria. */
function distanciaKmHaversine(a, b) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const lat1 = toR(Number(a.y));
  const lat2 = toR(Number(b.y));
  const dLat = lat2 - lat1;
  const dLon = toR(Number(b.x) - Number(a.x));
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

function diferenciaAngularGraus(a, b) {
  const d = Math.abs(Number(a) - Number(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Mateix «pètal» sectorial des del magatzem (diferència angular ≤ amplada). */
function mateixPetalAngles(angleA, angleB, ampladaGraus) {
  return diferenciaAngularGraus(angleA, angleB) <= ampladaGraus + 1e-9;
}

/** No barreja matí ↔ tarda quan ambdós tenen fase explícita. */
function mateixTorneigParella(e1, e2) {
  const a = e1.__fase;
  const b = e2.__fase;
  if ((a === 'mati' || a === 'tarda') && (b === 'mati' || b === 'tarda')) return a === b;
  return true;
}

/** Amplada angular per emparellar dues entregues (perifèric ↔ perifèric més tolerant). */
function ampladaPetalPerParella(entrega, alt, context) {
  if (entrega.__zona === 'periferica' && alt.__zona === 'periferica') {
    const w = Number(context.ampladaPetalPerifericaGraus);
    return Number.isFinite(w) && w > 0 ? w : 70;
  }
  const b = Number(context.ampladaPetalGraus) > 0 ? Number(context.ampladaPetalGraus) : 45;
  return b;
}

/** Amplada per bonificar inserció a ruta ja amb parades llunyanes (sector perifèric). */
function ampladaPetalBonusInsercio(entrega, etRuta, context) {
  const b = Number(context.ampladaPetalGraus) > 0 ? Number(context.ampladaPetalGraus) : 45;
  if (entrega.__zona === 'periferica' && (etRuta === 'periferica' || etRuta === 'mixta')) {
    const w = Number(context.ampladaPetalPerifericaGraus);
    return Number.isFinite(w) && w > 0 ? w : Math.max(b * 1.5, 70);
  }
  return b;
}

/**
 * Estalvi de km en combinar dues parades en una sola ruta (vs dos viatges magatzem→parada→magatzem).
 * Retorna `dosRoundTrips - millorTourObert` en Haversine (positiu = convé fusionar en km).
 */
function estalviKmCombinarDos(entrega1, entrega2, magatzem) {
  const dm1 = distanciaKmHaversine(magatzem, entrega1.coordenades);
  const dm2 = distanciaKmHaversine(magatzem, entrega2.coordenades);
  const d12 = distanciaKmHaversine(entrega1.coordenades, entrega2.coordenades);
  const dosRoundTrips = 2 * dm1 + 2 * dm2;
  const tourE1Primer = dm1 + d12 + dm2;
  const tourE2Primer = dm2 + d12 + dm1;
  const millorTour = Math.min(tourE1Primer, tourE2Primer);
  return dosRoundTrips - millorTour;
}

/**
 * Cerca una entrega encara no assignada al mateix pètal amb estalvi de km suficient i camió disponible.
 */
function trobarCompanyiaPetalAngles(entrega, entreguesOrdenades, context) {
  const minEst =
    context.minEstalviKmCombinacioParella != null && Number.isFinite(Number(context.minEstalviKmCombinacioParella))
      ? Number(context.minEstalviKmCombinacioParella)
      : 0;
  const magatzem = context.magatzem;

  let millor = null;
  let millorEst = -Infinity;
  let millorDiffAng = Infinity;

  for (const alt of entreguesOrdenades) {
    if (alt === entrega || alt.__assignada) continue;
    if (!mateixTorneigParella(entrega, alt)) continue;
    const amplada = ampladaPetalPerParella(entrega, alt, context);
    if (!mateixPetalAngles(entrega.angle, alt.angle, amplada)) continue;

    const dAng = diferenciaAngularGraus(entrega.angle, alt.angle);
    const est = estalviKmCombinarDos(entrega, alt, magatzem);
    if (est < minEst - 1e-6) continue;

    const volTot = Number(entrega.volumTotal || 0) + Number(alt.volumTotal || 0);
    const hiHaCamio = context.camionsDisponibles.some((c) => volumPermetAfegirACamio(0, volTot, c));
    if (!hiHaCamio) continue;

    const millorQueAnterior =
      millor == null
      || est > millorEst + 1e-6
      || (Math.abs(est - millorEst) <= 1e-6 && dAng < millorDiffAng - 1e-9);
    if (millorQueAnterior) {
      millorEst = est;
      millorDiffAng = dAng;
      millor = alt;
    }
  }
  return millor;
}

export async function geocodificarAdreces(entregues, options = {}) {
  const { usaMock = true, fetchImpl = fetch } = options;
  const llista = asseguraArray(entregues, 'entregues');
  const resultat = [];

  for (const entrega of llista) {
    if (normalitzaCoordenades(entrega.coordenades)) {
      resultat.push(entrega);
      continue;
    }

    const adreca = entrega.adreca;
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

/**
 * Planifica rutes amb cluster radi + angle, inserció amb llindar de km i fase de tornada.
 *
 * **Capacitat:** el volum per camió queda dins del límit operatiu (`FRACCIO_MAX_UTILITZACIO_CAPACITAT_CAMIO`, per defecte **93%** del nominal; assignació amb marge numèric estricte).
 *
 * Opcions rellevants:
 * - `radiUrbàKm` (per defecte 9): límit urbà / perifèria (Haversine des del magatzem).
 * - `llindarKmInsercio` (per defecte 5): increment marginal màx. (km) per afegir a una ruta mateixa zona o mixta.
 * - `llindarKmInsercioCreuat` (per defecte ~45% del llindar o 2,5 km): màx. increment quan es barregen urbà ↔ perifèrica.
 * - `reintentaIntegrarNoAssignades` (per defecte `true`): després de la revalidació, torna a provar les no assignades
 *   ignorant només el llindar de km; ordena les rutes candidates per **proximitat** (magatzem o parada més propera)
 *   i, si cal **capacitat** o **finestra**, pot **expulsar** una entrega (volum més petit primer) de la ruta propera
 *   i **reubicar-la** en una altra ruta vàlida.
 * - **Horari magatzem (per defecte):** sortida mínima 08:00 (`minSortidaMagatzemMinuts`), tornada màxima 20:00 (`maxTornadaMagatzemMinuts`).
 * - **Quota de parades per ruta (per defecte 15–30):** `minEntreguesPerRuta`, `maxEntreguesPerRuta` (nombre enter ≥ 1). Es bloqueja afegir parades quan la ruta arriba al màxim; després d’assignar sobrants es fusionen rutes per sota del mínim cap a altres si hi caben i la seqüència és vàlida (mateixa lògica de torn que la reintegració), per reduir camions. Valors ≤ 0 o no finits desactiven només aquell límit; desactiva tot el bloc amb `perQuotaParadesDesactivada: true`.
 * - **Pausa sense circulació (per defecte 13:00–15:00):** `pausaCirculacioIniciMinuts` / `pausaCirculacioFiMinuts`; desactiva amb `pausaCirculacioDesactivada: true`.
 * - **Pausa conductor:** per defecte **mode UE** (`maxConduccioContinuaMinuts` **270** = 4,5 h) amb pausa obligatòria (`pausaObligatoriaConduccioMinuts`, per defecte 45 min) i reinici del comptador si l’espera (descàrrega o pausa) arriba a `minEsperaResetConduccioMinuts`. Desactiva el llindar amb `conduccioContinuaDesactivada: true` o passant `maxConduccioContinuaMinuts: Infinity`. Sense llindar UE, la pausa fixa de **45 min** a mitja ruta (`pausaConductorFixaPerRutaMinuts`) torna a aplicar-se per defecte.
 * - **Finestra horària client:** per defecte **no** s’espera a `horaInici` (ni es retarda la sortida del magatzem per encaixar la primera finestra): el vehicle condueix seguit; les pauses obligatòries per límit de conducció segueixen aplicant-se. Per recuperar el comportament antic (esperar fins a l’inici de franja i calcular sortida del magatzem en conseqüència), passa `esperaFinsIniciFinestraClient: true`.
 * - **Entrega massa gran per a un camió (per defecte activa):** abans del sweep es parteixen entregues en diverses parades (mateixa adreça) repartint `pedidos` en bins ≤ capacitat màxima operativa de la flota (`fragmentaEntreguesMassaGransActiva`).
 *   Després de la planificació, una passada opcional **reubica parades** entre rutes si la suma Haversine global baixa (`milloraKmGlobalReubicacioActiva`).
 * - **Fusió per baixa utilització (per defecte activa):** rutes amb ús del camió &lt; **26%** del límit operatiu (`llindarUtilitatMinimaFusio`, per defecte `0.26`)
 *   intenten fusionar-se en una altra ruta si hi caben **volum**, **quota de parades** i **torns**; només s’aplica si la suma Haversine
 *   magatzem→…→magatzem **no augmenta** (es permet empatar però eliminar un camió). Desactiva amb `fusioBaixaUtilitatActiva: false`.
 * - **Consolidació per pètal (per defecte activa):** abans d’obrir una ruta nova amb una sola parada, es busca una altra entrega
 *   sense assignar amb angle compatible (`ampladaPetalGraus`, per defecte **45°**; entre dues parades **perifèriques** s’usa `ampladaPetalPerifericaGraus`, per defecte **max(1,5×45°, 70°)** per afavorir un sol camió llunyà). La companyia es tria prioritzant **més estalvi de km** (Haversine) i en empat angle més petit.
 *   (`minEstalviKmCombinacioParella`, per defecte **0** km). Es desactiva amb `prioritzacioPetalConsolidacio: false`.
 * - **`assignacioCompleta`:** si és `true`, es fan més voltes de reintegració sense llindar de km; una **passada final**
 *   ignora finestres de client i relaxa (opcionalment) la tornada màxima al magatzem. Només s’usen **camions de la flota**;
 *   si cal un vehicle addicional, es **fusionen** rutes compatibles per alliberar-ne un. Objectiu: reduir entregues sense assignar
 *   (pot generar rutes fora de franja). `relaxacioHorariMagatzemAssignacioCompleta` (per defecte relaxa tornada en aquesta passada).
 * - **Persistència JSON:** `guardarResultatJsonPath` (cadena): escriu el vector de `rutes` i `entreguesNoAssignades` en aquest fitxer al finalitzar.
 *   Si no s’indica, es fa servir `LOGISTICS_RUTES_OUTPUT_JSON` (variable d’entorn) quan estigui definida i no buida.
 *
 * **Doble torn (matí / tarda):** el mateix camió pot tenir **dues rutes** (un viatge matí i un altre tarda): entre fases es
 * tornen a posar tots els vehicles a `camionsDisponibles`, i no s’afegeixen parades de tarda a una ruta només de matí (i viceversa).
 * Després de calcular les ETA, es comprova que **cap camió físic** tingui dues rutes amb intervals [sortida magatzem, tornada magatzem] que es solapin;
 * si passa (p. ex. després de compactar o OSRM), es **reassigna** la ruta a un altre camió físic amb capacitat i finestra lliure;
 * si no n’hi ha cap, s’intenta **absorbir** la ruta dins una altra de la flota abans de deixar el conflicte sense resoldre.
 */
export async function generarRutes(llistaEntregues, flotaCamions, puntMagatzem, options = {}) {
  const entreguesInput = asseguraArray(llistaEntregues, 'llistaEntregues');
  const camions = asseguraArray(flotaCamions, 'flotaCamions');
  const magatzem = normalitzaPuntRuta(puntMagatzem, 'puntMagatzem');
  const fetchImplRoute = options.fetchImpl || fetch;
  const osrmBaseUrl = options.osrmBaseUrl || 'https://router.project-osrm.org';
  const optimIntraRutaCarrers = options.optimIntraRutaCarrers !== false;
  const velocitatKmH = Number(options.velocitatKmH) || 40;
  const tempsDescarregaMinuts = Number(options.tempsDescarregaMinuts) || TEMPS_SERVEI_MINUTS;
  const tempsBaseDescarregaMinuts = Number(options.tempsBaseDescarregaMinuts) || 5;
  const tempsPerCaixaMinuts = Number(options.tempsPerCaixaMinuts) || 0.5;
  const radiUrbàKm = Number(options.radiUrbàKm) > 0 ? Number(options.radiUrbàKm) : 9;
  const llindarKmInsercio = Number(options.llindarKmInsercio) > 0 ? Number(options.llindarKmInsercio) : 5;
  const llindarKmInsercioCreuat =
    Number(options.llindarKmInsercioCreuat) >= 0
      ? Number(options.llindarKmInsercioCreuat)
      : Math.min(2.5, llindarKmInsercio * 0.45);
  const ampladaPetalGraus =
    Number(options.ampladaPetalGraus) > 0 ? Number(options.ampladaPetalGraus) : 45;
  const ampladaPetalPerifericaGraus =
    Number(options.ampladaPetalPerifericaGraus) > 0
      ? Number(options.ampladaPetalPerifericaGraus)
      : Math.max(ampladaPetalGraus * 1.5, 70);
  const minEstalviKmCombinacioParella =
    options.minEstalviKmCombinacioParella != null && Number.isFinite(Number(options.minEstalviKmCombinacioParella))
      ? Number(options.minEstalviKmCombinacioParella)
      : 0;
  const prioritzacioPetalConsolidacio = options.prioritzacioPetalConsolidacio !== false;
  const fusioBaixaUtilitatActiva = options.fusioBaixaUtilitatActiva !== false;
  const llindarUtilitatMinimaFusio =
    Number(options.llindarUtilitatMinimaFusio) >= 0 && Number(options.llindarUtilitatMinimaFusio) <= 1
      ? Number(options.llindarUtilitatMinimaFusio)
      : 0.26;
  const fragmentaEntreguesMassaGransActiva = options.fragmentaEntreguesMassaGransActiva !== false;
  const milloraKmGlobalReubicacioActiva = options.milloraKmGlobalReubicacioActiva !== false;
  const EntregaClass = options.EntregaClass;
  const activarReintegreNoAssignades = options.reintentaIntegrarNoAssignades !== false;
  const assignacioCompleta = options.assignacioCompleta === true;

  const minSortidaMagatzemMinuts =
    options.minSortidaMagatzemMinuts != null ? Number(options.minSortidaMagatzemMinuts) : 8 * 60;
  const maxTornadaMagatzemMinuts =
    options.maxTornadaMagatzemMinuts != null ? Number(options.maxTornadaMagatzemMinuts) : 20 * 60;
  const pausaCirculacioDesactivada = options.pausaCirculacioDesactivada === true;
  const pausaCirculacioIniciMinuts = pausaCirculacioDesactivada
    ? NaN
    : options.pausaCirculacioIniciMinuts != null
      ? Number(options.pausaCirculacioIniciMinuts)
      : 13 * 60;
  const pausaCirculacioFiMinuts = pausaCirculacioDesactivada
    ? NaN
    : options.pausaCirculacioFiMinuts != null
      ? Number(options.pausaCirculacioFiMinuts)
      : 15 * 60;

  const conduccioContinuaDesactivada = options.conduccioContinuaDesactivada === true;
  let maxConduccioContinuaMinuts;
  if (conduccioContinuaDesactivada) {
    maxConduccioContinuaMinuts = Infinity;
  } else if (options.maxConduccioContinuaMinuts == null) {
    maxConduccioContinuaMinuts = 270;
  } else {
    const n = Number(options.maxConduccioContinuaMinuts);
    maxConduccioContinuaMinuts = Number.isFinite(n) && n > 0 ? n : Infinity;
  }
  const usaLlindar = !conduccioContinuaDesactivada && Number.isFinite(maxConduccioContinuaMinuts) && maxConduccioContinuaMinuts > 0;
  const pausaObligatoriaConduccioMinuts =
    options.pausaObligatoriaConduccioMinuts != null ? Number(options.pausaObligatoriaConduccioMinuts) : 45;
  const minEsperaResetConduccioMinuts =
    options.minEsperaResetConduccioMinuts != null ? Number(options.minEsperaResetConduccioMinuts) : 45;
  const pausaConductorFixaPerRutaMinuts = usaLlindar
    ? options.pausaConductorFixaPerRutaMinuts != null
      ? Number(options.pausaConductorFixaPerRutaMinuts)
      : 0
    : options.pausaConductorFixaPerRutaMinuts != null
      ? Number(options.pausaConductorFixaPerRutaMinuts)
      : 45;

  const perQuotaParadesDesactivada = options.perQuotaParadesDesactivada === true;
  const parseQuotaParades = (optVal, defaultVal) => {
    if (perQuotaParadesDesactivada) return null;
    if (optVal == null) return defaultVal;
    const n = Number(optVal);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  };
  /** Si és `true`, espera a `horaInici` quan s’arriba aviat i ajusta la sortida del magatzem; per defecte `false` (trajecte sense esperes per encaixar franja). */
  const esperaFinsIniciFinestraClient = options.esperaFinsIniciFinestraClient === true;

  let minEntreguesPerRuta = parseQuotaParades(options.minEntreguesPerRuta, 15);
  let maxEntreguesPerRuta = parseQuotaParades(options.maxEntreguesPerRuta, 30);
  if (
    minEntreguesPerRuta != null
    && maxEntreguesPerRuta != null
    && minEntreguesPerRuta > maxEntreguesPerRuta
  ) {
    const t = minEntreguesPerRuta;
    minEntreguesPerRuta = maxEntreguesPerRuta;
    maxEntreguesPerRuta = t;
  }

  const entreguesNormalitzades = EntregaClass
    ? entreguesInput.map((e) => construeixEntrega(e, EntregaClass))
    : entreguesInput;

  let entregues = await geocodificarAdreces(entreguesNormalitzades, options);
  const ClasseEntrega = EntregaClass ?? EntregaModel;
  if (fragmentaEntreguesMassaGransActiva !== false) {
    entregues = fragmentaEntreguesSuperiorsACapacitatMaxCamio(entregues, camions, ClasseEntrega);
  }

  const ambCluster = preprocessaClusterRadiAngle(entregues, magatzem, radiUrbàKm);

  const faseSenseFranja = ambCluster.filter((e) => !teFranjaMati(e) && !teFranjaTarda(e));
  const faseMati = ambCluster.filter((e) => teFranjaMati(e) || faseSenseFranja.includes(e));
  const faseTarda = ambCluster.filter((e) => teFranjaTarda(e) || faseSenseFranja.includes(e));

  const context = {
    camions,
    camionsDisponibles: [...camions],
    magatzem,
    velocitatKmH,
    tempsDescarregaMinuts,
    tempsBaseDescarregaMinuts,
    tempsPerCaixaMinuts,
    fetchImplRoute,
    osrmBaseUrl,
    radiUrbàKm,
    llindarKmInsercio,
    llindarKmInsercioCreuat,
    ampladaPetalGraus,
    ampladaPetalPerifericaGraus,
    minEstalviKmCombinacioParella,
    prioritzacioPetalConsolidacio,
    fusioBaixaUtilitatActiva,
    llindarUtilitatMinimaFusio,
    fragmentaEntreguesMassaGransActiva,
    milloraKmGlobalReubicacioActiva,
    minSortidaMagatzemMinuts,
    maxTornadaMagatzemMinuts,
    pausaCirculacioIniciMinuts,
    pausaCirculacioFiMinuts,
    conduccioContinuaDesactivada,
    maxConduccioContinuaMinuts,
    pausaObligatoriaConduccioMinuts,
    minEsperaResetConduccioMinuts,
    pausaConductorFixaPerRutaMinuts,
    minEntreguesPerRuta,
    maxEntreguesPerRuta,
    ignoreFinestresClient: false,
    esperaFinsIniciFinestraClient,
    assignacioCompletaActiva: false,
    assignacioCompletaOpcio: assignacioCompleta,
    relaxacioHorariMagatzemAssignacioCompleta: options.relaxacioHorariMagatzemAssignacioCompleta !== false,
  };
  const rutes = [];
  const entreguesNoAssignades = [];

  assignacioPerFaseCluster(
    ordreAssignacioClusterRadiAngle(faseMati),
    rutes,
    context,
    entreguesNoAssignades,
    'mati',
    { registrarNoAssignades: false },
  );

  context.camionsDisponibles = [...camions];

  assignacioPerFaseCluster(
    ordreAssignacioClusterRadiAngle(faseTarda),
    rutes,
    context,
    entreguesNoAssignades,
    'tarda',
    { registrarNoAssignades: false },
  );

  context.camionsDisponibles = [...camions];

  const fasePendent = ambCluster.filter((e) => !e.__assignada);
  insertaSobrantsTornadaPeriferia(fasePendent, rutes, context, entreguesNoAssignades);
  compactarRutesPerQuotaMin(rutes, context);

  for (const ruta of rutes) {
    optimitzaRuta2Opt(ruta, context);
  }

  if (optimIntraRutaCarrers) {
    await optimitzaRutesPerTempsOsrm(rutes, context);
  }

  revalidaFinestresDespuesOptimitzar(rutes, context, entreguesNoAssignades);

  if (activarReintegreNoAssignades && entreguesNoAssignades.length > 0) {
    const maxPassesReintegre = assignacioCompleta ? 6 : 1;
    for (let pass = 0; pass < maxPassesReintegre && entreguesNoAssignades.length > 0; pass += 1) {
      const reintegrades = await passadaReintegracioAmbOsrmIRevalida(
        entreguesNoAssignades,
        rutes,
        context,
        optimIntraRutaCarrers,
      );
      if (!reintegrades) break;
    }
  }

  if (assignacioCompleta && entreguesNoAssignades.length > 0) {
    const pendents = [...entreguesNoAssignades];
    entreguesNoAssignades.length = 0;
    for (const e of pendents) {
      delete e.motiuNoAssignacio;
      e.__assignada = false;
    }
    entreguesNoAssignades.push(...pendents);

    context.ignoreFinestresClient = true;
    context.assignacioCompletaActiva = true;
    context.ignorarLlindarCombustible = true;

    const maxPassesRelax = 8;
    for (let pass = 0; pass < maxPassesRelax && entreguesNoAssignades.length > 0; pass += 1) {
      const reint = await passadaReintegracioAmbOsrmIRevalida(
        entreguesNoAssignades,
        rutes,
        context,
        optimIntraRutaCarrers,
      );
      if (!reint) break;
    }

    context.ignoreFinestresClient = false;
    context.assignacioCompletaActiva = false;
    context.ignorarLlindarCombustible = false;
  }

  compactarRutesPerQuotaMin(rutes, context);

  corregirSobrecàrregaRutes(rutes, context, entreguesNoAssignades);

  if (context.fusioBaixaUtilitatActiva !== false) {
    compactarRutesPerBaixaUtilitatKm(rutes, context);
  }

  if (context.milloraKmGlobalReubicacioActiva !== false) {
    milloraGlobalKmReubicacioParades(rutes, context);
  }

  actualitzaEtasRutes(rutes, context);

  resoleSolapamentsTemporalCamions(rutes, context);

  /** Després de fusió / reubicació / canvi de vehicle per solapament: una passada final evita qualsevol excés residual. */
  corregirSobrecàrregaRutes(rutes, context, entreguesNoAssignades);

  /**
   * Compactació i correcció de volum poden deixar entregues fora sense tornar-les a provar;
   * es repeteix la reintegració + OSRM + revalidació (i, si cal, la passada relaxada d’assignació completa).
   */
  if (activarReintegreNoAssignades && entreguesNoAssignades.length > 0) {
    const maxFinal = assignacioCompleta ? 6 : 2;
    for (let pass = 0; pass < maxFinal && entreguesNoAssignades.length > 0; pass += 1) {
      const ok = await passadaReintegracioAmbOsrmIRevalida(
        entreguesNoAssignades,
        rutes,
        context,
        optimIntraRutaCarrers,
      );
      if (!ok) break;
    }
  }

  if (assignacioCompleta && entreguesNoAssignades.length > 0) {
    const pendentsFinal = [...entreguesNoAssignades];
    entreguesNoAssignades.length = 0;
    for (const e of pendentsFinal) {
      delete e.motiuNoAssignacio;
      e.__assignada = false;
    }
    entreguesNoAssignades.push(...pendentsFinal);

    context.ignoreFinestresClient = true;
    context.assignacioCompletaActiva = true;
    context.ignorarLlindarCombustible = true;

    for (let pass = 0; pass < 8 && entreguesNoAssignades.length > 0; pass += 1) {
      const ok = await passadaReintegracioAmbOsrmIRevalida(
        entreguesNoAssignades,
        rutes,
        context,
        optimIntraRutaCarrers,
      );
      if (!ok) break;
    }

    context.ignoreFinestresClient = false;
    context.assignacioCompletaActiva = false;
    context.ignorarLlindarCombustible = false;
  }

  const resultat = {
    rutes: rutes.filter((r) => r.entregues.length > 0),
    entreguesNoAssignades,
  };

  const pathGuardat =
    typeof options.guardarResultatJsonPath === 'string' && options.guardarResultatJsonPath.trim() !== ''
      ? options.guardarResultatJsonPath.trim()
      : typeof process.env.LOGISTICS_RUTES_OUTPUT_JSON === 'string' &&
          process.env.LOGISTICS_RUTES_OUTPUT_JSON.trim() !== ''
        ? process.env.LOGISTICS_RUTES_OUTPUT_JSON.trim()
        : null;

  if (pathGuardat) {
    await guardarResultatGenerarRutesJson(pathGuardat, resultat, magatzem, { font: 'generarRutes' });
  }

  return resultat;
}

function preprocessaClusterRadiAngle(entregues, magatzem, radiUrbàKm) {
  return entregues.map((entrega) => {
    const polar = coordenadesPolarsRespecteCentre(entrega.coordenades, magatzem);
    entrega.angle = normalitzaAngle360((polar.thetaRadians * 180) / Math.PI);
    entrega.__rKm = distanciaKmHaversine(magatzem, entrega.coordenades);
    entrega.__zona = entrega.__rKm <= radiUrbàKm ? 'urbana' : 'periferica';
    return entrega;
  });
}

/** Perifèria primer (consolidar “rutes llargues”), després urbà; dins de cada segment per angle. */
function ordreAssignacioClusterRadiAngle(entregues) {
  const perif = entregues.filter((e) => e.__zona === 'periferica').sort((a, b) => a.angle - b.angle);
  const urb = entregues.filter((e) => e.__zona === 'urbana').sort((a, b) => a.angle - b.angle);
  return [...perif, ...urb];
}

function rutaZonaEtiqueta(ruta, radiUrbàKm) {
  if (!ruta.entregues.length) return 'buida';
  let nUrb = 0;
  let nPer = 0;
  for (const e of ruta.entregues) {
    if (e.__zona === 'periferica') nPer += 1;
    else nUrb += 1;
  }
  if (nPer === 0) return 'urbana';
  if (nUrb === 0) return 'periferica';
  return 'mixta';
}

function mitjanaAngleRuta(ruta) {
  if (!ruta.entregues.length) return 0;
  return ruta.entregues.reduce((s, e) => s + e.angle, 0) / ruta.entregues.length;
}

/**
 * Llindar d’increment de distància euclidiana (km “plana” en graus, mateixa escala que la resta del tour).
 * Primera parada: sense bloquejar per llindar (el camió ha d’arribar al punt).
 */
function insercioRespectaLlindarCombustible(entrega, ruta, incrementKm, context) {
  if (!ruta.entregues.length) return true;
  if (context.ignorarLlindarCombustible) return true;

  const et = rutaZonaEtiqueta(ruta, context.radiUrbàKm);
  const llindarMateixa = context.llindarKmInsercio;
  const llindarCreuat = context.llindarKmInsercioCreuat;

  if (et === 'urbana' && entrega.__zona === 'periferica') {
    return incrementKm <= llindarCreuat;
  }
  if (et === 'periferica' && entrega.__zona === 'urbana') {
    return incrementKm <= llindarCreuat;
  }
  return incrementKm <= llindarMateixa;
}

function puntuacioRutaPerEntrega(ruta, entrega, context) {
  const et = rutaZonaEtiqueta(ruta, context.radiUrbàKm);
  let base = 0;
  if (et === 'buida') base = 1000;
  else if (entrega.__zona === 'periferica' && (et === 'periferica' || et === 'mixta')) base = 700;
  else if (entrega.__zona === 'urbana' && (et === 'urbana' || et === 'mixta')) base = 700;
  else if (et === 'urbana' && entrega.__zona === 'periferica') base = 80;
  else if (et === 'periferica' && entrega.__zona === 'urbana') base = 80;
  else base = 400;

  const ampladaBonus = ampladaPetalBonusInsercio(entrega, et, context);
  const diffAng = diferenciaAngularGraus(entrega.angle, mitjanaAngleRuta(ruta));
  let bonusPetal = 0;
  if (ruta.entregues.length > 0) {
    const reforçPerif =
      entrega.__zona === 'periferica' && (et === 'periferica' || et === 'mixta') ? 55 : 0;
    if (diffAng <= ampladaBonus * 0.5 + 1e-9) bonusPetal += 130 + reforçPerif;
    else if (diffAng <= ampladaBonus + 1e-9) bonusPetal += 65 + Math.round(reforçPerif / 2);
  }

  return base - diffAng / 12 + ruta.volumOcupat / 5000 + bonusPetal;
}

/** Amb límit de parades activat, encara hi ha lloc per una parada més sense superar el màxim. */
function potAfegirEntregaQuotaParades(ruta, context) {
  const maxP = context.maxEntreguesPerRuta;
  if (maxP == null || !(Number(maxP) > 0)) return true;
  return ruta.entregues.length < Number(maxP);
}

function millorInsercioAmbLlindar(ruta, entrega, context) {
  if (!potAfegirEntregaQuotaParades(ruta, context)) return null;
  let millor = null;
  for (let pos = 0; pos <= ruta.entregues.length; pos += 1) {
    const seqCandidata = [...ruta.entregues];
    seqCandidata.splice(pos, 0, entrega);
    if (!planificacioValidaPerSeq(seqCandidata, context).valida) continue;

    const incKm = incrementDistanciaKmPerInsercio(ruta.entregues, entrega, pos, context.magatzem);
    if (!insercioRespectaLlindarCombustible(entrega, ruta, incKm, context)) continue;

    if (millor == null || incKm < millor.incKm) {
      millor = { pos, incKm };
    }
  }
  return millor;
}

/** Una ruta de torn només pot barrejar parades del mateix torneig (matí o tarda), o estar buida. */
function rutaAdmetNouStopMateixTorneig(ruta, faseTorneig) {
  if (!ruta.entregues.length) return true;
  return ruta.entregues.every((e) => e.__fase === faseTorneig);
}

function assignacioPerFaseCluster(entreguesOrdenades, rutes, context, noAssignades, fase, options = {}) {
  const { registrarNoAssignades = true } = options;
  for (const entrega of entreguesOrdenades) {
    if (entrega.__assignada) continue;
    entrega.__fase = fase;

    const candidates = [...rutes]
      .filter(
        (ruta) =>
          teCapacitatPer(ruta, entrega)
          && rutaAdmetNouStopMateixTorneig(ruta, fase)
          && potAfegirEntregaQuotaParades(ruta, context),
      )
      .sort((a, b) => {
        const pb = puntuacioRutaPerEntrega(b, entrega, context);
        const pa = puntuacioRutaPerEntrega(a, entrega, context);
        if (pb !== pa) return pb - pa;
        return b.entregues.length - a.entregues.length;
      });

    let assignada = false;
    for (const ruta of candidates) {
      const millor = millorInsercioAmbLlindar(ruta, entrega, context);
      if (!millor) continue;

      ruta.entregues.splice(millor.pos, 0, entrega);
      ruta.volumOcupat += Number(entrega.volumTotal || 0);
      if (teFinestresValides(ruta, context)) {
        intentaOptimitzacioIncremental(ruta, context);
        entrega.__assignada = true;
        assignada = true;
        break;
      }
      eliminaEntrega(ruta, entrega);
    }

    if (assignada) continue;

    if (
      intentarNovaRutaAmbConsolidacioPetal(entrega, entreguesOrdenades, rutes, context, fase)
    ) {
      continue;
    }

    const novaRuta = creaRutaNovaAmbAlliberacioFlota(
      Number(entrega.volumTotal || 0),
      rutes,
      context,
      rutes.length + 1,
    );
    if (!novaRuta) {
      if (registrarNoAssignades) {
        marcaNoAssignada(entrega, 'CAPACITAT_FLOTA');
        noAssignades.push(entrega);
      }
      continue;
    }

    afegeixEntrega(novaRuta, entrega);
    if (teFinestresValides(novaRuta, context)) {
      intentaOptimitzacioIncremental(novaRuta, context);
      entrega.__assignada = true;
      rutes.push(novaRuta);
    } else {
      if (registrarNoAssignades) {
        marcaNoAssignada(entrega, 'FINESTRES_NOVA_RUTA');
        noAssignades.push(entrega);
      }
      desfesUltimaEntrega(novaRuta);
      desferRutaNovaBuida(novaRuta, context);
    }
  }
}

/** Distància mínima (km) entre l’entrega i el magatzem o qualsevol parada de la ruta. */
function distanciaMinimaRutaEntregaKm(ruta, entrega, magatzem) {
  let m = distanciaKmHaversine(magatzem, entrega.coordenades);
  for (const e of ruta.entregues) {
    m = Math.min(m, distanciaKmHaversine(e.coordenades, entrega.coordenades));
  }
  return m;
}

function rutesAmbParadesOrdenadesPerProximitat(rutes, entrega, magatzem) {
  return [...rutes]
    .filter((r) => r.entregues.length > 0)
    .sort((a, b) => {
      const da = distanciaMinimaRutaEntregaKm(a, entrega, magatzem);
      const db = distanciaMinimaRutaEntregaKm(b, entrega, magatzem);
      if (Math.abs(da - db) > 1e-6) return da - db;
      return b.entregues.length - a.entregues.length;
    });
}

function restauraEntregaARuta(ruta, entrega, posicio) {
  ruta.entregues.splice(posicio, 0, entrega);
  ruta.volumOcupat += Number(entrega.volumTotal || 0);
  entrega.__assignada = true;
}

/**
 * Intenta col·locar `entregaMobil` en una altra ruta (no `rutaExclosa`), ordre per proximitat a l’entrega.
 */
function intentaColLocarEnAltraRuta(entregaMobil, rutaExclosa, rutes, context, ctxRelax) {
  const f = entregaMobil.__fase;
  const candidates = rutes
    .filter((r) => {
      if (r === rutaExclosa || !teCapacitatPer(r, entregaMobil)) return false;
      if (!potAfegirEntregaQuotaParades(r, context)) return false;
      if (f === 'reintegre') return true;
      return rutaAdmetNouStopMateixTorneig(r, f);
    })
    .sort((a, b) => {
      const da = distanciaMinimaRutaEntregaKm(a, entregaMobil, context.magatzem);
      const db = distanciaMinimaRutaEntregaKm(b, entregaMobil, context.magatzem);
      if (Math.abs(da - db) > 1e-6) return da - db;
      return b.entregues.length - a.entregues.length;
    });

  for (const ruta of candidates) {
    const millor = millorInsercioAmbLlindar(ruta, entregaMobil, ctxRelax);
    if (!millor) continue;

    ruta.entregues.splice(millor.pos, 0, entregaMobil);
    ruta.volumOcupat += Number(entregaMobil.volumTotal || 0);
    if (teFinestresValides(ruta, context)) {
      intentaOptimitzacioIncremental(ruta, context);
      entregaMobil.__assignada = true;
      return true;
    }
    eliminaEntrega(ruta, entregaMobil);
  }
  return false;
}

/**
 * Treu una entrega de `rutaHost`, insereix `entregaU`, i reubica la treure cap a una altra ruta.
 * Provoca les expulsions per volum creixent (més fàcil d’encaixar altres bandes).
 */
function intentaIntegrarAmbExpulsio(entregaU, rutaHost, rutes, context, ctxRelax) {
  if (!rutaHost.entregues.length) return false;

  const ordreExpulsio = [...rutaHost.entregues].sort(
    (a, b) => Number(a.volumTotal || 0) - Number(b.volumTotal || 0),
  );

  for (const d of ordreExpulsio) {
    const idxOriginal = rutaHost.entregues.indexOf(d);
    if (idxOriginal < 0) continue;

    eliminaEntrega(rutaHost, d);
    d.__assignada = false;

    const millor = millorInsercioAmbLlindar(rutaHost, entregaU, ctxRelax);
    if (!millor) {
      restauraEntregaARuta(rutaHost, d, idxOriginal);
      continue;
    }

    rutaHost.entregues.splice(millor.pos, 0, entregaU);
    rutaHost.volumOcupat += Number(entregaU.volumTotal || 0);

    if (!teFinestresValides(rutaHost, context)) {
      eliminaEntrega(rutaHost, entregaU);
      restauraEntregaARuta(rutaHost, d, idxOriginal);
      continue;
    }

    if (intentaColLocarEnAltraRuta(d, rutaHost, rutes, context, ctxRelax)) {
      intentaOptimitzacioIncremental(rutaHost, context);
      entregaU.__assignada = true;
      delete entregaU.motiuNoAssignacio;
      return true;
    }

    eliminaEntrega(rutaHost, entregaU);
    restauraEntregaARuta(rutaHost, d, idxOriginal);
  }

  return false;
}

/**
 * Per reintegració: respecta torneig matí/tarda; sobrants i codi «reintegre» poden provar qualsevol ruta amb capacitat.
 * (La segona passada relaxa el llindar de km i pot reubicar parades.)
 */
function rutaCompatibleReintegracio(ruta, torneigOriginal) {
  if (!ruta.entregues.length) return true;
  if (torneigOriginal === 'resta' || torneigOriginal === 'reintegre') return true;
  return ruta.entregues.every((e) => e.__fase === torneigOriginal);
}

/** Fusiona `font` dins `dest` només si torns i volum ho permeten (`dest` no buida). */
function fusionDestPotAbsorbirFont(dest, font) {
  if (!font.entregues.length) return true;
  if (!dest.entregues.length) return false;
  for (const e of font.entregues) {
    if (!rutaCompatibleReintegracio(dest, e.__fase)) return false;
  }
  recalculaVolum(dest);
  recalculaVolum(font);
  return volumPermetAfegirACamio(dest.volumOcupat, font.volumOcupat, dest.camio);
}

/** Percentatge d’ús respecte al volum màxim operatiu del camió (0–100). */
function percentatgeUtilitatOperativaRuta(ruta) {
  const vol = Number(ruta.volumOcupat ?? 0);
  const capOp = volumCarregaMaximaOperativa(ruta.camio);
  if (!(capOp > 0)) return 100;
  return Math.min(100, (vol / capOp) * 100);
}

function potFusionQuotaParades(dest, font, context) {
  const maxP = context.maxEntreguesPerRuta;
  if (maxP == null || !(Number(maxP) > 0)) return true;
  return dest.entregues.length + font.entregues.length <= Number(maxP);
}

/**
 * Fusiona dues rutes (només camions de la flota) per alliberar un vehicle a `camionsDisponibles`, sense exigir llindar de km ni d’ús mínim.
 * @returns {boolean}
 */
function intentFusionarQualsevolRutaPerAlliberarCamio(rutes, context) {
  const fonts = [...rutes]
    .filter((r) => r.entregues.length > 0)
    .sort((a, b) => a.entregues.length - b.entregues.length);

  outer: for (const font of fonts) {
    if (!rutes.includes(font)) continue;

    const destins = rutes
      .filter(
        (d) =>
          d !== font
          && d.entregues.length > 0
          && fusionDestPotAbsorbirFont(d, font)
          && potFusionQuotaParades(d, font, context),
      )
      .sort((a, b) => b.entregues.length - a.entregues.length);

    for (const dest of destins) {
      const ordres = [
        [...dest.entregues, ...font.entregues],
        [...font.entregues, ...dest.entregues],
      ];
      for (const seq of ordres) {
        if (!planificacioValidaPerSeq(seq, context).valida) continue;
        const volFusio = dest.volumOcupat + font.volumOcupat;
        const rutaTemp = { camio: dest.camio, entregues: seq, volumOcupat: volFusio };
        if (!teFinestresValides(rutaTemp, context)) continue;

        dest.entregues = seq;
        recalculaVolum(dest);
        font.entregues = [];
        font.volumOcupat = 0;
        desferRutaNovaBuida(font, context);
        const ix = rutes.indexOf(font);
        if (ix >= 0) rutes.splice(ix, 1);
        intentaOptimitzacioIncremental(dest, context);
        return true;
      }
    }
  }
  return false;
}

/**
 * Absorbeix `rutaFont` dins una altra ruta (mateixes regles que fusió d’emergència). Útil quan dos torns usarien el mateix camió solapant-se.
 * @returns {boolean}
 */
function intentAbsorbirRutaEnAltra(rutaFont, rutes, context) {
  if (!rutaFont?.entregues?.length) return false;
  const destins = rutes
    .filter(
      (d) =>
        d !== rutaFont
        && d.entregues.length > 0
        && fusionDestPotAbsorbirFont(d, rutaFont)
        && potFusionQuotaParades(d, rutaFont, context),
    )
    .sort((a, b) => b.entregues.length - a.entregues.length);

  for (const dest of destins) {
    const ordres = [
      [...dest.entregues, ...rutaFont.entregues],
      [...rutaFont.entregues, ...dest.entregues],
    ];
    for (const seq of ordres) {
      if (!planificacioValidaPerSeq(seq, context).valida) continue;
      const volFusio = dest.volumOcupat + rutaFont.volumOcupat;
      const rutaTemp = { camio: dest.camio, entregues: seq, volumOcupat: volFusio };
      if (!teFinestresValides(rutaTemp, context)) continue;

      dest.entregues = seq;
      recalculaVolum(dest);
      rutaFont.entregues = [];
      rutaFont.volumOcupat = 0;
      desferRutaNovaBuida(rutaFont, context);
      const ix = rutes.indexOf(rutaFont);
      if (ix >= 0) rutes.splice(ix, 1);
      intentaOptimitzacioIncremental(dest, context);
      return true;
    }
  }
  return false;
}

/**
 * Fusiona rutes molt buides (&lt; llindar d’ús operatiu) en una altra si la distància Haversine total no puja.
 */
function compactarRutesPerBaixaUtilitatKm(rutes, context) {
  const magatzem = context.magatzem;
  const pctMin =
    Number(context.llindarUtilitatMinimaFusio) >= 0 && Number(context.llindarUtilitatMinimaFusio) <= 1
      ? Number(context.llindarUtilitatMinimaFusio) * 100
      : 26;

  let changed = true;
  while (changed) {
    changed = false;

    const fonts = rutes
      .filter((r) => r.entregues.length > 0 && percentatgeUtilitatOperativaRuta(r) < pctMin - 1e-9)
      .sort((a, b) => percentatgeUtilitatOperativaRuta(a) - percentatgeUtilitatOperativaRuta(b));

    outer: for (const font of fonts) {
      if (!rutes.includes(font) || !font.entregues.length) continue;

      const kmFont = distanciaObertaMesRetornKmHaversine(font.entregues, magatzem);

      const destins = rutes
        .filter(
          (d) =>
            d !== font
            && d.entregues.length > 0
            && fusionDestPotAbsorbirFont(d, font)
            && potFusionQuotaParades(d, font, context),
        )
        .sort((a, b) => percentatgeUtilitatOperativaRuta(b) - percentatgeUtilitatOperativaRuta(a));

      for (const dest of destins) {
        if (!rutes.includes(dest)) continue;
        const kmDest = distanciaObertaMesRetornKmHaversine(dest.entregues, magatzem);
        const kmAbans = kmDest + kmFont;

        const ordres = [
          [...dest.entregues, ...font.entregues],
          [...font.entregues, ...dest.entregues],
        ];

        for (const seq of ordres) {
          if (!planificacioValidaPerSeq(seq, context).valida) continue;

          const volFusio = dest.volumOcupat + font.volumOcupat;
          const rutaTemp = { camio: dest.camio, entregues: seq, volumOcupat: volFusio };
          if (!teFinestresValides(rutaTemp, context)) continue;

          const kmDespres = distanciaObertaMesRetornKmHaversine(seq, magatzem);
          if (kmDespres > kmAbans + 1e-6) continue;

          dest.entregues = seq;
          recalculaVolum(dest);
          font.entregues = [];
          font.volumOcupat = 0;
          desferRutaNovaBuida(font, context);
          const ix = rutes.indexOf(font);
          if (ix >= 0) rutes.splice(ix, 1);
          intentaOptimitzacioIncremental(dest, context);
          changed = true;
          break outer;
        }
      }
    }
  }
}

/**
 * Reubica una parada d’una ruta a una altra si la **suma** de km Haversine (tots els viatges) baixa
 * i es respecten capacitat, quota, torns i finestres.
 */
function milloraGlobalKmReubicacioParades(rutes, context) {
  if (context.milloraKmGlobalReubicacioActiva === false) return;
  const magatzem = context.magatzem;
  const ctxRelax = { ...context, ignorarLlindarCombustible: true };
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    let millorDelta = Infinity;
    /** @type {{ si: number, dj: number, ei: number, pos: number, entrega: object }|null} */
    let millor = null;

    for (let si = 0; si < rutes.length; si += 1) {
      const rs = rutes[si];
      if (!rs.entregues?.length) continue;

      for (let ei = 0; ei < rs.entregues.length; ei += 1) {
        const entrega = rs.entregues[ei];

        for (let dj = 0; dj < rutes.length; dj += 1) {
          if (dj === si) continue;
          const rd = rutes[dj];

          if (!rutaCompatibleReintegracio(rd, entrega.__fase)) continue;
          if (!teCapacitatPer(rd, entrega)) continue;
          if (!potAfegirEntregaQuotaParades(rd, context)) continue;

          const seqSource = [...rs.entregues];
          seqSource.splice(ei, 1);

          const ins = millorInsercioAmbLlindar(rd, entrega, ctxRelax);
          if (!ins) continue;

          const seqDest = [...rd.entregues];
          seqDest.splice(ins.pos, 0, entrega);

          if (seqSource.length && !planificacioValidaPerSeq(seqSource, context).valida) continue;
          if (!planificacioValidaPerSeq(seqDest, context).valida) continue;

          const vS = seqSource.reduce((a, e) => a + Number(e.volumTotal || 0), 0);
          const vD = seqDest.reduce((a, e) => a + Number(e.volumTotal || 0), 0);
          const rSourceTemp =
            seqSource.length > 0
              ? { camio: rs.camio, entregues: seqSource, volumOcupat: vS }
              : null;
          const rDestTemp = { camio: rd.camio, entregues: seqDest, volumOcupat: vD };

          if (rSourceTemp && !teFinestresValides(rSourceTemp, context)) continue;
          if (!teFinestresValides(rDestTemp, context)) continue;

          const kmSourceVell = distanciaObertaMesRetornKmHaversine(rs.entregues, magatzem);
          const kmDestVell = distanciaObertaMesRetornKmHaversine(rd.entregues, magatzem);
          const kmSourceNou = seqSource.length
            ? distanciaObertaMesRetornKmHaversine(seqSource, magatzem)
            : 0;
          const kmDestNou = distanciaObertaMesRetornKmHaversine(seqDest, magatzem);

          const kmAbans = kmSourceVell + kmDestVell;
          const kmDespres = kmSourceNou + kmDestNou;
          const delta = kmDespres - kmAbans;

          if (delta < millorDelta - 1e-9) {
            millorDelta = delta;
            millor = { si, dj, ei, pos: ins.pos, entrega };
          }
        }
      }
    }

    if (!millor || millorDelta >= -1e-9) break;

    const rs = rutes[millor.si];
    const rd = rutes[millor.dj];
    const entrega = millor.entrega;

    eliminaEntrega(rs, entrega);
    rd.entregues.splice(millor.pos, 0, entrega);
    recalculaVolum(rs);
    recalculaVolum(rd);

    if (!rs.entregues.length) {
      desferRutaNovaBuida(rs, context);
      const ix = rutes.indexOf(rs);
      if (ix >= 0) rutes.splice(ix, 1);
    }

    intentaOptimitzacioIncremental(rd, context);
    if (rs.entregues?.length) intentaOptimitzacioIncremental(rs, context);
  }
}

/**
 * Redueix el nombre de camions fusionant rutes amb menys parades que el mínim cap a rutes amb més parades
 * (fins al màxim permès), si la seqüència concatenada (final o invertida) és vàlida.
 */
function compactarRutesPerQuotaMin(rutes, context) {
  const minP = context.minEntreguesPerRuta;
  const maxP = context.maxEntreguesPerRuta;
  if (minP == null || !(Number(minP) > 0) || maxP == null || !(Number(maxP) > 0)) return;

  const minN = Number(minP);
  const maxN = Number(maxP);

  let changed = true;
  while (changed) {
    changed = false;
    const petites = rutes
      .filter((r) => r.entregues.length > 0 && r.entregues.length < minN)
      .sort((a, b) => a.entregues.length - b.entregues.length);

    outer: for (const font of petites) {
      if (!font.entregues.length) continue;
      const n = font.entregues.length;

      const destins = rutes
        .filter(
          (d) =>
            d !== font
            && d.entregues.length > 0
            && d.entregues.length + n <= maxN
            && fusionDestPotAbsorbirFont(d, font),
        )
        .sort((a, b) => b.entregues.length - a.entregues.length);

      for (const dest of destins) {
        const ordres = [
          [...dest.entregues, ...font.entregues],
          [...font.entregues, ...dest.entregues],
        ];
        for (const seq of ordres) {
          if (!planificacioValidaPerSeq(seq, context).valida) continue;
          dest.entregues = seq;
          recalculaVolum(dest);
          font.entregues = [];
          font.volumOcupat = 0;
          desferRutaNovaBuida(font, context);
          const ix = rutes.indexOf(font);
          if (ix >= 0) rutes.splice(ix, 1);
          intentaOptimitzacioIncremental(dest, context);
          changed = true;
          break outer;
        }
      }
    }
  }
}

function reintentaIntegrarNoAssignades(noAssignades, rutes, context) {
  if (!noAssignades.length) return false;

  const ctxRelax = { ...context, ignorarLlindarCombustible: true };
  const pendents = [...noAssignades];
  noAssignades.length = 0;
  let algunaReintegrada = false;

  for (const entrega of pendents) {
    const torneigOriginal = entrega.__fase;
    entrega.__assignada = false;

    const perProximitat = rutesAmbParadesOrdenadesPerProximitat(rutes, entrega, context.magatzem).filter(
      (r) =>
        rutaCompatibleReintegracio(r, torneigOriginal) && potAfegirEntregaQuotaParades(r, ctxRelax),
    );

    let assignada = false;
    for (const ruta of perProximitat) {
      const teCap = teCapacitatPer(ruta, entrega);

      if (teCap) {
        const millor = millorInsercioAmbLlindar(ruta, entrega, ctxRelax);
        if (millor) {
          ruta.entregues.splice(millor.pos, 0, entrega);
          ruta.volumOcupat += Number(entrega.volumTotal || 0);
          if (teFinestresValides(ruta, context)) {
            intentaOptimitzacioIncremental(ruta, context);
            entrega.__assignada = true;
            delete entrega.motiuNoAssignacio;
            assignada = true;
            algunaReintegrada = true;
            break;
          }
          eliminaEntrega(ruta, entrega);
        }
      }

      if (
        !assignada
        && rutaCompatibleReintegracio(ruta, torneigOriginal)
        && intentaIntegrarAmbExpulsio(entrega, ruta, rutes, context, ctxRelax)
      ) {
        assignada = true;
        algunaReintegrada = true;
        delete entrega.motiuNoAssignacio;
        break;
      }
    }

    if (assignada) continue;

    const faseParella =
      torneigOriginal === 'mati' || torneigOriginal === 'tarda' || torneigOriginal === 'resta'
        ? torneigOriginal
        : 'reintegre';
    if (intentarNovaRutaAmbConsolidacioPetal(entrega, pendents, rutes, context, faseParella)) {
      algunaReintegrada = true;
      continue;
    }

    const novaRuta = creaRutaNovaAmbAlliberacioFlota(
      Number(entrega.volumTotal || 0),
      rutes,
      context,
      rutes.length + 1,
    );
    if (!novaRuta) {
      entrega.__fase = 'reintegre';
      marcaNoAssignada(entrega, 'CAPACITAT_FLOTA');
      noAssignades.push(entrega);
      continue;
    }

    afegeixEntrega(novaRuta, entrega);
    if (teFinestresValides(novaRuta, context)) {
      intentaOptimitzacioIncremental(novaRuta, context);
      entrega.__assignada = true;
      delete entrega.motiuNoAssignacio;
      rutes.push(novaRuta);
      algunaReintegrada = true;
    } else {
      entrega.__fase = 'reintegre';
      marcaNoAssignada(entrega, 'REINTEGRE_SENSE_SOLUCIO');
      noAssignades.push(entrega);
      desfesUltimaEntrega(novaRuta);
      desferRutaNovaBuida(novaRuta, context);
    }
  }

  return algunaReintegrada;
}

/**
 * Una passada de reintegració de la llista `noAssignades`, recàlcul OSRM de rutes tocades i revalidació de finestres.
 * @returns {Promise<boolean>}
 */
async function passadaReintegracioAmbOsrmIRevalida(noAssignades, rutes, context, optimIntraRutaCarrers) {
  const reintegrades = reintentaIntegrarNoAssignades(noAssignades, rutes, context);
  if (reintegrades && optimIntraRutaCarrers) {
    await optimitzaRutesPerTempsOsrm(rutes, context);
  }
  if (reintegrades) {
    revalidaFinestresDespuesOptimitzar(rutes, context, noAssignades);
  }
  return reintegrades;
}

function insertaSobrantsTornadaPeriferia(entregues, rutes, context, noAssignades) {
  const rutesOrdenades = [...rutes].sort((a, b) => {
    const ra = Math.max(0, ...a.entregues.map((e) => e.__rKm || 0));
    const rb = Math.max(0, ...b.entregues.map((e) => e.__rKm || 0));
    return rb - ra;
  });

  const pendents = ordreAssignacioClusterRadiAngle(entregues);

  for (const entrega of pendents) {
    entrega.__fase = 'resta';

    let millorGlobal = null;
    for (const ruta of rutesOrdenades) {
      if (!teCapacitatPer(ruta, entrega) || !potAfegirEntregaQuotaParades(ruta, context)) continue;

      for (let pos = 0; pos <= ruta.entregues.length; pos += 1) {
        const seq = [...ruta.entregues];
        seq.splice(pos, 0, entrega);
        if (!planificacioValidaPerSeq(seq, context).valida) continue;

        const inc = incrementDistanciaKmPerInsercio(ruta.entregues, entrega, pos, context.magatzem);
        const abans = distanciaObertaMesRetornKmHaversine(ruta.entregues, context.magatzem);
        const despres = distanciaObertaMesRetornKmHaversine(seq, context.magatzem);
        const deltaTotal = despres - abans;

        const relaxat = context.llindarKmInsercio * 1.35;
        if (!insercioRespectaLlindarCombustible(entrega, ruta, inc, context) && deltaTotal > relaxat) {
          continue;
        }

        const millorDelta =
          millorGlobal == null
          || deltaTotal < millorGlobal.deltaTotal
          || (Math.abs(deltaTotal - millorGlobal.deltaTotal) < 1e-9
            && ruta.entregues.length > millorGlobal.ruta.entregues.length);
        if (millorDelta) {
          millorGlobal = { ruta, pos, deltaTotal };
        }
      }
    }

    if (millorGlobal) {
      millorGlobal.ruta.entregues.splice(millorGlobal.pos, 0, entrega);
      millorGlobal.ruta.volumOcupat += Number(entrega.volumTotal || 0);
      intentaOptimitzacioIncremental(millorGlobal.ruta, context);
      entrega.__assignada = true;
      continue;
    }

    if (intentarNovaRutaAmbConsolidacioPetal(entrega, pendents, rutes, context, 'resta')) {
      continue;
    }

    const novaRuta = creaRutaNovaAmbAlliberacioFlota(
      Number(entrega.volumTotal || 0),
      rutes,
      context,
      rutes.length + 1,
    );
    if (!novaRuta) {
      marcaNoAssignada(entrega, 'CAPACITAT_FLOTA');
      noAssignades.push(entrega);
      continue;
    }

    afegeixEntrega(novaRuta, entrega);
    if (teFinestresValides(novaRuta, context)) {
      intentaOptimitzacioIncremental(novaRuta, context);
      entrega.__assignada = true;
      rutes.push(novaRuta);
    } else {
      marcaNoAssignada(entrega, 'FINESTRES_NOVA_RUTA');
      noAssignades.push(entrega);
      desfesUltimaEntrega(novaRuta);
      desferRutaNovaBuida(novaRuta, context);
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
      marcaNoAssignada(entrega, 'REVALIDACIO_EXPELLIDA_SOBRANT');
      noAssignades.push(entrega);
      if (teFinestresValides(ruta, context)) break;
    }

    if (!teFinestresValides(ruta, context)) {
      while (!teFinestresValides(ruta, context) && ruta.entregues.length > 0) {
        const entregaExpulsada = ruta.entregues.pop();
        entregaExpulsada.__assignada = false;
        marcaNoAssignada(entregaExpulsada, 'REVALIDACIO_EXPELLIDA_PARADA');
        noAssignades.push(entregaExpulsada);
        recalculaVolum(ruta);
      }
    }
  }
}

function tempsSortidaMinimaPerValidacio(context) {
  return Number.isFinite(context.minSortidaMagatzemMinuts) ? context.minSortidaMagatzemMinuts : 0;
}

function teFinestresValides(ruta, context) {
  return calculaPlanificacioRuta(ruta, context, tempsSortidaMinimaPerValidacio(context)).valida;
}

function calculaPlanificacioRuta(ruta, context, tempsSortidaMin = 0) {
  const minSort = Number.isFinite(context.minSortidaMagatzemMinuts) ? context.minSortidaMagatzemMinuts : 0;
  let tempsActual = Math.max(0, Number(tempsSortidaMin) || 0, minSort);
  const parades = [];
  let entregaAnterior = null;
  const estatConductor = usaLlindarConduccioContinua(context) ? { conduccioAcumuladaDesDeDescans: 0 } : null;
  const pausaFixa =
    !context.conduccioContinuaDesactivada && Number(context.pausaConductorFixaPerRutaMinuts) > 0
      ? Number(context.pausaConductorFixaPerRutaMinuts)
      : 0;

  for (let idx = 0; idx < ruta.entregues.length; idx += 1) {
    const entrega = ruta.entregues[idx];
    if (pausaFixa > 0 && ruta.entregues.length >= 2 && idx === Math.ceil(ruta.entregues.length / 2)) {
      tempsActual += pausaFixa;
    }

    const viatge = tempsViagemOrdreIntern(ruta, entregaAnterior, entrega, context);
    tempsActual = avancaConduccioAmbLimitsConductor(tempsActual, viatge, context, estatConductor);
    const arribadaSenseEspera = tempsActual;

    const inici = horaATotalMinuts(entrega.horaInici);
    const fi = horaATotalMinuts(entrega.horaFinal);

    if (context.esperaFinsIniciFinestraClient && inici != null && tempsActual < inici) {
      const esperaFinestra = inici - tempsActual;
      tempsActual = aplicarEsperaSenseConduccio(tempsActual, esperaFinestra, context, estatConductor);
    }

    if (fi != null && tempsActual > fi && !context.ignoreFinestresClient) {
      return {
        valida: false,
        parades,
      };
    }

    const arribadaMin = tempsActual;
    const tempsDescarregaEntrega = calculaTempsDescarregaEntrega(entrega, context);
    tempsActual = aplicarEsperaSenseConduccio(arribadaMin, tempsDescarregaEntrega, context, estatConductor);
    const sortidaMin = tempsActual;
    parades.push({
      entrega,
      arribadaMin,
      sortidaMin,
      tempsDescarregaEntrega,
      esperaMin: Math.max(0, arribadaMin - arribadaSenseEspera),
    });

    entregaAnterior = entrega;
  }

  if (ruta.entregues.length > 0) {
    const ultimaEntrega = ruta.entregues[ruta.entregues.length - 1];
    let puntSortidaRetorn = parades[parades.length - 1].sortidaMin;
    if (pausaFixa > 0 && ruta.entregues.length === 1) {
      puntSortidaRetorn += pausaFixa;
    }
    const retorn = tempsViatgeUltimaMateDepotIntern(ruta, ultimaEntrega, context);
    const tornadaMagatzemMinuts = avancaConduccioAmbLimitsConductor(
      puntSortidaRetorn,
      retorn,
      context,
      estatConductor,
    );
    const maxT = context.maxTornadaMagatzemMinuts;
    const relaxTornadaPassada =
      context.assignacioCompletaActiva === true && context.relaxacioHorariMagatzemAssignacioCompleta !== false;
    if (Number.isFinite(maxT) && !relaxTornadaPassada && tornadaMagatzemMinuts > maxT + 1e-6) {
      return {
        valida: false,
        parades,
      };
    }
    return {
      valida: true,
      parades,
      tornadaMagatzemMinuts,
    };
  }

  return {
    valida: true,
    parades,
  };
}

function tempsViagemOrdreIntern(ruta, entregaAnterior, entregaFi, context) {
  const matDurSec = ruta._matDurSec;
  const idxMap = ruta._idxOsrmPerEntrega;
  if (matDurSec && Array.isArray(matDurSec) && idxMap instanceof Map && idxMap.has(entregaFi)) {
    const i = entregaAnterior == null ? 0 : idxMap.get(entregaAnterior);
    const j = idxMap.get(entregaFi);
    if (
      Number.isFinite(i)
      && Number.isFinite(j)
      && matDurSec[i]
      && Number.isFinite(matDurSec[i][j])
    ) {
      return matDurSec[i][j] / 60;
    }
  }

  const orig = entregaAnterior == null ? context.magatzem : entregaAnterior.coordenades;
  return tempsViatgeMinuts(orig, entregaFi.coordenades, context.velocitatKmH);
}

function tempsViatgeUltimaMateDepotIntern(ruta, ultimaEntrega, context) {
  const matDurSec = ruta._matDurSec;
  const idxMap = ruta._idxOsrmPerEntrega;
  if (
    ultimaEntrega
    && matDurSec
    && idxMap instanceof Map
    && idxMap.has(ultimaEntrega)
  ) {
    const i = idxMap.get(ultimaEntrega);
    const sec = matDurSec[i]?.[0];
    if (Number.isFinite(sec)) return sec / 60;
  }
  return tempsViatgeMinuts(ultimaEntrega.coordenades, context.magatzem, context.velocitatKmH);
}

function tempsConduccioObertTotalsMinuts(entreguesSeq, context, wrapperMatOrNull = null) {
  if (!entreguesSeq || entreguesSeq.length === 0) return 0;
  const rAug = wrapperMatOrNull
    ? { entregues: entreguesSeq, _matDurSec: wrapperMatOrNull._matDurSec, _idxOsrmPerEntrega: wrapperMatOrNull._idxOsrmPerEntrega }
    : { entregues: entreguesSeq };

  let t = tempsViagemOrdreIntern(rAug, null, entreguesSeq[0], context);
  for (let k = 1; k < entreguesSeq.length; k += 1) {
    t += tempsViagemOrdreIntern(rAug, entreguesSeq[k - 1], entreguesSeq[k], context);
  }
  return t;
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

function optimitzaRuta2OptPerCarrers(ruta, context) {
  if (!ruta._matDurSec || ruta.entregues.length < 3) return;
  const wrapper = {
    entregues: ruta.entregues,
    _matDurSec: ruta._matDurSec,
    _idxOsrmPerEntrega: ruta._idxOsrmPerEntrega,
  };

  let millorada = true;
  while (millorada) {
    millorada = false;
    for (let i = 0; i < ruta.entregues.length - 2; i += 1) {
      for (let k = i + 1; k < ruta.entregues.length - 1; k += 1) {
        const candidata = aplica2Opt(ruta.entregues, i, k);
        const costActual = tempsConduccioObertTotalsMinuts(ruta.entregues, context, wrapper);
        const costNou = tempsConduccioObertTotalsMinuts(candidata, context, wrapper);
        if (
          costNou < costActual
          && planificacioValidaPerSeqAmbMatriu(candidata, context, wrapper).valida
        ) {
          ruta.entregues = candidata;
          wrapper.entregues = candidata;
          millorada = true;
        }
      }
    }
  }
}

function planificacioValidaPerSeqAmbMatriu(entreguesSeq, context, wrapperMatriu) {
  const tmp = {
    entregues: entreguesSeq,
    _matDurSec: wrapperMatriu._matDurSec,
    _idxOsrmPerEntrega: wrapperMatriu._idxOsrmPerEntrega,
  };
  return calculaPlanificacioRuta(tmp, context, tempsSortidaMinimaPerValidacio(context));
}

async function optimitzaRutesPerTempsOsrm(rutes, context) {
  const { fetchImplRoute, osrmBaseUrl } = context;
  await Promise.all(
    rutes.map(async (ruta) => {
      if (!ruta.entregues || ruta.entregues.length < 2) return;
      try {
        const constr = await construeixMatriuDuradaRutaOsrm(ruta.entregues, context.magatzem, fetchImplRoute, osrmBaseUrl);
        if (!constr) return;

        Object.assign(ruta, constr);

        const original = [...ruta.entregues];
        optimitzaRuta2OptPerCarrers(ruta, context);

        if (!planificacioValidaPerSeqAmbMatriu(ruta.entregues, context, constr).valida) {
          ruta.entregues = original;
        } else if (ruta._matDistMetres && ruta._idxOsrmPerEntrega) {
          const km = sumaKmConduccioObertDesDeMatriu(ruta.entregues, ruta._idxOsrmPerEntrega, ruta._matDistMetres);
          ruta._kmsConduccioObertaPerCarrers = km != null ? Number(km.toFixed(2)) : null;
        }
      } catch {
        delete ruta._matDurSec;
        delete ruta._matDistMetres;
        delete ruta._idxOsrmPerEntrega;
        delete ruta._kmsConduccioObertaPerCarrers;
      }
    }),
  );
}

async function construeixMatriuDuradaRutaOsrm(entregues, magatzem, fetchImpl, osrmBaseUrl) {
  if (!Array.isArray(entregues) || entregues.length === 0) return null;

  const puntscoords = [{ x: magatzem.x, y: magatzem.y }];
  entregues.forEach((e) => puntscoords.push(e.coordenades));

  const coordStr = puntscoords.map((p) => `${p.x},${p.y}`).join(';');
  const base = String(osrmBaseUrl || '').replace(/\/+$/, '');
  const url = new URL(`${base}/table/v1/driving/${coordStr}`);
  url.searchParams.set('annotations', 'duration,distance');

  const response = await fetchImpl(url.toString());
  if (!response.ok) return null;

  const data = await response.json();
  const durSec = data?.durations;
  const distMetres = data?.distances;
  if (!Array.isArray(durSec) || !durSec.every((row) => Array.isArray(row))) return null;

  const idxOsrmPerEntrega = new Map();
  entregues.forEach((entrega, idx) => {
    idxOsrmPerEntrega.set(entrega, idx + 1);
  });

  const kmObert = sumaKmConduccioObertDesDeMatriu(entregues, idxOsrmPerEntrega, distMetres);
  const kmDisplay = kmObert != null ? Number(kmObert.toFixed(2)) : null;

  return {
    _matDurSec: durSec,
    _matDistMetres: Array.isArray(distMetres) && distMetres.every((row) => Array.isArray(row)) ? distMetres : null,
    _idxOsrmPerEntrega: idxOsrmPerEntrega,
    _kmsConduccioObertaPerCarrers: kmDisplay,
  };
}

/** Suma km reals (OSRM) del tour obert magatzem -> ... -> ultima para (sense tornada). */
function sumaKmConduccioObertDesDeMatriu(entreguesOrdered, idxMap, distMat) {
  if (
    !Array.isArray(entreguesOrdered)
    || entreguesOrdered.length === 0
    || !(idxMap instanceof Map)
    || !Array.isArray(distMat)
    || !distMat.every((row) => Array.isArray(row))
  ) {
    return null;
  }
  let prevIdx = 0;
  let metres = 0;
  for (const entrega of entreguesOrdered) {
    const idx = idxMap.get(entrega);
    if (!Number.isFinite(idx)) return null;
    const raw = distMat[prevIdx]?.[idx];
    const dm = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(dm)) return null;
    metres += dm;
    prevIdx = idx;
  }
  return metres / 1000;
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

function creaRutaNovaAmbVolumMinim(volumCarrega, context, index) {
  const volum = Number(volumCarrega) || 0;
  const camio = context.camionsDisponibles
    .filter((c) => volumPermetAfegirACamio(0, volum, c))
    .sort((a, b) => Number(a.capacitatMaxima || 0) - Number(b.capacitatMaxima || 0))[0];

  if (!camio) {
    return null;
  }

  const idxDisponible = context.camionsDisponibles.indexOf(camio);
  if (idxDisponible >= 0) {
    context.camionsDisponibles.splice(idxDisponible, 1);
  }

  return {
    camio: { id: camio.id ?? `camio-${index}`, capacitatMaxima: Number(camio.capacitatMaxima || 0) },
    entregues: [],
    volumOcupat: 0,
    __camioFont: camio,
    __camioVirtual: false,
  };
}

/**
 * Obre ruta nova amb camió físic; si la flota està saturada, fusiona rutes fins a alliberar-ne un.
 */
function creaRutaNovaAmbAlliberacioFlota(volumCarrega, rutes, context, index) {
  let guard = 0;
  while (guard < MAX_PASSADES_ALLIBERACIO_FLOTTA) {
    guard += 1;
    const nova = creaRutaNovaAmbVolumMinim(volumCarrega, context, index);
    if (nova) return nova;
    if (!intentFusionarQualsevolRutaPerAlliberarCamio(rutes, context)) return null;
  }
  return null;
}

function creaRutaNova(entrega, context, index) {
  return creaRutaNovaAmbVolumMinim(Number(entrega.volumTotal || 0), context, index);
}

/**
 * Nova ruta amb dues parades del mateix pètal angular si hi ha estalvi de km i finestra vàlida.
 * @returns {boolean} true si s’ha creat la ruta (ambdues entregues assignades).
 */
function intentarCrearRutaParellaMateixPetal(entrega, companyia, rutes, context, fase) {
  const volTot = Number(entrega.volumTotal || 0) + Number(companyia.volumTotal || 0);
  const novaRuta = creaRutaNovaAmbAlliberacioFlota(volTot, rutes, context, rutes.length + 1);
  if (!novaRuta) return false;

  const seqCandidates = [
    [entrega, companyia],
    [companyia, entrega],
  ].filter((seq) => planificacioValidaPerSeq(seq, context).valida);

  let millorSeq = null;
  let millorKm = Infinity;
  for (const seq of seqCandidates) {
    const km = distanciaObertaMesRetornKmHaversine(seq, context.magatzem);
    if (km < millorKm) {
      millorKm = km;
      millorSeq = seq;
    }
  }

  if (!millorSeq) {
    desferRutaNovaBuida(novaRuta, context);
    return false;
  }

  novaRuta.entregues = millorSeq;
  novaRuta.volumOcupat = volTot;

  intentaOptimitzacioIncremental(novaRuta, context);

  if (!teFinestresValides(novaRuta, context)) {
    novaRuta.entregues = [];
    novaRuta.volumOcupat = 0;
    desferRutaNovaBuida(novaRuta, context);
    return false;
  }

  entrega.__assignada = true;
  companyia.__assignada = true;
  entrega.__fase = fase;
  companyia.__fase = fase;
  delete entrega.motiuNoAssignacio;
  delete companyia.motiuNoAssignacio;
  rutes.push(novaRuta);
  return true;
}

/** Intenta obrir una ruta nova amb dues parades mateix pètal abans d’un camió amb una sola parada. */
function intentarNovaRutaAmbConsolidacioPetal(entrega, entreguesOrdenades, rutes, context, fase) {
  if (context.prioritzacioPetalConsolidacio === false) return false;
  const companyia = trobarCompanyiaPetalAngles(entrega, entreguesOrdenades, context);
  if (!companyia) return false;
  return intentarCrearRutaParellaMateixPetal(entrega, companyia, rutes, context, fase);
}

function desferRutaNovaBuida(ruta, context) {
  if (ruta.entregues.length > 0) return;
  const font = ruta.__camioFont;
  if (font && !context.camionsDisponibles.includes(font)) {
    context.camionsDisponibles.push(font);
  }
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
  recalculaVolum(ruta);
  return volumPermetAfegirACamio(ruta.volumOcupat, entrega?.volumTotal ?? 0, ruta.camio);
}

function sobrepassaCapacitatOperativa(ruta) {
  recalculaVolum(ruta);
  return volumSuperaLimitOperatiu(ruta.volumOcupat, ruta.camio);
}

/**
 * Garanteix que cap ruta superi el volum operatiu: treu parades en excés i les reubica o crea ruta nova (camió físic; pot fusionar rutes per alliberar-ne un).
 */
function corregirSobrecàrregaRutes(rutes, context, entreguesNoAssignades) {
  let guard = 0;
  while (guard++ < 5000) {
    let problem = null;
    for (const ruta of rutes) {
      if (sobrepassaCapacitatOperativa(ruta)) {
        problem = ruta;
        break;
      }
    }
    if (!problem) return;

    if (!problem.entregues.length) {
      continue;
    }

    const e = problem.entregues[problem.entregues.length - 1];
    eliminaEntrega(problem, e);
    e.__assignada = false;

    const admetTorneig = (ruta) => {
      if (!ruta.entregues.length) return true;
      const f = e.__fase;
      if (f == null || f === 'reintegre') return true;
      return rutaAdmetNouStopMateixTorneig(ruta, f);
    };

    const candidates = [...rutes]
      .filter(
        (ruta) =>
          ruta !== problem
          && teCapacitatPer(ruta, e)
          && admetTorneig(ruta)
          && potAfegirEntregaQuotaParades(ruta, context),
      )
      .sort((a, b) => {
        const pb = puntuacioRutaPerEntrega(b, e, context);
        const pa = puntuacioRutaPerEntrega(a, e, context);
        if (pb !== pa) return pb - pa;
        return b.entregues.length - a.entregues.length;
      });

    let reinserida = false;
    for (const ruta of candidates) {
      const millor = millorInsercioAmbLlindar(ruta, e, context);
      if (!millor) continue;

      ruta.entregues.splice(millor.pos, 0, e);
      ruta.volumOcupat += Number(e.volumTotal || 0);
      recalculaVolum(ruta);
      if (teFinestresValides(ruta, context)) {
        intentaOptimitzacioIncremental(ruta, context);
        e.__assignada = true;
        reinserida = true;
        break;
      }
      eliminaEntrega(ruta, e);
    }

    if (reinserida) continue;

    const novaRuta = creaRutaNovaAmbAlliberacioFlota(Number(e.volumTotal || 0), rutes, context, rutes.length + 1);
    if (!novaRuta) {
      marcaNoAssignada(e, 'CAPACITAT_FLOTA');
      entreguesNoAssignades.push(e);
      continue;
    }

    afegeixEntrega(novaRuta, e);
    recalculaVolum(novaRuta);
    if (teFinestresValides(novaRuta, context)) {
      intentaOptimitzacioIncremental(novaRuta, context);
      e.__assignada = true;
      rutes.push(novaRuta);
    } else {
      desfesUltimaEntrega(novaRuta);
      desferRutaNovaBuida(novaRuta, context);
      marcaNoAssignada(e, 'FINESTRES_NOVA_RUTA');
      entreguesNoAssignades.push(e);
    }
  }
}

function insereixEntregaMinimCost(ruta, entrega, context) {
  if (!teCapacitatPer(ruta, entrega) || !potAfegirEntregaQuotaParades(ruta, context)) return false;

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

/** Increment marginal en km (Haversine), coherent amb llindarKmInsercio. */
function incrementDistanciaKmPerInsercio(seqActual, entrega, pos, magatzem) {
  const anterior = pos === 0 ? magatzem : seqActual[pos - 1].coordenades;
  const seguent = pos === seqActual.length ? null : seqActual[pos].coordenades;

  if (!seguent) {
    return distanciaKmHaversine(anterior, entrega.coordenades);
  }

  return (
    distanciaKmHaversine(anterior, entrega.coordenades)
    + distanciaKmHaversine(entrega.coordenades, seguent)
    - distanciaKmHaversine(anterior, seguent)
  );
}

function distanciaObertaMesRetornKmHaversine(entreguesSeq, magatzem) {
  if (!entreguesSeq.length) return 0;
  let total = distanciaKmHaversine(magatzem, entreguesSeq[0].coordenades);
  for (let i = 1; i < entreguesSeq.length; i += 1) {
    total += distanciaKmHaversine(entreguesSeq[i - 1].coordenades, entreguesSeq[i].coordenades);
  }
  const ultima = entreguesSeq[entreguesSeq.length - 1].coordenades;
  total += distanciaKmHaversine(ultima, magatzem);
  return total;
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
  return calculaPlanificacioRuta(rutaTemp, context, tempsSortidaMinimaPerValidacio(context));
}

function actualitzaEtasRutes(rutes, context) {
  for (const ruta of rutes) {
    for (const entrega of ruta.entregues || []) {
      entrega.horaDEntrega = null;
    }
  }

  for (const ruta of rutes) {
    const sortidaMinuts = calculaSortidaAproximada(ruta, context);
    const ctxTimeline =
      context.assignacioCompletaOpcio === true ? { ...context, ignoreFinestresClient: true } : context;
    const planificacio = calculaPlanificacioRuta(ruta, ctxTimeline, sortidaMinuts);
    ruta.esValidaFranges = context.assignacioCompletaOpcio
      ? calculaPlanificacioRuta(ruta, context, sortidaMinuts).valida
      : planificacio.valida;
    ruta.sortidaMagatzemMinuts = sortidaMinuts;
    ruta.horaSortidaMagatzem = minutsAHhMm(sortidaMinuts);
    ruta.horaSortidaMagatzemAproximada = ruta.horaSortidaMagatzem;

    for (const parada of planificacio.parades) {
      const { entrega, arribadaMin, sortidaMin, tempsDescarregaEntrega } = parada;
      entrega.arribadaMinuts = arribadaMin;
      entrega.sortidaMinuts = sortidaMin;
      entrega.arribadaHora = minutsAHhMm(arribadaMin);
      entrega.sortidaHora = minutsAHhMm(sortidaMin);
      entrega.tempsDescarregaMinuts = tempsDescarregaEntrega;
      entrega.horaDEntrega = entrega.arribadaHora;
    }

    if (ruta.entregues.length > 0 && planificacio.parades.length > 0) {
      const primeraParada = planificacio.parades[0];
      ruta.tempsMagatzemPrimeraEntregaMinuts = primeraParada.arribadaMin - sortidaMinuts;

      const ultimaEntrega = ruta.entregues[ruta.entregues.length - 1];
      const ultimaParada = planificacio.parades[planificacio.parades.length - 1];
      const tempsRetorn = tempsViatgeUltimaMateDepotIntern(ruta, ultimaEntrega, context);
      const arribadaTornadaMinuts =
        planificacio.tornadaMagatzemMinuts != null
          ? planificacio.tornadaMagatzemMinuts
          : addMinutsConduccioAmbPausa(ultimaParada.sortidaMin, tempsRetorn, context);
      ruta.tornadaMagatzemMinuts = arribadaTornadaMinuts;
      ruta.horaTornadaMagatzem = minutsAHhMm(arribadaTornadaMinuts);
    } else {
      ruta.tempsMagatzemPrimeraEntregaMinuts = 0;
      ruta.tornadaMagatzemMinuts = sortidaMinuts;
      ruta.horaTornadaMagatzem = minutsAHhMm(sortidaMinuts);
    }

    ruta.horaArribadaMagatzemAproximada = ruta.horaTornadaMagatzem ?? null;
  }
}

/** Comparació estable en minuts arrodonits (mateixa escala que les ETA mostrades). */
function minutsIntervalRuta(inici, fi) {
  return {
    inici: Math.round(Number(inici)),
    fi: Math.round(Number(fi)),
  };
}

/** True si els intervals [ia, fa] i [ib, fb] es solapen en temps estrictament (no es permet simultaneïtat). Tou al límit: tornada === sortida següent és vàlid. */
function intervalsTempsSolapen(ia, fa, ib, fb) {
  if (![ia, fa, ib, fb].every((n) => Number.isFinite(n))) return false;
  return ia < fb && ib < fa;
}

function camioTeIntervalLliure(reservesPerCamioId, camioIdStr, inici, fi) {
  const bookings = reservesPerCamioId.get(camioIdStr) || [];
  for (const b of bookings) {
    if (intervalsTempsSolapen(inici, fi, b.inici, b.fi)) return false;
  }
  return true;
}

function registraIntervalCamio(reservesPerCamioId, camioIdStr, inici, fi) {
  if (!reservesPerCamioId.has(camioIdStr)) reservesPerCamioId.set(camioIdStr, []);
  reservesPerCamioId.get(camioIdStr).push({ inici, fi });
}

/**
 * El mateix id de camió no pot cobrir dues rutes amb intervals temporals que es creuin.
 * Es processen les rutes per ordre de sortida; si hi ha solapament, es busca un altre camió físic amb capacitat i interval lliure;
 * si no n’hi ha cap, s’intenta absorbir la ruta dins una altra; es repeteix fins a estabilitzar o límit de profunditat.
 */
function resoleSolapamentsTemporalCamions(rutes, context, profunditatRecursiva = 0) {
  if (profunditatRecursiva > 50) return;

  const camionsFisics = Array.isArray(context.camions) ? context.camions : [];
  const reservesPerCamioId = new Map();

  const ambParades = rutes.filter((r) => r.entregues?.length > 0);
  ambParades.sort((a, b) => {
    const sa = Number(a.sortidaMagatzemMinuts);
    const sb = Number(b.sortidaMagatzemMinuts);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    const ta = Number(a.tornadaMagatzemMinuts);
    const tb = Number(b.tornadaMagatzemMinuts);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return 0;
  });

  for (const ruta of ambParades) {
    recalculaVolum(ruta);
    const volum = Number(ruta.volumOcupat || 0);
    const rawInici = ruta.sortidaMagatzemMinuts;
    const rawFi = ruta.tornadaMagatzemMinuts;
    if (!Number.isFinite(rawInici) || !Number.isFinite(rawFi)) continue;

    const { inici, fi } = minutsIntervalRuta(rawInici, rawFi);
    if (!Number.isFinite(inici) || !Number.isFinite(fi)) continue;

    let camioIdStr = String(ruta.camio?.id ?? '').trim();
    if (!camioIdStr) {
      context.__anonCamioSeq = (context.__anonCamioSeq || 0) + 1;
      camioIdStr = `__sense-id-${context.__anonCamioSeq}`;
    }

    const ocupatPelMateixId = !camioTeIntervalLliure(reservesPerCamioId, camioIdStr, inici, fi);

    if (!ocupatPelMateixId) {
      registraIntervalCamio(reservesPerCamioId, camioIdStr, inici, fi);
      continue;
    }

    const candidats = [...camionsFisics]
      .filter((c) => volumPermetAfegirACamio(0, volum, c))
      .sort((a, b) => Number(a.capacitatMaxima || 0) - Number(b.capacitatMaxima || 0));

    let substitut = null;
    for (const c of candidats) {
      const idS = String(c.id ?? '');
      if (camioTeIntervalLliure(reservesPerCamioId, idS, inici, fi)) {
        substitut = c;
        break;
      }
    }

    if (substitut) {
      ruta.camio = {
        id: substitut.id ?? ruta.camio?.id,
        capacitatMaxima: Number(substitut.capacitatMaxima || 0),
      };
      ruta.__camioFont = substitut;
      ruta.__camioVirtual = false;
      registraIntervalCamio(reservesPerCamioId, String(substitut.id ?? ''), inici, fi);
      continue;
    }

    if (intentAbsorbirRutaEnAltra(ruta, rutes, context)) {
      resoleSolapamentsTemporalCamions(rutes, context, profunditatRecursiva + 1);
      return;
    }

    registraIntervalCamio(reservesPerCamioId, camioIdStr, inici, fi);
  }
}

function calculaSortidaAproximada(ruta, context) {
  const minS = Number.isFinite(context.minSortidaMagatzemMinuts) ? context.minSortidaMagatzemMinuts : 0;
  if (!ruta.entregues || ruta.entregues.length === 0) return minS;
  if (!context.esperaFinsIniciFinestraClient) return minS;
  const primeraEntrega = ruta.entregues[0];
  const iniciPrimera = horaATotalMinuts(primeraEntrega.horaInici);
  if (iniciPrimera == null) return minS;

  const tempsFinsPrimera = tempsViagemOrdreIntern(ruta, null, primeraEntrega, context);
  const sortida = iniciPrimera - tempsFinsPrimera;
  return Math.max(minS, sortida, 0);
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
  return Number(entrega?.volumTotal ?? 0);
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
