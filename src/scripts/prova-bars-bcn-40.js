import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import {
  generaPuntsSobreCarrerRodona,
  MOLLET_CENTRE_RODONA,
  MOLLET_MAGATZEM_AFORES,
} from './utils/punts-sobre-carrer.js';

const CENTRE = { ...MOLLET_MAGATZEM_AFORES };
const NUM_PUNTS = 200;
const NOM_MAGATZEM = 'Afores Mollet del Vallès';
const RADI_RODONA_KM = 20;

async function main() {
  console.log(
    `Generant ${NUM_PUNTS} punts sobre vial dins ${RADI_RODONA_KM} km de Mollet (OSRM); magatzem: ${NOM_MAGATZEM}...`,
  );
  const coords = await generaPuntsSobreCarrerRodona(NUM_PUNTS, {
    fetchImpl: fetch,
    centreRodona: MOLLET_CENTRE_RODONA,
    radiKm: RADI_RODONA_KM,
    excloureZonaMuntanya: false,
  });
  const punts = coords.map((c, i) => ({ nom: `Bar carrer ${i + 1}`, x: c.x, y: c.y }));
  const entregues = creaEntregues(punts);
  const flotaCamions = FLOTA_EXEMPLE_15_CAMIONS.perOptimizador();

  const resultat = await generarRutes(entregues, flotaCamions, CENTRE, {
    velocitatKmH: 32,
    usaMock: true,
    EntregaClass: Entrega,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
    assignacioCompleta: true,
  });

  const visualData = await calculaGeometriesRutes(resultat.rutes, CENTRE);
  const outputPath = await generaVisualHtml({ centre: CENTRE, resultat, visualData });

  console.log(`=== Ruta bars: sortida ${NOM_MAGATZEM} · ${NUM_PUNTS} parades ≤${RADI_RODONA_KM} km de Mollet ===`);
  console.log(`Punts totals: ${NUM_PUNTS}`);
  console.log(`Camions maxims: ${flotaCamions.length}`);
  console.log(`Rutes generades: ${resultat.rutes.length}`);
  console.log(`No assignades: ${resultat.entreguesNoAssignades.length}`);
  if (resultat.entreguesNoAssignades.length > 0) {
    console.log('\nMotius (no assignades):');
    resultat.entreguesNoAssignades.forEach((e) => {
      console.log(` - ${e.identificador ?? '?'} | ${e.motiuNoAssignacio?.codi ?? ''}`);
    });
  }
  console.log(`\nMapa visual generat a: ${outputPath}`);
}

function creaEntregues(punts) {
  return punts.map((p, idx) => {
    const pedidos = [
      { nom: 'Beguda', volum: 1 + (idx % 3), quantitat: 3 + (idx % 4) },
      { nom: 'Menjar', volum: 1, quantitat: 2 + (idx % 3) },
    ];

    let horaInici = null;
    let horaFinal = null;
    if (idx % 3 === 0) {
      horaInici = '09:00';
      horaFinal = '13:30';
    } else if (idx % 3 === 1) {
      horaInici = '15:30';
      horaFinal = '20:00';
    }

    return new Entrega({
      identificador: `BAR-${String(idx + 1).padStart(2, '0')}`,
      adreca: p.nom,
      pedidos,
      horaInici,
      horaFinal,
      coordenades: { x: p.x, y: p.y },
    });
  });
}

/** Punt més proper sobre una polilínia GeoJSON [lon,lat][] (aprox. pla, vàlid per ~desenes de km). */
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

