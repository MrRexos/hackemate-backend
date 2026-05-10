/**
 * Joc de proves: **100 referències de pedido** (REF-PED-001…100), **25 entregues** × 4 pedidos,
 * ~20 km del centre de Mollet, alternança adreça / coordenades; executa {@link generarRutes}
 * (`sweep-optimizer.service.js`, `generarRutes`) i exporta JSON + mapa HTML.
 *
 * **Carreteres (OSRM):** per defecte s’activa `optimIntraRutaCarrers` (mateixa opció que el servei):
 * matriu OSRM Table, ordre intra-ruta amb durades per carretera, ETA amb `_matDurSec`.
 * Només amb **`--fast`** es desactiva (temps de viatge com a línia recta + velocitat fixa; més ràpid per proves).
 *
 * Ús:
 *   node src/scripts/joc-proves-rutes-mollet.js
 *   node src/scripts/joc-proves-rutes-mollet.js --fast --out fixtures/rutes-joc-proves
 *   node src/scripts/joc-proves-rutes-mollet.js --geocode-osm   # adreces sense coords via Nominatim (~lent)
 *
 * **Excel (mateix format que `main-rutes-excel.js`):** substitueix el dataset sintètic per les entregues
 * llegides del `.xlsx`; magatzem per defecte = `MOLLET_MAGATZEM_AFORES` (com `executarRutesDesDeExcel`).
 *   node src/scripts/joc-proves-rutes-mollet.js --excel fixtures/excel/comandes-prova.xlsx --mock-geocode
 *   node src/scripts/joc-proves-rutes-mollet.js --excel ./comandes.xlsx --magatzem 2.1718,41.5278 --mock-geocode --fast
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { volumCarregaMaximaOperativa } from '../models/logistica/constants/capacitat-camio.constants.js';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { Pedido } from '../models/logistica/classes/pedido.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import { excelToEntregas } from '../models/logistica/services/excel-to-entregas.converter.js';
import { normalitzaCoordenades } from '../models/logistica/utils/coordenades.utils.js';
import { geocodificarMockDeterminista } from '../main-rutes-excel.js';
import { MOLLET_CENTRE_RODONA, MOLLET_MAGATZEM_AFORES } from './utils/punts-sobre-carrer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/** Magatzem al centre urbà de Mollet (rodona de referència). */
const MAGATZEM = MOLLET_CENTRE_RODONA;

/** Distància objectiu sobre el terreny (Haversine des del centre). */
const DISTANCIA_ANELL_KM = 20;

/** Total de línies de pedido (referències REF-PED-xxx). */
const TOTAL_REF_PEDIDOS = 100;

/** 25 entregues × 4 pedidos = 100 referències. */
const ENTREGUES_GENERADES = 25;
const PEDIDOS_PER_ENTREGA = 4;

function parseArgs(argv) {
  const out = {
    fast: false,
    geocodeOsm: false,
    outDir: path.join(BACKEND_ROOT, 'fixtures', 'rutes-joc-proves'),
    excelPath: null,
    mockGeo: false,
    magatzem: null,
    formatMotor: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fast') out.fast = true;
    else if (a === '--geocode-osm') out.geocodeOsm = true;
    else if (a === '--mock-geocode') out.mockGeo = true;
    else if (a === '--format' && argv[i + 1] === 'motor') {
      out.formatMotor = true;
      i += 1;
    } else if (a === '--excel' && argv[i + 1]) {
      out.excelPath = argv[++i];
    } else if (a === '--magatzem' && argv[i + 1]) {
      const raw = argv[++i];
      const parts = String(raw).split(',').map((x) => Number(String(x).trim()));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        out.magatzem = { x: parts[0], y: parts[1] };
      }
    } else if (a === '--out' && argv[i + 1]) {
      out.outDir = path.resolve(process.cwd(), argv[++i]);
    }
  }
  return out;
}

