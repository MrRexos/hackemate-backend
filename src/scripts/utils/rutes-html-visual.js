/**
 * Geometries OSRM tram per tram + HTML Leaflet (mateixa visualització que `prova-100-bcn-html.js`).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { volumCarregaMaximaOperativa } from '../../models/logistica/constants/capacitat-camio.constants.js';

/**
 * Volum, capacitats i percentatges per mostrar barres d’emplenament (límit operatiu = fracció nominal).
 */
export function metricaCarregaRuta(ruta) {
  const camio = ruta.camio;
  const vol = Number(ruta.volumOcupat ?? 0);
  const capNom = Number(camio?.capacitatMaxima ?? camio?.capacitat ?? 0);
  const capOp = volumCarregaMaximaOperativa(camio);
  const pctNom = capNom > 0 ? Math.round((vol / capNom) * 1000) / 10 : 0;
  const pctOp =
    capOp > 0 ? Math.min(100, Math.round((vol / capOp) * 10000) / 100) : capNom > 0 ? Math.round((vol / capNom) * 1000) / 10 : 0;
  const ampleBarra = capOp > 0 ? Math.min(100, (vol / capOp) * 100) : capNom > 0 ? Math.min(100, (vol / capNom) * 100) : 0;
  return {
    volumOcupat: vol,
    capacitatNominal: capNom,
    capacitatOperativaMax: capOp,
    percentatgeDelNominal: pctNom,
    percentatgeDelLimitOperatiu: pctOp,
    ampleBarraEmplenament: Math.round(ampleBarra * 10) / 10,
  };
}

export const OSRM_BASE_DEFAULT = 'https://router.project-osrm.org';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Assegura convenció x = lon, y = lat (corrigeix lat/lon invertits típics ~BCN). */
export function normalitzaLonLatPunt(p) {
  if (!p || p.x == null || p.y == null) return null;
  let x = Number(p.x);
  let y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x >= 36 && x <= 45 && y >= -10 && y <= 10) {
    return { x: y, y: x };
  }
  return { x, y };
}

function escHtmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchOsrmUnTram(pA, pB, fetchImpl, osrmBaseUrl) {
  const coords = `${pA.x},${pA.y};${pB.x},${pB.y}`;
  const url = new URL(`${osrmBaseUrl}/route/v1/driving/${coords}`);
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

/**
 * @param {any[]} rutes
 * @param {{ x: number, y: number }} centre Magatzem (lon, lat).
 * @param {{ fetchImpl?: typeof fetch, osrmBaseUrl?: string, entreTramsMs?: number }} [opts]
 */
export async function calculaGeometriesRutes(rutes, centre, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const osrmBaseUrl = opts.osrmBaseUrl ?? OSRM_BASE_DEFAULT;
  const OSRM_ENTRE_TRAMS_MS = opts.entreTramsMs !== undefined ? Number(opts.entreTramsMs) : 40;

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
        const routeLeg = await fetchOsrmUnTram(a, b, fetchImpl, osrmBaseUrl);
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

/**
 * @param {*} resultat Retorn de `generarRutes`.
 * @param {*} visualData Sortida de {@link calculaGeometriesRutes}.
 * @param {{ x: number, y: number }} centre
 * @param {{ titol: string, entreguesTotals: number }} meta
 */
export function construeixPayloadVisual(resultat, visualData, centre, meta) {
  const { titol, entreguesTotals } = meta;
  const viatgesPerCamio = Object.create(null);

  const rutesVisual = resultat.rutes.map((ruta, rutaIdx) => {
    const idCamio = ruta.camio?.id ?? '?';
    viatgesPerCamio[idCamio] = (viatgesPerCamio[idCamio] || 0) + 1;
    const tripSeq = viatgesPerCamio[idCamio];

    const carrega = metricaCarregaRuta(ruta);

    return {
      camio: ruta.camio,
      tripSeq,
      horaSortidaMagatzem: ruta.horaSortidaMagatzem,
      horaTornadaMagatzem: ruta.horaTornadaMagatzem,
      volumOcupat: carrega.volumOcupat,
      capacitatNominal: carrega.capacitatNominal,
      capacitatOperativaMax: carrega.capacitatOperativaMax,
      percentatgeDelNominal: carrega.percentatgeDelNominal,
      percentatgeDelLimitOperatiu: carrega.percentatgeDelLimitOperatiu,
      ampleBarraEmplenament: carrega.ampleBarraEmplenament,
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
          tipusCarrega: p.tipusCarrega ?? null,
          factorCaixesPerUnitat: p.factorCaixesPerUnitat,
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
    titol,
    rutes: rutesVisual,
    visualData,
    noAssignades: resultat.entreguesNoAssignades.length,
    noAssignadesDetall: resultat.entreguesNoAssignades.map((e) => ({
      id: e.identificador,
    })),
    entreguesTotals,
    assignades: entreguesTotals - resultat.entreguesNoAssignades.length,
  };
}

/**
 * Escriu l’HTML del mapa; crea el directori pare si cal.
 * @returns {Promise<string>} Camí absolut del fitxer escrit.
 */
export async function escriuHtmlVistaRutes(payload, outputPath) {
  const jsonStr = JSON.stringify(payload);
  const titolEsc = escHtmlAttr(payload.titol);

  const html = `<!doctype html>
<html lang="ca"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${titolEsc} — sweep</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;background:#f1f5f9;margin:0;color:#0f172a;line-height:1.45}
.wrap{max-width:1280px;margin:0 auto;padding:14px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(15,23,42,.06)}
h2{font-size:1.35rem;font-weight:650}
h3{font-size:1.05rem;font-weight:650;color:#0f172a}
#map{height:58vh;min-height:320px;border-radius:12px;border:1px solid #e2e8f0}
.legend{display:flex;gap:8px;flex-wrap:wrap}.pill{padding:6px 10px;border:1px solid #e2e8f0;border-radius:999px;font-size:12px;background:#fafafa}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.toolbar label{font-weight:600}
.toolbar select{padding:8px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:14px;min-width:240px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:10px 8px;text-align:left;vertical-align:middle}th{background:#f8fafc;font-weight:600;color:#475569}
tbody tr:hover{background:#f8fafc}
.pill.filtered{opacity:0.35}.small{margin:0;color:#64748b;font-size:13px}
.mono{font-family:ui-monospace,Courier New,monospace;font-size:12px}
.hora{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:#0f172a}
.sub-hora{display:block;font-size:11px;font-weight:500;color:#64748b;margin-top:2px}
.bar-wrap{height:12px;background:#e2e8f0;border-radius:8px;overflow:hidden;min-width:100px;max-width:180px}
.bar-fill{height:100%;border-radius:8px;transition:width .2s ease}
.bar-meta{font-size:11px;color:#64748b;margin-top:4px;max-width:220px}
.pct-strong{font-weight:700;font-variant-numeric:tabular-nums;color:#0f172a}
.grid-rutes{display:grid;gap:10px}
@media(min-width:900px){.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;font-size:13px}
.kpi b{font-size:15px;display:block;color:#0f172a}
</style></head>
<body><div class="wrap">
<div class="card"><h2 style="margin:0 0 8px">${titolEsc}</h2>
<p class="small" style="margin-bottom:10px">Magatzem (mapa) · Algoritme <code>generarRutes</code> (sweep). La barra de <strong>carrega</strong> compara el volum transportat amb el <strong>màxim operatiu</strong> del camió (~97% del nominal).</p>
<div id="meta"></div>
<div id="kpisRutes" class="kpis"></div>
<div id="noAssignWrap" style="margin-top:10px;font-size:13px"></div></div>

<div class="grid-2">
<div class="card">
<div class="toolbar"><label for="routeSelector">Ruta al mapa</label>
<select id="routeSelector"><option value="all">Totes les rutes</option></select></div>
<div class="legend" id="legend"></div><div id="map"></div></div>

<div class="card grid-rutes"><h3 style="margin:0 0 12px">Resum per ruta</h3>
<table><thead><tr><th>Camió</th><th>Viatge</th><th>Sortida magatzem</th><th>Tornada magatzem</th><th>Carrega camió</th><th>KM</th><th>Parades</th></tr></thead><tbody id="tbodyRutes"></tbody></table></div>
</div>

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
  '<strong>Entregues (entrada):</strong> '+data.entreguesTotals+
  ' · <strong>Assignades:</strong> '+data.assignades+
  ' · <strong>Rutes:</strong> '+data.rutes.length+
  ' · <strong>No assignades:</strong> '+data.noAssignades;

(function(){
  const w=document.getElementById('noAssignWrap');
  if(!data.noAssignadesDetall||!data.noAssignadesDetall.length){w.innerHTML='';return;}
  w.innerHTML='<strong>No assignades:</strong><ul style="margin:6px 0 0;padding-left:18px">'+
    data.noAssignadesDetall.map(function(r){return '<li><b>'+esc(r.id)+'</b></li>';}).join('')+'</ul>';
})();

(function(){
  var el=document.getElementById('kpisRutes');
  if(!data.rutes||!data.rutes.length){el.innerHTML='';return;}
  var sumKm=0,nParades=0,c=0,sumPct=0;
  data.rutes.forEach(function(r,i){
    sumKm+=Number(data.visualData[i].distanciaMetres||0)/1000;
    nParades+=(r.entregues&&r.entregues.length)||0;
    if(Number(r.capacitatOperativaMax)>0){sumPct+=Number(r.percentatgeDelLimitOperatiu||0);c+=1;}
  });
  var avgFill=c?Math.round((sumPct/c)*10)/10:null;
  el.innerHTML='<div class="kpi"><b>'+data.rutes.length+'</b> rutes</div>'+
    '<div class="kpi"><b>'+sumKm.toFixed(1)+' km</b> distància OSRM (suma)</div>'+
    '<div class="kpi"><b>'+nParades+'</b> parades</div>'+
    (avgFill!=null?'<div class="kpi"><b>'+avgFill+'%</b> mitjana emplenament (vs útil)</div>':'');
})();

function colorBarraPct(pct){var p=Number(pct)||0;if(p>=95)return'#dc2626';if(p>=80)return'#ca8a04';return'#16a34a';}
function htmlCarregaRuta(ruta){
  var vol=Number(ruta.volumOcupat||0),capOp=Number(ruta.capacitatOperativaMax||0),capNom=Number(ruta.capacitatNominal||0);
  var pctOp=Number(ruta.percentatgeDelLimitOperatiu||0),w=Math.min(100,Number(ruta.ampleBarraEmplenament||0));
  var col=colorBarraPct(pctOp);
  var sub=capOp>0
    ? fmt3(vol)+' / '+fmt3(capOp)+' u · <span class="pct-strong">'+pctOp+'%</span> útil · nom. '+fmt3(capNom)
    : (capNom>0?fmt3(vol)+' / '+fmt3(capNom)+' u ('+Number(ruta.percentatgeDelNominal||0)+'% nominal)':'—');
  return '<div class="bar-wrap"><div class="bar-fill" style="width:'+w+'%;background:'+col+'"></div></div>'+
    '<div class="bar-meta">'+sub+'</div>';
}

const selector=document.getElementById('routeSelector');
const comptadorCamio={};
data.rutes.forEach(function(r){const id=r.camio.id;comptadorCamio[id]=(comptadorCamio[id]||0)+1;});
data.rutes.forEach(function(ruta,idx){
  var hs=ruta.horaSortidaMagatzem||'—',ht=ruta.horaTornadaMagatzem||'—';
  selector.innerHTML+='<option value="'+idx+'">'+esc(ruta.camio.id)+' · viatge '+ruta.tripSeq+' · '+esc(hs)+' → '+esc(ht)+'</option>';
});
Object.keys(comptadorCamio).forEach(function(id){if(comptadorCamio[id]>1){selector.innerHTML+='<option value="camio:'+esc(id)+'">'+esc(id)+' (tots els viatges)</option>';}});

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
  var pctLeg=Number(ruta.percentatgeDelLimitOperatiu!=null?ruta.percentatgeDelLimitOperatiu:ruta.percentatgeDelNominal||0);
  legend.innerHTML+='<span class="pill legend-pill" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'" style="border-color:'+color+';color:'+color+'">'+
    esc(ruta.camio.id)+' · '+pctLeg+'% · '+kmOsrm+' km</span>';

  const par=ruta.entregues.map(function(e){return e.id;}).join(', ');
  tbodyRutes.innerHTML+='<tr class="row-ruta" data-route="'+idx+'" data-camio="'+esc(ruta.camio.id)+'">'+
    '<td><strong>'+esc(ruta.camio.id)+'</strong></td><td>'+ruta.tripSeq+'</td>'+
    '<td><span class="hora">'+(ruta.horaSortidaMagatzem?esc(ruta.horaSortidaMagatzem):'—')+'</span></td>'+
    '<td><span class="hora">'+(ruta.horaTornadaMagatzem?esc(ruta.horaTornadaMagatzem):'—')+'</span></td>'+
    '<td>'+htmlCarregaRuta(ruta)+'</td>'+
    '<td class="mono">'+kmOsrm+'</td>'+
    '<td class="small">'+esc(par)+'</td></tr>';

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

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, 'utf8');
  return outputPath;
}
