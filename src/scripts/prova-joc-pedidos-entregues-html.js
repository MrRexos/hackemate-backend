/**
 * Joc de proves **concret**: línies de comanda amb tots els camps rellevants → agrupació per adreça + franja
 * (mateixa clau que `convertirExcelAEntregas` ubicació + hora) → `generarRutes` → HTML amb catàleg, agrupació i mapa OSRM.
 *
 * Ús: node src/scripts/prova-joc-pedidos-entregues-html.js
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { Pedido } from '../models/logistica/classes/pedido.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import {
  generaPuntsSobreCarrerRodona,
  MOLLET_CENTRE_RODONA,
  MOLLET_MAGATZEM_AFORES,
} from './utils/punts-sobre-carrer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAGATZEM = { ...MOLLET_MAGATZEM_AFORES };
const RADI_KM = 18;
const N_ESTABLIMENTS = 60;

/** Plantilles de producte per omplir volum/quantitat/tipus de manera consistent. */
const CATALEG_PRODUCTE = [
  { familia: 'Beguda', producte: 'Cervesa barril 30L', marca: 'Alhambra', tipusCarrega: 'barril', volumPerCaixa: 0.58 },
  { familia: 'Beguda', producte: 'Refresc PET 2L', marca: 'Fan', tipusCarrega: 'caixa', volumPerCaixa: 0.42 },
  { familia: 'Sec', producte: 'Conserva tomàquet', marca: 'Orlando', tipusCarrega: 'caixa', volumPerCaixa: 0.22 },
  { familia: 'Fresc', producte: 'Iogurt vas', marca: 'Danone', tipusCarrega: 'caixa', volumPerCaixa: 0.18 },
  { familia: 'Neteja', producte: 'Rentaplats 5L', marca: 'Mistol', tipusCarrega: 'garrafa', volumPerCaixa: 0.35 },
  { familia: 'Snacks', producte: 'Patates bossa', marca: 'Lay\'s', tipusCarrega: 'caixa', volumPerCaixa: 0.28 },
];

const NOMS_LOCAL = [
  'Bar Centre',
  'Taverna del Pi',
  'Restaurant Mirador',
  'Cafè Rambla',
  'Menjador Social',
  'Hostal del Vallès',
  'Xarcuteria J. Puig',
  'Super Mini 24h',
  'Bar Sport',
  'Terrassa del Carme',
  'Menjador Escola Verda',
  'Hotel Sant Jordi',
  'Bar Les Fonts',
  'Restaurant Cal Feliu',
  'Cuina Oberta',
  'Bar Plaça',
  'Taverna Vella',
  'Marisqueria Costa',
];

function normalitzaAdrecaKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clau d’agrupació igual que «mateixa adreça + mateixa franja» a l’Excel.
 * @param {{ adreca: string, horaIniciFranja: string|null, horaFinalFranja: string|null }} l
 */
function clauAgrupacio(l) {
  return `${normalitzaAdrecaKey(l.adreca)}|${l.horaIniciFranja ?? ''}|${l.horaFinalFranja ?? ''}`;
}

/**
 * @typedef {object} LiniaComanda
 * @property {string} liniaId
 * @property {string} referenciaPedido
 * @property {string} producte
 * @property {string} marca
 * @property {string} familia
 * @property {string} tipusCarrega
 * @property {number} volumPerCaixa
 * @property {number} quantitat
 * @property {string} idClient
 * @property {string} nomClient
 * @property {string} adreca
 * @property {{ x: number, y: number }} coordenades
 * @property {string|null} horaIniciFranja
 * @property {string|null} horaFinalFranja
 * @property {string|null} horaIniciPedido
 * @property {string} observacions
 */

/**
 * Genera un catàleg determinista de línies: diverses línies per establiment i franja.
 * @param {Array<{ nom: string, x: number, y: number }>} punts
 * @returns {LiniaComanda[]}
 */