/** Punt a distKm del centre (lon0,lat0 en graus), bearing graus des del nord en sentit horari. */
function puntAnellKm(lon0, lat0, distKm, bearingGraus) {
  const R = 6371;
  const bearingRad = (bearingGraus * Math.PI) / 180;
  const lon1 = (lon0 * Math.PI) / 180;
  const lat1 = (lat0 * Math.PI) / 180;
  const dr = distKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(bearingRad));
  const lon2 =
    lon1
    + Math.atan2(
      Math.sin(bearingRad) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { x: (lon2 * 180) / Math.PI, y: (lat2 * 180) / Math.PI };
}

function distanciaKmHaversine(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const la1 = toR(lat1);
  const la2 = toR(lat2);
  const dLa = la2 - la1;
  const dLo = toR(lon2 - lon1);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

/**
 * Adreces reals (~18–24 km); només s’usen quan la fila és «només adreça» (sense coords inicials).
 */
const ADRECES_PROVA = [
  'Rambla de Samaranch 45, 08302 Mataró',
  'Avinguda Francesc Macià 112, 08402 Granollers',
  'Rambla d\'Ègara 78, 08221 Terrassa',
  'Carrer Major 23, 08470 Sant Celoni',
  'Passeig dels Til·lers 6, 08530 La Garriga',
  'Plaça de l\'Església 4, 08140 Caldes de Montbui',
  'Rambla de Sant Ramon 41, 08440 Cardedeu',
  'Carrer de Barcelona 15, 08740 Sant Andreu de la Barca',
];

/** Catàleg rotatiu per generar descripcions de producte (referència REF-PED-xxx al nom). */
const CATALEG_PRODUCTES = [
  { desc: 'Arròs sac 25 kg', tipus: 'sec' },
  { desc: 'Oli gira-sol 5L', tipus: 'líquid' },
  { desc: 'Marisc congelat mix', tipus: 'congelat' },
  { desc: 'Postres individual', tipus: 'fresc' },
  { desc: 'Paquets A4 (caixa)', tipus: 'papereria' },
  { desc: 'Caixes calçat numerades', tipus: 'textil' },
  { desc: 'Bidons detergents', tipus: 'químic' },
  { desc: 'Medicaments estanteria', tipus: 'farma' },
  { desc: 'Caixes fruita', tipus: 'fresc' },
  { desc: 'Petit electrodomèstic', tipus: 'electro' },
  { desc: 'Aigua mineral', tipus: 'beguda' },
  { desc: 'Roba planxada', tipus: 'textil' },
  { desc: 'Recanvis filtres', tipus: 'recanvi' },
  { desc: 'Material didàctic', tipus: 'educació' },
  { desc: 'Sacos morter', tipus: 'construcció' },
  { desc: 'Conserves peix', tipus: 'sec' },
  { desc: 'Làctics nevera', tipus: 'fresc' },
  { desc: 'Accessoris ferreteria', tipus: 'ferreteria' },
  { desc: 'Embalatge buit', tipus: 'envàs' },
  { desc: 'Beguda isotònica', tipus: 'beguda' },
];

function padRefPedido(n) {
  return String(n).padStart(3, '0');
}

function nomClientEntrega(i) {
  const prefixes = ['Distribucions', 'Comercial', 'Magatzem', 'Outlet', 'Serveis', 'Logística'];
  const sufixes = ['Vallès', 'Maresme', 'Interior', 'Montseny', 'Penedès', 'Occidental'];
  return `${prefixes[i % prefixes.length]} ${sufixes[(i * 5 + 3) % sufixes.length]} ${String(i + 1).padStart(2, '0')} SL`;
}

function franjaHorariaEntrega(i) {
  const mati = i % 5 !== 4;
  return mati
    ? { horaInici: '08:30', horaFinal: '13:30' }
    : { horaInici: '15:00', horaFinal: '19:30' };
}

function construeixPedidosPerEntrega(indexPedidoGlobalInici) {
  const pedidos = [];
  for (let k = 0; k < PEDIDOS_PER_ENTREGA; k += 1) {
    const refNum = indexPedidoGlobalInici + k + 1;
    const cat = CATALEG_PRODUCTES[(refNum - 1) % CATALEG_PRODUCTES.length];
    const volum = 0.1 + ((refNum * 7) % 37) * 0.015;
    const nombreCaixes = Math.max(1, Math.floor(6 + ((refNum * 11) % 44)));
    pedidos.push(
      new Pedido({
        nom: `REF-PED-${padRefPedido(refNum)} · ${cat.desc}`,
        volum,
        quantitat: nombreCaixes,
        tipusCarrega: cat.tipus,
      }),
    );
  }
  return pedidos;
}

async function geocodificaNominatim(adreca, fetchImpl = fetch) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', adreca);
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'HackeMate-joc-proves/1.0' } });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`Sense resultats per: ${adreca}`);
  }
  return { x: Number(resultats[0].lon), y: Number(resultats[0].lat) };
}

