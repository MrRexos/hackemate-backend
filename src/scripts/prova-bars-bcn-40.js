import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';

const NOMS_CAMIONS = ['Joel', 'Pol', 'Oier', 'Jan', 'Nil', 'Victor'];
const CENTRE = { x: 2.170047, y: 41.387016 }; // Placa Catalunya
const NUM_PUNTS = 55;

async function main() {
  const punts = generaPuntsAleatorisBarcelona(NUM_PUNTS, CENTRE);
  const entregues = creaEntregues(punts);
  const flotaCamions = creaFlotaVariable(NOMS_CAMIONS);

  const resultat = await generarRutes(entregues, flotaCamions, CENTRE, {
    velocitatKmH: 32,
    usaMock: true,
    EntregaClass: Entrega,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
  });

  const visualData = await calculaGeometriesRutes(resultat.rutes, CENTRE);
  const outputPath = await generaVisualHtml({ centre: CENTRE, resultat, visualData });

  console.log('=== Ruta bars Barcelona (55 punts) amb Sweep ===');
  console.log(`Punts totals: ${NUM_PUNTS}`);
  console.log(`Camions maxims: ${flotaCamions.length}`);
  console.log(`Rutes generades: ${resultat.rutes.length}`);
  console.log(`No assignades: ${resultat.entreguesNoAssignades.length}`);
  console.log(`\nMapa visual generat a: ${outputPath}`);
}

function creaFlotaVariable(noms) {
  return noms.map((nom, idx) => ({
    id: nom,
    capacitatMaxima: 95 + idx * 12, // capacitats variables
  }));
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

function generaPuntsAleatorisBarcelona(total, centre) {
  const punts = [];
  for (let i = 0; i < total; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radi = 0.01 + Math.random() * 0.06;
    const x = centre.x + Math.cos(angle) * radi;
    const y = centre.y + Math.sin(angle) * radi;
    punts.push({ nom: `Bar aleatori ${i + 1}`, x, y });
  }
  return punts;
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
      data.push({
        camio: ruta.camio.id,
        geometria: geom,
        distanciaMetres: Number(route0?.distance ?? 0),
        duradaSegons: Number(route0?.duration ?? 0),
      });
    } catch {
      data.push({ camio: ruta.camio.id, geometria: null, distanciaMetres: 0, duradaSegons: 0 });
    }
  }
  return data;
}

async function generaVisualHtml({ centre, resultat, visualData }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputDir = path.join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'bars-bcn-55-sweep-placa-catalunya.html');

  const payload = JSON.stringify({
    centre,
    rutes: resultat.rutes.map((ruta) => ({
      camio: ruta.camio,
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
    })),
    visualData,
    noAssignades: resultat.entreguesNoAssignades.length,
  });

  const html = `<!doctype html>
<html lang="ca"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Sweep Barcelona - Plaça Catalunya</title>
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
</style></head>
<body><div class="wrap">
<div class="card"><h2 style="margin:0 0 8px">Sweep des de Plaça Catalunya</h2><div id="meta"></div></div>
<div class="card">
<div class="toolbar">
<label for="routeSelector"><strong>Mostra:</strong></label>
<select id="routeSelector"><option value="all">Totes les rutes</option></select>
</div>
<div class="legend" id="legend"></div><div id="map"></div></div>
<div class="card"><h3 style="margin:0 0 8px">Resum per ruta</h3><table><thead><tr><th>Camio</th><th>Sortida Plaça Catalunya</th><th>Tornada</th><th>KM ruta</th><th>Entregues</th></tr></thead><tbody id="tbodyRutes"></tbody></table></div>
<div class="card"><h3 style="margin:0 0 8px">Entregues per camio</h3><table><thead><tr><th>Camio</th><th>#</th><th>Entrega</th><th>Arribada</th><th>Franja</th></tr></thead><tbody id="tbody"></tbody></table></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=${payload};
const colors=['#ef4444','#2563eb','#16a34a','#9333ea','#ea580c','#0891b2'];
document.getElementById('meta').textContent='Rutes: '+data.rutes.length+' · No assignades: '+data.noAssignades;
const selector=document.getElementById('routeSelector');
data.rutes.forEach((ruta,idx)=>{
  selector.innerHTML+=\`<option value="\${idx}">\${ruta.camio.id} només</option>\`;
});
const map=L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
const warehouse=L.circleMarker([data.centre.y,data.centre.x],{radius:8,color:'#111827',fillColor:'#111827',fillOpacity:1}).addTo(map).bindPopup('Plaça Catalunya');
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
  const color=colors[idx%colors.length];
  const routeInfo=data.visualData.find(v=>v.camio===ruta.camio.id);
  const geom=routeInfo?.geometria;
  const km=((Number(routeInfo?.distanciaMetres||0))/1000).toFixed(2);
  const bR=[[data.centre.y,data.centre.x]];
  if(geom&&geom.coordinates){
    const latlngs=geom.coordinates.map(c=>[c[1],c[0]]);
    L.polyline(latlngs,{color,weight:4,opacity:0.85}).addTo(g);
    latlngs.forEach(ll=>bR.push(ll));
  }
  legend.innerHTML+=\`<span class="pill legend-pill" data-route="\${idx}" style="border-color:\${color};color:\${color}">\${ruta.camio.id} · \${km} km</span>\`;
  const entreguesNom=\`[\${ruta.entregues.map(e=>e.id).join(', ')}]\`;
  tbodyRutes.innerHTML+=\`<tr class="row-ruta" data-route="\${idx}"><td>\${ruta.camio.id}</td><td>\${ruta.horaSortidaMagatzem||'--:--'}</td><td>\${ruta.horaTornadaMagatzem||'--:--'}</td><td>\${km}</td><td>\${entreguesNom}</td></tr>\`;
  ruta.entregues.forEach(e=>{
    L.circleMarker([e.y,e.x],{radius:5,color,fillColor:color,fillOpacity:0.9}).addTo(g).bindPopup('<b>'+ruta.camio.id+'</b><br>#'+e.ordre+' '+e.id+'<br>Arribada '+(e.arribada||'--:--')); 
    boundsAll.push([e.y,e.x]);
    bR.push([e.y,e.x]);
    tbody.innerHTML+=\`<tr class="row-detall" data-route="\${idx}"><td>\${ruta.camio.id}</td><td>\${e.ordre}</td><td>\${e.id}</td><td>\${e.arribada||'--:--'}</td><td>\${e.franja}</td></tr>\`;
  });
  boundsPerRoute.push(bR);
});
routeLayerGroups.forEach(g=>g.addTo(map));
function applyRouteFilter(val){
  const showAll=(val==='all');
  routeLayerGroups.forEach((g,i)=>{
    if(showAll||(String(i)===String(val))) map.addLayer(g); else map.removeLayer(g);
  });
  warehouse.addTo(map);
  document.querySelectorAll('.legend-pill').forEach(p=>{
    p.classList.toggle('filtered',!showAll&&p.dataset.route!==String(val));
  });
  document.querySelectorAll('.row-ruta,.row-detall').forEach(tr=>{
    tr.style.display=(showAll||tr.dataset.route===String(val))?'':'none';
  });
  if(showAll){if(boundsAll.length){map.fitBounds(boundsAll,{padding:[20,20]});}}
  else{
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
