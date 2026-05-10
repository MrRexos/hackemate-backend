/**
 * 100 entregues aleatòries (BCN, sobre vial) → `generarRutes` (sweep) → HTML amb mapa OSRM + taules.
 *
 * Ús:
 *   npm run prova:100-bcn-html
 *
 * Sortida: `output/prova-100-bcn.html` (relativa a l’arrel del backend).
 *
 * La geometria del mapa es calcula **tram per tram** (magatzem→parada→…→magatzem) per no sobrepassar
 * el límit de URL d’OSRM ni obtenir polilínies truncades (que podien dibuixar rutes absurdes, p. ex. cap a Itàlia).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { Pedido } from '../models/logistica/classes/pedido.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import { BCN_BBOX_CARRER, generaPuntsSobreCarrer } from './utils/punts-sobre-carrer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arrelBackend = path.join(__dirname, '..', '..');

const N_ENTREGUES = 350;

/** Centre aproximat del bbox urbà BCN (lon, lat). */
const MAGATZEM_BCN = { x: 2.1585, y: 41.3865 };

const OSRM_BASE = 'https://router.project-osrm.org';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const OSRM_ENTRE_TRAMS_MS = 40;

/**
 * Assegura convenció x = lon, y = lat (corrigeix lat/lon invertits típics en punts ~BCN).
 */
function normalitzaLonLatPunt(p) {
  if (!p || p.x == null || p.y == null) return null;
  let x = Number(p.x);
  let y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x >= 36 && x <= 45 && y >= -10 && y <= 10) {
    return { x: y, y: x };
  }
  return { x, y };
}

async function fetchOsrmUnTram(pA, pB, fetchImpl = fetch) {
  const coords = `${pA.x},${pA.y};${pB.x},${pB.y}`;
  const url = new URL(`${OSRM_BASE}/route/v1/driving/${coords}`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'false');

  const res = await fetchImpl(url);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.[0]?.geometry) {
    return null;
  }
  return json.routes[0];
}

function fusionaLineStrings(geometries) {
  const coordinates = [];
  for (const g of geometries) {
    const ring = g?.coordinates;
    if (!Array.isArray(ring) || ring.length === 0) continue;
    if (coordinates.length === 0) {
      coordinates.push(...ring);
    } else {
      coordinates.push(...ring.slice(1));
    }
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

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
  const centreN = normalitzaLonLatPunt(centre) ?? centre;
  const data = [];

  for (const ruta of rutes) {
    try {
      const puntsNormalitzats = [centreN];
      for (const e of ruta.entregues) {
        const q = normalitzaLonLatPunt(e.coordenades);
        puntsNormalitzats.push(q ?? e.coordenades);
      }
      puntsNormalitzats.push(centreN);

      const geometries = [];
      let distanciaMetres = 0;
      const nLegs = puntsNormalitzats.length - 1;
      let legsOk = true;

      for (let i = 0; i < nLegs; i += 1) {
        if (i > 0 && OSRM_ENTRE_TRAMS_MS > 0) {
          await pausa(OSRM_ENTRE_TRAMS_MS);
        }
        const a = puntsNormalitzats[i];
        const b = puntsNormalitzats[i + 1];
        const routeLeg = await fetchOsrmUnTram(a, b, fetch);
        if (!routeLeg) {
          legsOk = false;
          break;
        }
        geometries.push(routeLeg.geometry);
        distanciaMetres += Number(routeLeg.distance ?? 0);
      }

      const geom = legsOk && geometries.length === nLegs ? fusionaLineStrings(geometries) : null;
      if (!legsOk) distanciaMetres = 0;
      let paradesMapVisual = null;
      if (geom?.coordinates?.length >= 2 && ruta.entregues.length > 0) {
        paradesMapVisual = ruta.entregues.map((e) => {
          const c = normalitzaLonLatPunt(e.coordenades) ?? e.coordenades;
          const lon = Number(c.x);
          const lat = Number(c.y);
          const q = puntMesProperASobrePolilinia(lon, lat, geom.coordinates);
          return { x: q.lon, y: q.lat };
        });
      }

      data.push({
        camio: ruta.camio.id,
        geometria: geom,
        paradesMapVisual,
        distanciaMetres,
      });
    } catch {
      data.push({
        camio: ruta.camio.id,
        geometria: null,
        paradesMapVisual: null,
        distanciaMetres: 0,
      });
    }
  }
  return data;
}

async function generaCentEntreguesAleatoriesBarcelona() {
  const punts = await generaPuntsSobreCarrer(N_ENTREGUES, {
    bbox: BCN_BBOX_CARRER,
    fetchImpl: fetch,
  });

  return punts.map((p, i) => {
    const mod = i % 3;
    const franges =
      mod === 0
        ? { ini: '09:00', fi: '13:30' }
        : mod === 1
          ? { ini: '14:00', fi: '19:00' }
          : { ini: '08:30', fi: '19:30' };
    const volum = 6 + (i % 5);
    const quantitat = 1 + (i % 4);

    return new Entrega({
      identificador: `BCN-${String(i + 1).padStart(3, '0')}`,
      adreca: `Barcelona (aleatori) · punt ${i + 1}`,
      coordenades: { x: p.x, y: p.y },
      horaInici: franges.ini,
      horaFinal: franges.fi,
      pedidos: [
        new Pedido({
          nom: `Article ${i + 1}`,
          volum,
          quantitat,
        }),
      ],
    });
  });
}

function construeixPayloadVisual(resultat, visualData, centre, totalEntreguesGenerades) {
  const viatgesPerCamio = Object.create(null);

  const rutesVisual = resultat.rutes.map((ruta, rutaIdx) => {
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
        x: e.coordenades.x,
        y: e.coordenades.y,
        arribada: e.arribadaHora ?? e.horaDEntrega ?? '—',
        franja: `${e.horaInici ?? '--'}–${e.horaFinal ?? '--'}`,
        volumTotalEntrega: Number(e.volumTotal ?? 0),
        pedidos: (e.pedidos || []).map((p) => ({
          nom: p.nom,
          volumPerCaixa: p.volumPerCaixa,
          quantitatCaixes: p.quantitatCaixes,
          volumTotal: p.volumTotal,
        })),
      })),
      indexOriginal: rutaIdx,
    };
  });

  return {
    centre,
    titol: `${N_ENTREGUES} entregues aleatòries Barcelona`,
    rutes: rutesVisual,
    visualData,
    noAssignades: resultat.entreguesNoAssignades.length,
    noAssignadesDetall: resultat.entreguesNoAssignades.map((e) => ({
      id: e.identificador,
    })),
    entreguesTotals: totalEntreguesGenerades,
    assignades: totalEntreguesGenerades - resultat.entreguesNoAssignades.length,
  };
}