/**
 * Omple coordenades per entregues «només adreça»: Nominatim o anell determinista ~20 km.
 */
async function resolCoordenadesAdreces(entregues, options) {
  const { geocodeOsm, fetchImpl } = options;
  let kAdreca = 0;
  for (let i = 0; i < entregues.length; i += 1) {
    const e = entregues[i];
    if (normalitzaCoordenades(e.coordenades)) continue;
    if (!e.adreca) throw new Error(`Entrega ${e.identificador}: cal adreça o coordenades`);
    if (geocodeOsm) {
      e.coordenades = await geocodificaNominatim(e.adreca, fetchImpl);
      await new Promise((r) => setTimeout(r, 1100));
    } else {
      const bearing = (360 / entregues.length) * kAdreca + 11.7;
      kAdreca += 1;
      const p = puntAnellKm(MAGATZEM.x, MAGATZEM.y, DISTANCIA_ANELL_KM, bearing);
      e.coordenades = { x: p.x, y: p.y };
    }
  }
}

function construeixDatasetEntregues() {
  if (ENTREGUES_GENERADES * PEDIDOS_PER_ENTREGA !== TOTAL_REF_PEDIDOS) {
    throw new Error('TOTAL_REF_PEDIDOS ha de coincidir amb ENTREGUES_GENERADES × PEDIDOS_PER_ENTREGA');
  }

  const entrades = [];
  const n = ENTREGUES_GENERADES;

  for (let i = 0; i < n; i += 1) {
    const modeCoords = i % 2 === 0;
    const bearing = (360 / n) * i + 7.5;
    const { horaInici, horaFinal } = franjaHorariaEntrega(i);
    const idxPedidoInici = i * PEDIDOS_PER_ENTREGA;

    let coordenades = null;
    let adreca = null;

    if (modeCoords) {
      coordenades = puntAnellKm(MAGATZEM.x, MAGATZEM.y, DISTANCIA_ANELL_KM, bearing);
      adreca = `Anell ${DISTANCIA_ANELL_KM} km · ${bearing.toFixed(1)}° (referència)`;
    } else {
      adreca = ADRECES_PROVA[i % ADRECES_PROVA.length];
    }

    entrades.push(
      new Entrega({
        identificador: `ENT-2026-MOL-${String(i + 1).padStart(3, '0')}`,
        nom: nomClientEntrega(i),
        adreca,
        coordenades,
        horaInici,
        horaFinal,
        pedidos: construeixPedidosPerEntrega(idxPedidoInici),
      }),
    );
  }

  return entrades;
}

function serialitzaPedido(p) {
  return {
    nom: p.nom,
    volumPerCaixa: p.volumPerCaixa,
    quantitatCaixes: p.quantitatCaixes,
    tipusCarrega: p.tipusCarrega ?? null,
    volumTotal: p.volumTotal,
  };
}

function serialitzaEntrega(e) {
  return {
    identificador: e.identificador,
    nom: e.nom,
    adreca: e.adreca,
    coordenades: e.coordenades,
    horaInici: e.horaInici,
    horaFinal: e.horaFinal,
    volumTotal: e.volumTotal,
    horaDEntrega: e.horaDEntrega ?? null,
    pedidos: (e.pedidos || []).map(serialitzaPedido),
  };
}