async function generaVisualHtml({ centre, resultat, visualData }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputDir = path.join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'bars-mollet-20km-sweep.html');

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
        x: e.coordenades.x,
        y: e.coordenades.y,
        arribada: e.arribadaHora,
        franja: `${e.horaInici ?? '--'}-${e.horaFinal ?? '--'}`,
      })),
    };
  });

  const payload = JSON.stringify({
    centre,
    rutes: rutesVisual,
    visualData,
    noAssignades: resultat.entreguesNoAssignades.length,
    noAssignadesDetall,
  });

  const html = `<!doctype html>
<html lang="ca"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Sweep — Mollet (20 km)</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#f8fafc;margin:0;color:#0f172a}
.wrap{padding:14px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:12px}
#map{height:70vh;border-radius:10px;border:1px solid #e2e8f0}
.legend{display:flex;gap:8px;flex-wrap:wrap}.pill{padding:4px 8px;border:1px solid #e2e8f0;border-radius:999px;font-size:12px}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.toolbar select{padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}th{background:#f1f5f9}
.pill.filtered{opacity:0.35}
.small{margin:0}
</style></head>
<body><div class="wrap">
<div class="card"><h2 style="margin:0 0 8px">Sweep — magatzem afores Mollet · parades ≤20 km (vial OSRM)</h2><div id="meta"></div><div id="noAssignWrap" style="margin-top:10px;font-size:13px"></div></div>
<div class="card">
<div class="toolbar">
<label for="routeSelector"><strong>Mostra:</strong></label>
<select id="routeSelector"><option value="all">Totes les rutes</option></select>
</div>
<div class="legend" id="legend"></div><div id="map"></div></div>
<div class="card"><h3 style="margin:0 0 8px">Resum per ruta</h3><p class="small" style="margin:0 0 8px;color:#64748b;font-size:13px">Cada viatge surt i torna al magatzem (OSRM). El mateix camió amb diversos torns es veu amb colors diferents.</p><table><thead><tr><th>Camio</th><th>Viatge</th><th>Sortida magatzem</th><th>Tornada</th><th>KM ruta</th><th>Entregues</th></tr></thead><tbody id="tbodyRutes"></tbody></table></div>
<div class="card"><h3 style="margin:0 0 8px">Entregues per camio</h3><table><thead><tr><th>Camio</th><th>#</th><th>Entrega</th><th>Arribada</th><th>Franja</th></tr></thead><tbody id="tbody"></tbody></table></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=${payload};
function hashCamioId(s){
  let h=0;const t=String(s||'');
  for(let i=0;i<t.length;i+=1){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}
  return Math.abs(h);
}
function colorPerViatge(camioId,tripSeq){
  const hue=hashCamioId(camioId)%360;
  const sat=72;
  const light=Math.max(30,Math.min(58,36+(tripSeq-1)*9));
  return 'hsl('+hue+','+sat+'%,'+light+'%)';
}
document.getElementById('meta').textContent='Rutes: '+data.rutes.length+' · No assignades: '+data.noAssignades;
(function(){
  const w=document.getElementById('noAssignWrap');
  if(!data.noAssignadesDetall||!data.noAssignadesDetall.length){w.innerHTML='';return;}
  w.innerHTML='<strong>No assignades:</strong><ul style="margin:6px 0 0;padding-left:18px">'+
    data.noAssignadesDetall.map(function(r){return '<li><b>'+r.id+'</b>'+(r.codi?(' <code>'+r.codi+'</code>'):'')+'</li>';}).join('')+'</ul>';
})();
const selector=document.getElementById('routeSelector');
const comptadorCamio={};
data.rutes.forEach((ruta)=>{const id=ruta.camio.id;comptadorCamio[id]=(comptadorCamio[id]||0)+1;});
data.rutes.forEach((ruta,idx)=>{
  selector.innerHTML+=\`<option value="\${idx}">\${ruta.camio.id} · viatge \${ruta.tripSeq}</option>\`;
});
Object.keys(comptadorCamio).forEach((id)=>{if(comptadorCamio[id]>1){selector.innerHTML+=\`<option value="camio:\${id}">\${id} (tots els viatges)</option>\`;}});
const map=L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
const warehouse=L.circleMarker([data.centre.y,data.centre.x],{radius:8,color:'#111827',fillColor:'#111827',fillOpacity:1}).addTo(map).bindPopup('Magatzem (afores Mollet)');
const boundsAll=[];
boundsAll.push([data.centre.y,data.centre.x]);
const legend=document.getElementById('legend');
const tbody=document.getElementById('tbody');
const tbodyRutes=document.getElementById('tbodyRutes');
const routeLayerGroups=[];
const boundsPerRoute=[];
data.rutes.forEach((ruta,idx)=>{
  const g=L.layerGroup();
  routeLayerGroups.push(g);
  const color=colorPerViatge(ruta.camio.id,ruta.tripSeq);
  const routeInfo=data.visualData[idx];
  const geom=routeInfo?.geometria;
  const pv=routeInfo?.paradesMapVisual;
  const km=((Number(routeInfo?.distanciaMetres||0))/1000).toFixed(2);
  const bR=[[data.centre.y,data.centre.x]];
  if(geom&&geom.coordinates){
    const latlngs=geom.coordinates.map(c=>[c[1],c[0]]);
    L.polyline(latlngs,{color,weight:4,opacity:0.88}).addTo(g);
    latlngs.forEach(ll=>bR.push(ll));
  }
  legend.innerHTML+=\`<span class="pill legend-pill" data-route="\${idx}" data-camio="\${ruta.camio.id}" style="border-color:\${color};color:\${color}">\${ruta.camio.id} · viatge \${ruta.tripSeq} · \${km} km</span>\`;
  const entreguesNom=\`[\${ruta.entregues.map(e=>e.id).join(', ')}]\`;
  tbodyRutes.innerHTML+=\`<tr class="row-ruta" data-route="\${idx}" data-camio="\${ruta.camio.id}"><td>\${ruta.camio.id}</td><td>\${ruta.tripSeq}</td><td>\${ruta.horaSortidaMagatzem||'--:--'}</td><td>\${ruta.horaTornadaMagatzem||'--:--'}</td><td>\${km}</td><td>\${entreguesNom}</td></tr>\`;
  ruta.entregues.forEach((e,ei)=>{
    const mx=(pv&&pv[ei])?pv[ei].x:e.x;
    const my=(pv&&pv[ei])?pv[ei].y:e.y;
    L.circleMarker([my,mx],{radius:5,color,fillColor:color,fillOpacity:0.9}).addTo(g).bindPopup('<b>'+ruta.camio.id+'</b> · viatge '+ruta.tripSeq+'<br>#'+e.ordre+' '+e.id+'<br>Arribada '+(e.arribada||'--:--')); 
    boundsAll.push([my,mx]);
    bR.push([my,mx]);
    tbody.innerHTML+=\`<tr class="row-detall" data-route="\${idx}" data-camio="\${ruta.camio.id}"><td>\${ruta.camio.id} · \${ruta.tripSeq}</td><td>\${e.ordre}</td><td>\${e.id}</td><td>\${e.arribada||'--:--'}</td><td>\${e.franja}</td></tr>\`;
  });
  boundsPerRoute.push(bR);
});
routeLayerGroups.forEach(g=>g.addTo(map));
function applyRouteFilter(val){
  const showAll=(val==='all');
  const camioPrefix='camio:';
  const filtreCamio=typeof val==='string'&&val.indexOf(camioPrefix)===0?val.slice(camioPrefix.length):null;
  routeLayerGroups.forEach((g,i)=>{
    const r=data.rutes[i];
    let vis=showAll;
    if(!showAll&&filtreCamio!==null)vis=r.camio.id===filtreCamio;
    else if(!showAll)vis=String(i)===String(val);
    if(vis)map.addLayer(g);else map.removeLayer(g);
  });
  warehouse.addTo(map);
  document.querySelectorAll('.legend-pill').forEach(p=>{
    let on=showAll;
    if(!showAll&&filtreCamio!==null)on=p.dataset.camio===filtreCamio;
    else if(!showAll)on=p.dataset.route===String(val);
    p.classList.toggle('filtered',!on);
  });
  document.querySelectorAll('.row-ruta,.row-detall').forEach(tr=>{
    let on=showAll;
    if(!showAll&&filtreCamio!==null)on=tr.dataset.camio===filtreCamio;
    else if(!showAll)on=tr.dataset.route===String(val);
    tr.style.display=on?'':'none';
  });
  if(showAll){if(boundsAll.length){map.fitBounds(boundsAll,{padding:[20,20]});}}
  else if(filtreCamio!==null){
    const acc=[];
    data.rutes.forEach((r,i)=>{if(r.camio.id===filtreCamio)(boundsPerRoute[i]||[]).forEach(ll=>acc.push(ll));});
    if(acc.length){map.fitBounds(acc,{padding:[30,30]});}
  }else{
    const ix=parseInt(val,10);
    const bp=boundsPerRoute[ix];
    if(bp&&bp.length){map.fitBounds(bp,{padding:[30,30]});}
  }
}
selector.addEventListener('change',(e)=>applyRouteFilter(e.target.value));
if(boundsAll.length){map.fitBounds(boundsAll,{padding:[20,20]});}
</script></body></html>`;

  await writeFile(outputPath, html, 'utf8');
  return outputPath;
}

main().catch((error) => {
  console.error('Error generant script Plaça Catalunya:', error);
  process.exitCode = 1;
});