async function generaHtml(payload) {
  const dirSortida = path.join(arrelBackend, 'output');
  await mkdir(dirSortida, { recursive: true });
  const outputPath = path.join(dirSortida, 'prova-100-bcn.html');

  const jsonStr = JSON.stringify(payload);

  const html = `<!doctype html>
<html lang="ca"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>100 entregues BCN — sweep</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;background:#f8fafc;margin:0;color:#0f172a}
.wrap{padding:14px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:12px}
#map{height:65vh;border-radius:10px;border:1px solid #e2e8f0}
.legend{display:flex;gap:8px;flex-wrap:wrap}.pill{padding:4px 8px;border:1px solid #e2e8f0;border-radius:999px;font-size:12px}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.toolbar select{padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}th{background:#f1f5f9}
.pill.filtered{opacity:0.35}.small{margin:0;color:#64748b;font-size:13px}
.mono{font-family:ui-monospace,Courier New,monospace;font-size:12px}
</style></head>
<body><div class="wrap">
<div class="card"><h2 style="margin:0 0 8px">${payload.titol}</h2>
<p class="small">Magatzem · Algoritme <code>generarRutes</code> (sweep optimizer)</p>
<div id="meta"></div>
<div id="noAssignWrap" style="margin-top:10px;font-size:13px"></div></div>

<div class="card">
<div class="toolbar"><label for="routeSelector"><strong>Mapa:</strong></label>
<select id="routeSelector"><option value="all">Totes les rutes</option></select></div>
<div class="legend" id="legend"></div><div id="map"></div></div>

<div class="card"><h3 style="margin:0 0 8px">Resum per ruta</h3>
<table><thead><tr><th>Camió</th><th>Viatge</th><th>Sortida</th><th>Tornada</th><th>KM OSRM</th><th>Parades</th></tr></thead><tbody id="tbodyRutes"></tbody></table></div>

<div class="card"><h3 style="margin:0 0 8px">Parades</h3>
<table><thead><tr><th>Camió</th><th>#</th><th>Entrega</th><th class="mono">Vol</th><th>Arribada</th><th>Franja</th></tr></thead><tbody id="tbody"></tbody></table></div>

</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=${jsonStr};
function fmt3(n){const x=Number(n);return Number.isFinite(x)?x.toFixed(3):'';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function hashCamioId(s){let h=0;const t=String(s||'');for(let i=0;i<t.length;i+=1){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}return Math.abs(h);}
function colorPerViatge(camioId,tripSeq){const hue=hashCamioId(camioId)%360;return 'hsl('+hue+',72%,'+(36+(tripSeq-1)*9)+'%)';}

document.getElementById('meta').innerHTML=
  '<strong>Entregues (generades):</strong> '+data.entreguesTotals+
  ' · <strong>Assignades:</strong> '+data.assignades+
  ' · <strong>Rutes:</strong> '+data.rutes.length+
  ' · <strong>No assignades:</strong> '+data.noAssignades;

(function(){
  const w=document.getElementById('noAssignWrap');
  if(!data.noAssignadesDetall||!data.noAssignadesDetall.length){w.innerHTML='';return;}
  w.innerHTML='<strong>No assignades:</strong><ul style="margin:6px 0 0;padding-left:18px">'+
    data.noAssignadesDetall.map(function(r){return '<li><b>'+esc(r.id)+'</b></li>';}).join('')+'</ul>';
})();

const selector=document.getElementById('routeSelector');
const comptadorCamio={};
data.rutes.forEach(function(r){const id=r.camio.id;comptadorCamio[id]=(comptadorCamio[id]||0)+1;});
data.rutes.forEach(function(ruta,idx){
  selector.innerHTML+='<option value="'+idx+'">'+esc(ruta.camio.id)+' · viatge '+ruta.tripSeq+'</option>';
});
Object.keys(comptadorCamio).forEach(function(id){if(comptadorCamio[id]>1){selector.innerHTML+='<option value="camio:'+esc(id)+'">'+esc(id)+' (tots)</option>';}});

const map=L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
L.circleMarker([data.centre.y,data.centre.x],{radius:8,color:'#111827',fillColor:'#111827',fillOpacity:1}).addTo(map).bindPopup('Magatzem');

const boundsAll=[[data.centre.y,data.centre.x]];
const legend=document.getElementById('legend');
const tbody=document.getElementById('tbody');
const tbodyRutes=document.getElementById('tbodyRutes');
const routeLayerGroups=[];
const boundsPerRoute=[];

data.rutes.forEach(function(ruta,idx){
  const g=L.layerGroup();
  routeLayerGroups.push(g);
  const color=colorPerViatge(ruta.camio.id,ruta.tripSeq);
  const routeInfo=data.visualData[idx];
  const geom=routeInfo&&routeInfo.geometria;
  const pv=routeInfo&&routeInfo.paradesMapVisual;
  const kmOsrm=(Number(routeInfo&&routeInfo.distanciaMetres||0)/1000).toFixed(2);
  const bR=[[data.centre.y,data.centre.x]];
  if(geom&&geom.coordinates){
    const latlngs=geom.coordinates.map(function(c){return [c[1],c[0]];});
    L.polyline(latlngs,{color:color,weight:4,opacity:0.88}).addTo(g);
    latlngs.forEach(function(ll){bR.push(ll);});
  }
  legend.innerHTML+='<span class="pill legend-pill" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'" style="border-color:'+color+';color:'+color+'">'+esc(ruta.camio.id)+' · '+kmOsrm+' km</span>';

  const par=ruta.entregues.map(function(e){return e.id;}).join(', ');
  tbodyRutes.innerHTML+='<tr class="row-ruta" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'"><td>'+esc(ruta.camio.id)+'</td><td>'+ruta.tripSeq+'</td><td>'+esc(ruta.horaSortidaMagatzem||'—')+'</td><td>'+esc(ruta.horaTornadaMagatzem||'—')+'</td><td class="mono">'+kmOsrm+'</td><td class="small">'+esc(par)+'</td></tr>';

  ruta.entregues.forEach(function(e,ei){
    const mx=(pv&&pv[ei])?pv[ei].x:e.x;
    const my=(pv&&pv[ei])?pv[ei].y:e.y;
    L.circleMarker([my,mx],{radius:5,color:color,fillColor:color,fillOpacity:0.9}).addTo(g).bindPopup('<b>'+esc(ruta.camio.id)+'</b> #'+e.ordre+' '+esc(e.id)+'<br>Vol '+fmt3(e.volumTotalEntrega)+'<br>'+esc(e.arribada));
    boundsAll.push([my,mx]);
    bR.push([my,mx]);
    tbody.innerHTML+='<tr class="row-detall" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'"><td>'+esc(ruta.camio.id)+'</td><td>'+e.ordre+'</td><td>'+esc(e.id)+'</td><td class="mono">'+fmt3(e.volumTotalEntrega)+'</td><td>'+esc(e.arribada)+'</td><td>'+esc(e.franja)+'</td></tr>';
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
  document.querySelectorAll('.row-ruta,.row-detall').forEach(function(tr){
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
  console.log(`Generant ${N_ENTREGUES} punts sobre carrer dins BCN_BBOX_CARRER…`);
  const entregues = await generaCentEntreguesAleatoriesBarcelona();
  const flota = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  console.log('Executant generarRutes (sweep)…');
  const resultat = await generarRutes(entregues, flota, MAGATZEM_BCN, {
    EntregaClass: Entrega,
    usaMock: true,
    assignacioCompleta: true,
    optimIntraRutaCarrers: true,
  });

  console.log('Calculant geometria OSRM per al mapa…');
  const visualData = await calculaGeometriesRutes(resultat.rutes, MAGATZEM_BCN);
  const payload = construeixPayloadVisual(resultat, visualData, MAGATZEM_BCN, entregues.length);
  const outputPath = await generaHtml(payload);

  const assignades = entregues.length - resultat.entreguesNoAssignades.length;
  console.log(`Assignades: ${assignades} / ${entregues.length}`);
  console.log(`Rutes: ${resultat.rutes.length} · No assignades: ${resultat.entreguesNoAssignades.length}`);
  console.log(`HTML: ${outputPath}`);
}

const execDesDelCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (execDesDelCli) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { main, generaCentEntreguesAleatoriesBarcelona };