function serialitzaRuta(ruta, index) {
  const capOp = volumCarregaMaximaOperativa(ruta.camio);
  const vol = Number(ruta.volumOcupat || 0);
  const pctUtil = capOp > 0 ? (vol / capOp) * 100 : 0;
  return {
    indexRuta: index,
    camio: {
      id: ruta.camio?.id ?? null,
      capacitatMaxima: Number(ruta.camio?.capacitatMaxima ?? 0),
      capacitatOperativaMaxima: capOp,
    },
    volumOcupat: vol,
    percentatgeOcupacioUtil: Math.round(pctUtil * 10) / 10,
    virtual: Boolean(ruta.__camioVirtual),
    horaSortidaMagatzem: ruta.horaSortidaMagatzem ?? ruta.horaSortidaMagatzemAproximada ?? null,
    horaArribadaMagatzem: ruta.horaTornadaMagatzem ?? ruta.horaArribadaMagatzemAproximada ?? null,
    kmsConduccioObertaPerCarrers: ruta._kmsConduccioObertaPerCarrers ?? null,
    optimitzacioOsrmAplicada: Boolean(ruta._matDurSec && (ruta.entregues?.length ?? 0) >= 2),
    entregues: (ruta.entregues || []).map(serialitzaEntrega),
  };
}