function generaLiniesComanda(punts) {
  /** @type {LiniaComanda[]} */
  const linies = [];
  let seqLinia = 0;
  let seqRef = 0;

  punts.forEach((punt, idxEstab) => {
    const idClient = `CLI-${String(idxEstab + 1).padStart(3, '0')}`;
    const nomClient = NOMS_LOCAL[idxEstab % NOMS_LOCAL.length];
    const adreca = `Carrer de prova ${idxEstab + 1}, ${punt.nom}`;

    const franges = [
      { ini: '09:00', fi: '13:30', sufix: 'MAT' },
      { ini: '16:00', fi: '20:00', sufix: 'TAR' },
    ];

    franges.forEach((fr) => {
      const nLinies = 2 + ((idxEstab + fr.ini.length) % 4);
      for (let k = 0; k < nLinies; k += 1) {
        seqLinia += 1;
        seqRef += 1;
        const cat = CATALEG_PRODUCTE[(seqRef + k) % CATALEG_PRODUCTE.length];
        const quantitat = Math.max(1, 2 + ((seqLinia + idxEstab) % 8));
        linies.push({
          liniaId: `LIN-${String(seqLinia).padStart(4, '0')}`,
          referenciaPedido: `REF-PED-${String(seqRef).padStart(4, '0')}`,
          producte: cat.producte,
          marca: cat.marca,
          familia: cat.familia,
          tipusCarrega: cat.tipusCarrega,
          volumPerCaixa: cat.volumPerCaixa,
          quantitat,
          idClient,
          nomClient,
          adreca,
          coordenades: { x: punt.x, y: punt.y },
          horaIniciFranja: fr.ini,
          horaFinalFranja: fr.fi,
          horaIniciPedido: k === 0 ? fr.ini : null,
          observacions:
            k === 0
              ? `Prioritat ${fr.sufix}; descàrrega dock posterior`
              : `Línia addicional mateixa finestra (${fr.sufix})`,
        });
      }
    });
  });

  return linies;
}

/**
 * Agrupa línies en entregues (una entrega = mateixa adreça + mateixa franja horària).
 * @param {LiniaComanda[]} linies
 * @returns {Array<{ entrega: Entrega, liniesGrup: LiniaComanda[] }>}
 */
function agrupaLiniesAEntregues(linies) {
  const mapa = new Map();
  for (const linia of linies) {
    const k = clauAgrupacio(linia);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(linia);
  }

  const sortida = [];
  let grupN = 0;
  for (const [, grup] of mapa) {
    grup.sort((a, b) => String(a.liniaId).localeCompare(String(b.liniaId)));
    grupN += 1;
    const cap = grup[0];
    const pedidos = grup.map((lin) =>
      new Pedido({
        nom: `${lin.referenciaPedido} · ${lin.marca} · ${lin.producte}`,
        volum: lin.volumPerCaixa,
        quantitat: lin.quantitat,
      }),
    );

    const identificador = `ENT-${String(grupN).padStart(3, '0')} · ${cap.idClient} · ${cap.nomClient}`;

    const entrega = new Entrega({
      identificador,
      adreca: cap.adreca,
      pedidos,
      horaInici: cap.horaIniciFranja,
      horaFinal: cap.horaFinalFranja,
      coordenades: cap.coordenades,
    });

    sortida.push({ entrega, liniesGrup: grup });
  }

  sortida.sort((a, b) => String(a.entrega.identificador).localeCompare(String(b.entrega.identificador)));
  return sortida;
}

/** Punt més proper sobre polilínia GeoJSON (copiat del flux visual existent). */
function puntMesProperASobrePolilinia(plon, plat, ring) {
  if (!ring || ring.length < 2) return { lon: plon, lat: plat };
  let bestLon = plon;
  let bestLat = plat;
  let bestD2 = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const wx = plon - ax;
    const wy = plat - ay;
    const len2 = vx * vx + vy * vy;
    let qx;
    let qy;
    if (len2 < 1e-18) {
      qx = ax;
      qy = ay;
    } else {
      let t = (wx * vx + wy * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      qx = ax + t * vx;
      qy = ay + t * vy;
    }
    const d2 = (plon - qx) ** 2 + (plat - qy) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestLon = qx;
      bestLat = qy;
    }
  }
  return { lon: bestLon, lat: bestLat };
}