function horaAMinuts(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function agrupaPerCamio(rutesSerial) {
  const mapa = new Map();
  for (const r of rutesSerial) {
    const id = String(r.camio?.id ?? '?');
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(r);
  }
  for (const [, llista] of mapa) {
    llista.sort((a, b) => horaAMinuts(a.horaSortidaMagatzem) - horaAMinuts(b.horaSortidaMagatzem));
    llista.forEach((ruta, ordre) => {
      ruta.viatgeNumero = ordre + 1;
      ruta.totalViatgesCamio = llista.length;
    });
  }
  return mapa;
}

function estadistiquesGlobals(rutesSerial) {
  const ocupacions = rutesSerial
    .filter((r) => !r.virtual)
    .map((r) => Number(r.percentatgeOcupacioUtil) || 0);
  const mitjana =
    ocupacions.length > 0 ? ocupacions.reduce((a, b) => a + b, 0) / ocupacions.length : 0;
  const ambVirtuals = rutesSerial.map((r) => Number(r.percentatgeOcupacioUtil) || 0);
  const mitjanaAmbVirtuals =
    ambVirtuals.length > 0 ? ambVirtuals.reduce((a, b) => a + b, 0) / ambVirtuals.length : 0;

  return {
    nombreRutes: rutesSerial.length,
    mitjanaPercentatgeOcupacioUtilPerRuta_fisics: Math.round(mitjana * 10) / 10,
    mitjanaPercentatgeOcupacioUtilPerRuta_incloentVirtuals: Math.round(mitjanaAmbVirtuals * 10) / 10,
    nombreCamionsAmbAlMenysUnaRuta: agrupaPerCamio(rutesSerial).size,
  };
}

function buildHtml(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rutes joc de proves — Mollet</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; display: flex; height: 100vh; }
    #map { flex: 1; min-height: 280px; }
    #panel { width: min(420px, 100vw); overflow: auto; border-left: 1px solid #ccc; padding: 12px; background: #fafafa; }
    h1 { font-size: 1.1rem; margin: 0 0 8px; }
    h2 { font-size: 0.95rem; margin: 16px 0 8px; color: #333; }
    .stats { background: #fff; padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #e0e0e0; }
    .camio-block { margin-bottom: 14px; padding: 10px; background: #fff; border-radius: 8px; border: 1px solid #ddd; }
    .camio-title { font-weight: 600; margin-bottom: 6px; }
    .trip { font-size: 0.85rem; margin: 6px 0; padding: 6px; background: #f5f5f5; border-radius: 6px; }
    .bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    .bar > span { display: block; height: 100%; background: linear-gradient(90deg, #2e7d32, #66bb6a); }
    label { font-size: 0.8rem; display: block; margin-bottom: 4px; }
    select { width: 100%; padding: 6px; margin-bottom: 10px; }
    .meta { font-size: 0.75rem; color: #666; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="panel">
    <h1 id="titRutes">Rutes (joc de proves Mollet ~20 km)</h1>
    <p class="meta" id="metaOpt">Magatzem: centre rodona Mollet · colors per ruta · filtre per camió</p>
    <div class="stats" id="stats"></div>
    <label for="filtreCamio">Mostrar camió</label>
    <select id="filtreCamio"><option value="">Tots els camions</option></select>
    <div id="detallCamions"></div>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script type="application/json" id="payload">${json}</script>
  <script>
    const payload = JSON.parse(document.getElementById('payload').textContent);
    const magatzem = payload.magatzem;
    const colors = ['#c62828','#1565c0','#2e7d32','#6a1b9a','#ef6c00','#00838f','#ad1457','#37474f','#558b2f','#4527a0'];
    const map = L.map('map').setView([magatzem.y, magatzem.x], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    L.marker([magatzem.y, magatzem.x], { title: 'Magatzem' }).addTo(map).bindPopup('Magatzem (centre Mollet)');
    const layers = { all: [] };
    const rutes = payload.resultat.rutes;
    rutes.forEach((ruta, i) => {
      const c = colors[i % colors.length];
      const latlngs = [[magatzem.y, magatzem.x]];
      ruta.entregues.forEach((e) => {
        if (e.coordenades && e.coordenades.x != null) latlngs.push([e.coordenades.y, e.coordenades.x]);
      });
      const poly = L.polyline(latlngs, { color: c, weight: 4, opacity: 0.85 }).addTo(map);
      var kmTxt = (ruta.kmsConduccioObertaPerCarrers != null) ? (' · ~' + ruta.kmsConduccioObertaPerCarrers + ' km carretera (obert)') : '';
      poly.bindPopup('Ruta ' + (i+1) + ' · ' + (ruta.camio && ruta.camio.id) + ' · ' + (ruta.percentatgeOcupacioUtil||0) + '% útil' + kmTxt);
      layers.all.push({ poly, camioId: String(ruta.camio && ruta.camio.id || '') });
      ruta.entregues.forEach((e) => {
        if (e.coordenades && e.coordenades.x != null) {
          L.circleMarker([e.coordenades.y, e.coordenades.x], { radius: 6, color: c, fillColor: c, fillOpacity: 0.7 })
            .addTo(map).bindPopup((e.identificador||'') + '<br/>' + (e.nom||''));
        }
      });
    });
    try {
      const b = L.latLngBounds([[magatzem.y, magatzem.x]]);
      rutes.forEach(r => r.entregues.forEach(e => { if (e.coordenades) b.extend([e.coordenades.y, e.coordenades.x]); }));
      map.fitBounds(b, { padding: [36, 36] });
    } catch (_) {}
    const ds = payload.dataset || {};
    const st = payload.estadistiques;
    if (ds.fontDades === 'excel') {
      document.getElementById('titRutes').textContent =
        'Rutes (Excel → ' + (ds.fitxerExcel || '').replace(/</g,'') + ')';
    }
    var optTxt = ds.optimitzacioIntraRutaCarreteraOsrm
      ? 'ETA i km obert: OSRM (project-osrm) quan hi ha ≥2 parades; mapa en cordes rectes.'
      : 'Mode ràpid: sense OSRM (temps com a línia recta).';
    document.getElementById('metaOpt').textContent = 'Magatzem: centre rodona Mollet · ' + optTxt;
    document.getElementById('stats').innerHTML =
      '<strong>Resum</strong><br/>'
      + 'Rutes: ' + st.nombreRutes + '<br/>'
      + 'Mitjana ocupació útil (només físics): <strong>' + st.mitjanaPercentatgeOcupacioUtilPerRuta_fisics + '%</strong><br/>'
      + 'Mitjana amb virtuals: ' + st.mitjanaPercentatgeOcupacioUtilPerRuta_incloentVirtuals + '%<br/>'
      + 'Camions usats: ' + st.nombreCamionsAmbAlMenysUnaRuta;
    const perCamio = payload.perCamio;
    const sel = document.getElementById('filtreCamio');
    const ids = Object.keys(perCamio).sort();
    ids.forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = id + ' (' + perCamio[id].length + ' viatge(s))';
      sel.appendChild(o);
    });
    function applyFilter() {
      const v = sel.value;
      layers.all.forEach(({ poly, camioId }) => {
        if (!v || camioId === v) poly.addTo(map);
        else map.removeLayer(poly);
      });
    }
    sel.addEventListener('change', applyFilter);
    let html = '';
    ids.forEach(id => {
      html += '<div class="camio-block"><div class="camio-title">' + id.replace(/</g,'') + '</div>';
      perCamio[id].forEach(r => {
        const pct = r.percentatgeOcupacioUtil || 0;
        var nPar = (r.entregues && r.entregues.length) ? r.entregues.length : 0;
        var kmLine = (r.kmsConduccioObertaPerCarrers != null)
          ? '<br/>Conducció oberta ~<strong>' + r.kmsConduccioObertaPerCarrers + ' km</strong> (OSRM)'
          : (nPar < 2 ? '<br/><span style="color:#888">1 parada: el motor no fa tour OSRM (només temps recta)</span>' : '');
        html += '<div class="trip">Viatge ' + r.viatgeNumero + '/' + r.totalViatgesCamio
          + ' · Sortida ~' + (r.horaSortidaMagatzem||'—') + ' · Tornada ~' + (r.horaArribadaMagatzem||'—')
          + '<br/>Càrrega ' + r.volumOcupat + ' / ' + r.camio.capacitatOperativaMaxima.toFixed(1) + ' útil (' + pct + '%)'
          + kmLine
          + '<div class="bar"><span style="width:' + Math.min(100, pct) + '%"></span></div></div>';
      });
      html += '</div>';
    });
    document.getElementById('detallCamions').innerHTML = html;
  </script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });

  /** Magatzem sintètic: centre rodona. Amb `--excel`, per defecte afores (com `executarRutesDesDeExcel`). */
  let magatzemUsat;
  let entregues;

  if (args.excelPath) {
    magatzemUsat = args.magatzem ?? MOLLET_MAGATZEM_AFORES;
    const resolvedExcel = path.isAbsolute(args.excelPath)
      ? args.excelPath
      : path.resolve(process.cwd(), args.excelPath);

    const excelToEntregasOptions = {
      ...(args.mockGeo
        ? { geocodificar: geocodificarMockDeterminista, pausaEntreGeocodificacionsMs: 0 }
        : { fetchImpl: fetch, pausaEntreGeocodificacionsMs: 1100 }),
      ...(args.formatMotor ? { format: 'motor' } : {}),
    };

    console.log(`Font de dades: Excel → ${resolvedExcel}`);
    console.log(
      args.mockGeo
        ? 'Geocodificació: mock determinista (mateixa funció que main-rutes-excel --mock-geocode)\n'
        : 'Geocodificació: Nominatim (una crida per entrega; requereix xarxa)\n',
    );

    entregues = await excelToEntregas(resolvedExcel, excelToEntregasOptions);
  } else {
    magatzemUsat = args.magatzem ?? MAGATZEM;
    entregues = construeixDatasetEntregues();

    console.log(`Magatzem (centre Mollet): ${magatzemUsat.x}, ${magatzemUsat.y}`);
    console.log(
      `Dataset sintètic: ${entregues.length} entregues · ${TOTAL_REF_PEDIDOS} referències de pedido (REF-PED-001…${padRefPedido(TOTAL_REF_PEDIDOS)})`,
    );
    console.log(
      `Mode resolució adreces sense coords inicials: ${args.geocodeOsm ? 'Nominatim' : 'anell determinista ' + DISTANCIA_ANELL_KM + ' km'}`,
    );

    await resolCoordenadesAdreces(entregues, {
      geocodeOsm: args.geocodeOsm,
      fetchImpl: fetch,
    });
  }

  if (args.excelPath) {
    console.log(`Magatzem: ${magatzemUsat.x}, ${magatzemUsat.y} (per defecte = afores Mollet, com executarRutesDesDeExcel)`);
    console.log(`Entregues llegides: ${entregues.length}`);
  }

  if (args.fast) {
    console.warn(
      '[!] --fast: optimIntraRutaCarrers=false → sense OSRM Table ni 2-opt per carretera; ETA com a línia recta + velocitat fixa.',
    );
  } else {
    console.log(
      'Optimització carretera: activada (mateixa opció per defecte que generarRutes → OSRM table + durades per ETA).',
    );
  }
  console.log('');

  let minD = Infinity;
  let maxD = 0;
  for (const e of entregues) {
    const d = distanciaKmHaversine(magatzemUsat.x, magatzemUsat.y, e.coordenades.x, e.coordenades.y);
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
  }
  console.log(`Distància Haversine magatzem → parades: min ${minD.toFixed(1)} km · max ${maxD.toFixed(1)} km\n`);

  const totalRefsPedido = entregues.reduce((acc, e) => acc + (e.pedidos?.length ?? 0), 0);

  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  const resultat = await generarRutes(entregues, flota, magatzemUsat, {
    EntregaClass: Entrega,
    usaMock: false,
    fetchImpl: fetch,
    assignacioCompleta: true,
    optimIntraRutaCarrers: !args.fast,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
    perQuotaParadesDesactivada: true,
  });

  const rutesSerial = resultat.rutes.map(serialitzaRuta);
  const agrupat = agrupaPerCamio(rutesSerial);
  const perCamio = Object.fromEntries(
    [...agrupat.entries()].map(([k, v]) => [k, v]),
  );

  const estadistiques = estadistiquesGlobals(rutesSerial);

  const excelAbsolut = args.excelPath
    ? path.isAbsolute(args.excelPath)
      ? args.excelPath
      : path.resolve(process.cwd(), args.excelPath)
    : null;

  const payloadComplet = {
    generat: new Date().toISOString(),
    magatzem: magatzemUsat,
    distanciaAnellKm: args.excelPath ? null : DISTANCIA_ANELL_KM,
    dataset: {
      fontDades: args.excelPath ? 'excel' : 'sintetic',
      fitxerExcel: excelAbsolut,
      totalEntregues: entregues.length,
      totalReferenciesPedido: args.excelPath ? totalRefsPedido : TOTAL_REF_PEDIDOS,
      pedidosPerEntrega: args.excelPath ? null : PEDIDOS_PER_ENTREGA,
      optimitzacioIntraRutaCarreteraOsrm: !args.fast,
      osrmRouterUrlPerDefecte: 'https://router.project-osrm.org',
    },
    estadistiques,
    perCamio,
    resultat: {
      rutes: rutesSerial,
      entreguesNoAssignades: (resultat.entreguesNoAssignades || []).map(serialitzaEntrega),
    },
  };

  const jsonPath = path.join(args.outDir, 'rutes-joc-proves-output.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payloadComplet, null, 2), 'utf8');
  console.log(`\nEscrit: ${jsonPath}`);

  const htmlPath = path.join(args.outDir, 'rutes-joc-proves-map.html');
  fs.writeFileSync(htmlPath, buildHtml(payloadComplet), 'utf8');
  console.log(`Escrit: ${htmlPath}`);
  console.log('\nObre el HTML en el navegador per veure mapa, camions, viatges i mitjana d’ocupació.');

  console.log('\n--- Rutes (resum) ---');
  rutesSerial.forEach((r) => {
    console.log(
      `  ${r.camio.id}  viatge ${r.viatgeNumero}/${r.totalViatgesCamio}  ·  ${r.percentatgeOcupacioUtil}% útil  ·  ${r.entregues.length} parades`,
    );
  });
  console.log(
    `\nMitjana ocupació útil (camions físics, per ruta): ${estadistiques.mitjanaPercentatgeOcupacioUtilPerRuta_fisics}%`,
  );
  if (resultat.entreguesNoAssignades?.length) {
    console.log('\nNo assignades:', resultat.entreguesNoAssignades.map((e) => e.identificador).join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