async function calculaGeometriesRutes(rutes, centre) {
  const data = [];
  for (const ruta of rutes) {
    const punts = [centre, ...ruta.entregues.map((e) => e.coordenades), centre];
    const coords = punts.map((p) => `${p.x},${p.y}`).join(';');
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coords}`);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');

    try {
      const res = await fetch(url);
      const json = await res.json();
      const route0 = json?.routes?.[0] ?? null;
      const geom = route0?.geometry ?? null;
      let paradesMapVisual = null;
      if (geom?.coordinates?.length >= 2 && ruta.entregues.length > 0) {
        paradesMapVisual = ruta.entregues.map((e) => {
          const lon = Number(e.coordenades?.x);
          const lat = Number(e.coordenades?.y);
          const q = puntMesProperASobrePolilinia(lon, lat, geom.coordinates);
          return { x: q.lon, y: q.lat };
        });
      }
      data.push({
        camio: ruta.camio.id,
        geometria: geom,
        paradesMapVisual,
        distanciaMetres: Number(route0?.distance ?? 0),
        duradaSegons: Number(route0?.duration ?? 0),
      });
    } catch {
      data.push({
        camio: ruta.camio.id,
        geometria: null,
        paradesMapVisual: null,
        distanciaMetres: 0,
        duradaSegons: 0,
      });
    }
  }
  return data;
}

function serialitzaPedidoHtml(p) {
  return {
    nom: p.nom,
    volumPerCaixa: p.volumPerCaixa,
    quantitatCaixes: p.quantitatCaixes,
    volumTotal: p.volumTotal,
  };
}

async function generaHtml({
  centre,
  liniesTotals,
  previewAgrupacio,
  resultat,
  visualData,
}) {
  const outputDir = path.join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'prova-joc-pedidos-entregues.html');

  const noAssignadesDetall = resultat.entreguesNoAssignades.map((e) => ({
    id: e.identificador,
    codi: e.motiuNoAssignacio?.codi ?? '',
  }));

  const viatgesPerCamio = Object.create(null);
  const rutesVisual = resultat.rutes.map((ruta) => {
    const idCamio = ruta.camio?.id ?? '?';
    viatgesPerCamio[idCamio] = (viatgesPerCamio[idCamio] || 0) + 1;
    const tripSeq = viatgesPerCamio[idCamio];
    return {
      camio: ruta.camio,
      tripSeq,
      horaSortidaMagatzem: ruta.horaSortidaMagatzem,
      horaTornadaMagatzem: ruta.horaTornadaMagatzem,
      entregues: ruta.entregues.map((e, idx) => ({
        ordre: idx + 1,
        id: e.identificador,
        nomClient: e.identificador,
        x: e.coordenades.x,
        y: e.coordenades.y,
        arribada: e.arribadaHora,
        franja: `${e.horaInici ?? '--'}-${e.horaFinal ?? '--'}`,
        volumTotalEntrega: Number(e.volumTotal ?? 0),
        pedidos: (e.pedidos || []).map(serialitzaPedidoHtml),
      })),
    };
  });

  const payload = JSON.stringify({
    centre,
    liniesTotals,
    previewAgrupacio,
    rutes: rutesVisual,
    visualData,
    noAssignades: resultat.entreguesNoAssignades.length,
    noAssignadesDetall,
  });

  const html = `<!doctype html>
<html lang="ca"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Joc proves — pedidos agrupats → entregues</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#f8fafc;margin:0;color:#0f172a}
.wrap{padding:14px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:12px}
#map{height:62vh;border-radius:10px;border:1px solid #e2e8f0}
.legend{display:flex;gap:8px;flex-wrap:wrap}.pill{padding:4px 8px;border:1px solid #e2e8f0;border-radius:999px;font-size:12px}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.toolbar select{padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}th{background:#f1f5f9}
.pill.filtered{opacity:0.35}.small{margin:0;color:#64748b;font-size:13px}
.mono{font-family:ui-monospace,Courier New,monospace;font-size:12px}
.subtable{font-size:12px;background:#f8fafc}
.subtable th{font-weight:600}
</style></head>
<body><div class="wrap">
<div class="card"><h2 style="margin:0 0 8px">Joc de proves: línies → agrupació → rutes</h2><div id="meta"></div><div id="noAssignWrap" style="margin-top:10px;font-size:13px"></div></div>

<div class="card"><h3 style="margin:0 0 8px">1. Catàleg de línies de comanda (entrada)</h3>
<p class="small">Cada fila és una línia amb referència, producte, client, adreça, franja i quantitats.</p>
<table><thead><tr><th>Línia</th><th>Ref. pedido</th><th>Producte</th><th>Marca</th><th>Família</th><th>Tipus</th><th class="mono">Vol/u</th><th class="mono">Qt</th><th class="mono">CE línia</th><th>Client</th><th>Adreça</th><th>Franja</th><th>Hora línia</th><th>Observacions</th></tr></thead><tbody id="tbodyLinies"></tbody></table></div>

<div class="card"><h3 style="margin:0 0 8px">2. Entregues agrupades (adreça + franja)</h3>
<p class="small">Mateixa clau que «ubicació + finestra» a l’Excel: una entrega pot tenir diverses línies.</p>
<table><thead><tr><th>Entrega</th><th>Adreça</th><th class="mono">CE total</th><th>Franja</th><th># línies</th></tr></thead><tbody id="tbodyAgrup"></tbody></table>
<div id="detallAgrup"></div></div>

<div class="card">
<div class="toolbar"><label for="routeSelector"><strong>Mapa — mostra:</strong></label>
<select id="routeSelector"><option value="all">Totes les rutes</option></select></div>
<div class="legend" id="legend"></div><div id="map"></div></div>

<div class="card"><h3 style="margin:0 0 8px">Resum per ruta</h3><table><thead><tr><th>Camió</th><th>Viatge</th><th>Sortida</th><th>Tornada</th><th>KM</th><th>Parades</th></tr></thead><tbody id="tbodyRutes"></tbody></table></div>

<div class="card"><h3 style="margin:0 0 8px">Parades i línies de pedido assignades</h3>
<table><thead><tr><th>Camió</th><th>Viatge</th><th>Ordre</th><th>Entrega</th><th class="mono">CE</th><th>Arribada</th><th>Franja</th></tr></thead><tbody id="tbody"></tbody></table></div>

<div class="card"><h3 style="margin:0 0 8px">Detall pedidos per parada</h3><p class="small">Dades del model <code>Pedido</code> (nom, volum per unitat, quantitat, CE línia) després de l’agrupació.</p>
<table><thead><tr><th>Camió</th><th>Viatge</th><th>Parada</th><th>Pedido</th><th class="mono">Qt</th><th class="mono">×</th><th class="mono">CE</th></tr></thead><tbody id="tbodyPedidosRows"></tbody></table></div>

</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=${payload};
function fmt3(n){const x=Number(n);return Number.isFinite(x)?x.toFixed(3):'';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function hashCamioId(s){let h=0;const t=String(s||'');for(let i=0;i<t.length;i+=1){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}return Math.abs(h);}
function colorPerViatge(camioId,tripSeq){const hue=hashCamioId(camioId)%360;return 'hsl('+hue+',72%,'+(36+(tripSeq-1)*9)+'%)';}

document.getElementById('meta').innerHTML=
  '<strong>Línies:</strong> '+data.liniesTotals.length+
  ' · <strong>Entregues agrupades:</strong> '+data.previewAgrupacio.length+
  ' · <strong>Rutes:</strong> '+data.rutes.length+
  ' · <strong>No assignades:</strong> '+data.noAssignades;

(function(){
  const w=document.getElementById('noAssignWrap');
  if(!data.noAssignadesDetall||!data.noAssignadesDetall.length){w.innerHTML='';return;}
  w.innerHTML='<strong>No assignades:</strong><ul style="margin:6px 0 0;padding-left:18px">'+
    data.noAssignadesDetall.map(function(r){return '<li><b>'+esc(r.id)+'</b>'+(r.codi?(' <code>'+esc(r.codi)+'</code>'):'')+'</li>';}).join('')+'</ul>';
})();

const tbL=document.getElementById('tbodyLinies');
data.liniesTotals.forEach(function(l){
  const ce=(Number(l.volumPerCaixa)*Number(l.quantitat));
  tbL.innerHTML+='<tr><td class="mono">'+esc(l.liniaId)+'</td><td class="mono">'+esc(l.referenciaPedido)+'</td><td>'+esc(l.producte)+'</td><td>'+esc(l.marca)+'</td><td>'+esc(l.familia)+'</td><td>'+esc(l.tipusCarrega)+'</td><td class="mono">'+fmt3(l.volumPerCaixa)+'</td><td class="mono">'+l.quantitat+'</td><td class="mono">'+fmt3(ce)+'</td><td>'+esc(l.idClient)+' '+esc(l.nomClient)+'</td><td>'+esc(l.adreca)+'</td><td>'+esc(l.horaIniciFranja)+'–'+esc(l.horaFinalFranja)+'</td><td>'+(l.horaIniciPedido?esc(l.horaIniciPedido):'—')+'</td><td>'+esc(l.observacions)+'</td></tr>';
});

const tbA=document.getElementById('tbodyAgrup');
const detA=document.getElementById('detallAgrup');
data.previewAgrupacio.forEach(function(bl){
  tbA.innerHTML+='<tr><td>'+esc(bl.identificador)+'</td><td>'+esc(bl.adreca)+'</td><td class="mono">'+fmt3(bl.volumTotal)+'</td><td>'+esc(bl.horaInici)+'–'+esc(bl.horaFinal)+'</td><td>'+bl.linies.length+'</td></tr>';
  let sub='<table class="subtable" style="width:100%;margin:8px 0"><thead><tr><th>Ref</th><th>Producte</th><th class="mono">CE línia</th></tr></thead><tbody>';
  bl.linies.forEach(function(l){sub+='<tr><td class="mono">'+esc(l.referenciaPedido)+'</td><td>'+esc(l.producte)+'</td><td class="mono">'+fmt3(l.volumPerCaixa*l.quantitat)+'</td></tr>';});
  sub+='</tbody></table>';
  detA.innerHTML+=sub;
});

const selector=document.getElementById('routeSelector');
const comptadorCamio={};
data.rutes.forEach(function(r){const id=r.camio.id;comptadorCamio[id]=(comptadorCamio[id]||0)+1;});
data.rutes.forEach(function(ruta,idx){
  selector.innerHTML+='<option value="'+idx+'">'+esc(ruta.camio.id)+' · viatge '+ruta.tripSeq+'</option>';
});
Object.keys(comptadorCamio).forEach(function(id){if(comptadorCamio[id]>1){selector.innerHTML+='<option value="camio:'+esc(id)+'">'+esc(id)+' (tots els viatges)</option>';}});

const map=L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
L.circleMarker([data.centre.y,data.centre.x],{radius:8,color:'#111827',fillColor:'#111827',fillOpacity:1}).addTo(map).bindPopup('Magatzem');

const boundsAll=[[data.centre.y,data.centre.x]];
const legend=document.getElementById('legend');
const tbody=document.getElementById('tbody');
const tbodyRutes=document.getElementById('tbodyRutes');
const tbodyPedidosRows=document.getElementById('tbodyPedidosRows');
const routeLayerGroups=[];
const boundsPerRoute=[];

data.rutes.forEach(function(ruta,idx){
  const g=L.layerGroup();
  routeLayerGroups.push(g);
  const color=colorPerViatge(ruta.camio.id,ruta.tripSeq);
  const routeInfo=data.visualData[idx];
  const geom=routeInfo&&routeInfo.geometria;
  const pv=routeInfo&&routeInfo.paradesMapVisual;
  const km=(Number(routeInfo&&routeInfo.distanciaMetres||0)/1000).toFixed(2);
  const bR=[[data.centre.y,data.centre.x]];
  if(geom&&geom.coordinates){
    const latlngs=geom.coordinates.map(function(c){return [c[1],c[0]];});
    L.polyline(latlngs,{color:color,weight:4,opacity:0.88}).addTo(g);
    latlngs.forEach(function(ll){bR.push(ll);});
  }
  legend.innerHTML+='<span class="pill legend-pill" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'" style="border-color:'+color+';color:'+color+'">'+esc(ruta.camio.id)+' · viatge '+ruta.tripSeq+' · '+km+' km</span>';
  const par=ruta.entregues.map(function(e){return e.id;}).join(', ');
  tbodyRutes.innerHTML+='<tr class="row-ruta" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'"><td>'+esc(ruta.camio.id)+'</td><td>'+ruta.tripSeq+'</td><td>'+esc(ruta.horaSortidaMagatzem||'--')+'</td><td>'+esc(ruta.horaTornadaMagatzem||'--')+'</td><td>'+km+'</td><td>'+esc(par)+'</td></tr>';

  ruta.entregues.forEach(function(e,ei){
    const mx=(pv&&pv[ei])?pv[ei].x:e.x;
    const my=(pv&&pv[ei])?pv[ei].y:e.y;
    let pop='<b>'+esc(ruta.camio.id)+'</b> · viatge '+ruta.tripSeq+'<br>#'+e.ordre+' '+esc(e.id)+'<br>CE '+fmt3(e.volumTotalEntrega)+'<br>Arribada '+(e.arribada||'--');
    if(e.pedidos&&e.pedidos.length){pop+='<hr style="margin:6px 0"/>';e.pedidos.forEach(function(pd){pop+='<div style="font-size:11px">'+esc(pd.nom)+' · '+fmt3(pd.volumTotal)+' CE</div>';});}
    L.circleMarker([my,mx],{radius:5,color:color,fillColor:color,fillOpacity:0.9}).addTo(g).bindPopup(pop);
    boundsAll.push([my,mx]);
    bR.push([my,mx]);
    tbody.innerHTML+='<tr class="row-detall" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'"><td>'+esc(ruta.camio.id)+'</td><td>'+ruta.tripSeq+'</td><td>'+e.ordre+'</td><td>'+esc(e.id)+'</td><td class="mono">'+fmt3(e.volumTotalEntrega)+'</td><td>'+esc(e.arribada||'--')+'</td><td>'+esc(e.franja)+'</td></tr>';
    (e.pedidos||[]).forEach(function(pd,li){
      tbodyPedidosRows.innerHTML+='<tr class="row-pedido row-detall" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'"><td>'+esc(ruta.camio.id)+'</td><td>'+ruta.tripSeq+'</td><td>'+e.ordre+'</td><td>'+esc(pd.nom)+'</td><td class="mono">'+(pd.quantitatCaixes)+'</td><td class="mono">'+fmt3(pd.volumPerCaixa)+'</td><td class="mono">'+fmt3(pd.volumTotal)+'</td></tr>';
    });
  });
  boundsPerRoute.push(bR);
});
routeLayerGroups.forEach(function(g){g.addTo(map);});

function applyRouteFilter(val){
  const showAll=(val==='all');
  const camioPrefix='camio:';
  const filtreCamio=(typeof val==='string'&&val.indexOf(camioPrefix)===0)?val.slice(camioPrefix.length):null;
  routeLayerGroups.forEach(function(g,i){
    const r=data.rutes[i];
    let vis=showAll;
    if(!showAll&&filtreCamio!==null)vis=r.camio.id===filtreCamio;
    else if(!showAll)vis=String(i)===String(val);
    if(vis)map.addLayer(g);else map.removeLayer(g);
  });
  document.querySelectorAll('.legend-pill').forEach(function(p){
    let on=showAll;
    if(!showAll&&filtreCamio!==null)on=p.dataset.camio===filtreCamio;
    else if(!showAll)on=p.dataset.route===String(val);
    p.classList.toggle('filtered',!on);
  });
  document.querySelectorAll('.row-ruta,.row-detall,.row-pedido').forEach(function(tr){
    let on=showAll;
    if(!showAll&&filtreCamio!==null)on=tr.dataset.camio===filtreCamio;
    else if(!showAll)on=tr.dataset.route===String(val);
    tr.style.display=on?'':'none';
  });
  if(showAll){if(boundsAll.length)map.fitBounds(boundsAll,{padding:[20,20]});}
  else if(filtreCamio!==null){
    var acc=[];
    data.rutes.forEach(function(r,i){if(r.camio.id===filtreCamio)(boundsPerRoute[i]||[]).forEach(function(ll){acc.push(ll);});});
    if(acc.length)map.fitBounds(acc,{padding:[30,30]});
  }else{
    var ix=parseInt(val,10);
    var bp=boundsPerRoute[ix];
    if(bp&&bp.length)map.fitBounds(bp,{padding:[30,30]});
  }
}
document.getElementById('routeSelector').addEventListener('change',function(e){applyRouteFilter(e.target.value);});
if(boundsAll.length)map.fitBounds(boundsAll,{padding:[20,20]});
</script></body></html>`;

  await writeFile(outputPath, html, 'utf8');
  return outputPath;
}

async function main() {
  console.log(`Generant ${N_ESTABLIMENTS} punts sobre vial (~${RADI_KM} km del centre Mollet), catàleg de línies i agrupació…`);

  const coords = await generaPuntsSobreCarrerRodona(N_ESTABLIMENTS, {
    fetchImpl: fetch,
    centreRodona: MOLLET_CENTRE_RODONA,
    radiKm: RADI_KM,
    excloureZonaMuntanya: false,
  });

  const punts = coords.map((c, i) => ({
    nom: `Mollet rodona · punt ${i + 1}`,
    x: c.x,
    y: c.y,
  }));

  const liniesTotals = generaLiniesComanda(punts);
  const agrupat = agrupaLiniesAEntregues(liniesTotals);
  const entregues = agrupat.map((x) => x.entrega);

  console.log(`Línies de comanda: ${liniesTotals.length}`);
  console.log(`Entregues agrupades: ${agrupat.length}`);

  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  const resultat = await generarRutes(entregues, flota, MAGATZEM, {
    velocitatKmH: 32,
    usaMock: true,
    EntregaClass: Entrega,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
    assignacioCompleta: true,
  });

  const previewAgrupacio = agrupat.map(({ entrega, liniesGrup }) => ({
    identificador: entrega.identificador,
    adreca: entrega.adreca,
    volumTotal: entrega.volumTotal,
    horaInici: entrega.horaInici,
    horaFinal: entrega.horaFinal,
    linies: liniesGrup.map((l) => ({
      referenciaPedido: l.referenciaPedido,
      producte: l.producte,
      volumPerCaixa: l.volumPerCaixa,
      quantitat: l.quantitat,
    })),
  }));

  const visualData = await calculaGeometriesRutes(resultat.rutes, MAGATZEM);

  const outputPath = await generaHtml({
    centre: MAGATZEM,
    liniesTotals,
    previewAgrupacio,
    resultat,
    visualData,
  });

  console.log(`Rutes: ${resultat.rutes.length} · No assignades: ${resultat.entreguesNoAssignades.length}`);
  console.log(`HTML: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
