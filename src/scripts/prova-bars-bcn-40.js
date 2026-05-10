import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { FlotaCamions } from '../models/logistica/classes/camio.model.js';
import { Pedido } from '../models/logistica/classes/pedido.model.js';
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

/** Capacitats en caixes equivalents (mateixa escala que l’entrega); més vehicles amb IDs únics eviten camions virtuals. */
const CAPACITATS_FLOTA_BAR = [
  130, 125, 120, 120, 115, 110, 108, 105, 102, 100, 95, 95, 90, 88, 88,
];

/** Flota més ajustada a la demanda simulada (menys vehicles «sobrants» → més omplert per ruta). */
function flotaSimulacioBars(totalCamions = 24) {
  const tipus = [
    'articulat',
    'articulat',
    'rígid',
    'rígid',
    'rígid',
    'rígid',
    'rígid',
    'rígid',
    'rígid',
    'rígid',
    'furgoneta gran',
    'furgoneta gran',
    'furgoneta gran',
    'furgoneta',
    'furgoneta',
  ];
  const defs = [];
  for (let i = 0; i < totalCamions; i += 1) {
    const k = i % CAPACITATS_FLOTA_BAR.length;
    defs.push({
      capacitat: CAPACITATS_FLOTA_BAR[k],
      numeroReferencia: `VHC-BAR-${String(i + 1).padStart(2, '0')}`,
      tipus: tipus[k],
    });
  }
  return new FlotaCamions(defs).perOptimizador();
}

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
  const flotaCamions = flotaSimulacioBars(24);

  const resultat = await generarRutes(entregues, flotaCamions, CENTRE, {
    velocitatKmH: 32,
    usaMock: true,
    EntregaClass: Entrega,
    tempsBaseDescarregaMinuts: 10,
    tempsPerCaixaMinuts: 1,
    assignacioCompleta: false,
    /**
     * Quota de parades activa (per defecte del sweep): compacta rutes amb poques parades i omple millor els vehicles.
     * Amb `perQuotaParadesDesactivada: true` aquest pas es saltava i sortien moltes rutes amb poca càrrega.
     */
    minEntreguesPerRuta: 10,
    maxEntreguesPerRuta: 35,
  });

  const visualData = await calculaGeometriesRutes(resultat.rutes, CENTRE);
  const outputPath = await generaVisualHtml({ centre: CENTRE, resultat, visualData });

  console.log(`=== Ruta bars: sortida ${NOM_MAGATZEM} · ${NUM_PUNTS} parades ≤${RADI_RODONA_KM} km de Mollet ===`);
  console.log(`Punts totals: ${NUM_PUNTS}`);
  console.log(`Camions maxims: ${flotaCamions.length}`);
  console.log(`Rutes generades: ${resultat.rutes.length}`);

  const sumCapacitatRutes = resultat.rutes.reduce((acc, r) => acc + Number(r.camio.capacitatMaxima || 0), 0);
  const sumVolumCarregat = resultat.rutes.reduce((acc, r) => acc + Number(r.volumOcupat || 0), 0);
  const pctGlobal =
    sumCapacitatRutes > 0 ? ((sumVolumCarregat / sumCapacitatRutes) * 100).toFixed(1) : '0.0';
  console.log(
    `\nOcupació global (suma de capacitats màximes dels vehicles amb ruta): ${sumVolumCarregat}/${sumCapacitatRutes} (${pctGlobal}%)`,
  );
  console.log('\nCapacitat i càrrega per camió (caixes equivalents; mateixa escala que capacitatMaxima):');
  resultat.rutes.forEach((ruta, i) => {
    const cap = Number(ruta.camio.capacitatMaxima || 0);
    const vol = Number(ruta.volumOcupat || 0);
    const pct = cap > 0 ? ((vol / cap) * 100).toFixed(1) : '—';
    const suf = ruta.__camioVirtual ? ' [camió virtual]' : '';
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}. ${ruta.camio.id}${suf} → ${vol}/${cap} (${pct}% ple) · ${ruta.entregues.length} parades`,
    );
  });

  console.log(`No assignades: ${resultat.entreguesNoAssignades.length}`);
  if (resultat.entreguesNoAssignades.length > 0) {
    console.log('\nMotius (no assignades):');
    resultat.entreguesNoAssignades.forEach((e) => {
      console.log(` - ${e.identificador ?? '?'} | ${e.motiuNoAssignacio?.codi ?? ''}`);
    });
  }
  console.log(`\nMapa visual generat a: ${outputPath}`);
}

/** Noms de local generats (deterministes per índex). */
const PREFIXOS_BAR = [
  'Bar', 'Taverna', 'Xiringuito', 'Bodega', 'Celler', 'Restaurant', 'Menjador', 'Terrassa',
];
const ADJECTIUS = [
  'del Roser', 'Can Sunyer', 'La Palmera', 'El Racó', 'de la Plaça', 'Los Amigos', 'La Violeta',
  'Ca la Pepa', 'Donosti', 'del Pi', 'Mar Brava', 'Montserrat', 'Sant Martí', 'del Pont',
];

const MARQUES_PRODUCTE = [
  'Estrella Damm', 'Moritz', 'San Miguel', 'Alhambra', 'Voll-Damm', 'Heineken', 'Coca-Cola',
  'Nestlé Professional', 'Calvé', 'Knorr', 'Bimbo', 'Fripan', 'Campofrío', 'El Pozo',
];

const FORMAT_PRODUCTE = [
  'barril 30L', 'pack 24×33cl', 'gerra PET 2L', 'caixa 12 ampolles', 'sac 5 kg', 'congelat IQF caixa',
  'brick 6×1L', 'bandeja MAP', 'bag in box 3L', 'pallet 40 caixes', 'stock rotation A', 'lot fresc dia',
];

const FAMILIA_EXTRA = [
  'Olives variades', 'Patates xips sac', 'Tapes prefabricades', 'Formatge tallat', 'Embotits assortit',
  'Glaçons industrial', 'Servilletes compostables', 'Got PLA 200 ml', 'Neteja multiús', 'Sucs naturals',
];

const TIPUS_CARREGA = [
  'beguda', 'congelat', 'sec', 'refrigerat', 'neteja', 'envàs', 'embalatge', 'líquid', 'fresc',
];

function hashMix(seed) {
  let h = seed >>> 0;
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return h >>> 0;
}

function nomLocalBar(idx) {
  const h = hashMix(idx * 7919 + 42);
  const pre = PREFIXOS_BAR[h % PREFIXOS_BAR.length];
  const adj = ADJECTIUS[(h >> 3) % ADJECTIUS.length];
  return `${pre} ${adj}`;
}

/**
 * Genera entre 3 i 7 línies de pedido amb noms de producte únics, multiplicador CE/unitat, quantitat i total CE de línia.
 */
function generaPedidosDetallats(idx) {
  const numLinies = 3 + (hashMix(idx + 1000) % 5);
  const pedidos = [];
  for (let p = 0; p < numLinies; p += 1) {
    const seed = hashMix(idx * 131 + p * 997);
    const marca = MARQUES_PRODUCTE[seed % MARQUES_PRODUCTE.length];
    const format = FORMAT_PRODUCTE[(seed >> 4) % FORMAT_PRODUCTE.length];
    const extra = FAMILIA_EXTRA[(seed >> 8) % FAMILIA_EXTRA.length];
    const ref = String((seed % 9000) + 1000);
    const volumUnitari =
      Math.round((0.06 + (seed % 80) * 0.0085) * 0.9 * 1000) / 1000;
    const nombreCaixes = Math.max(4, Math.floor(6 + ((seed >> 5) % 28)));
    const nomProducte = `${marca} · ${format} · ${extra} (ref. ${ref})`;
    pedidos.push(
      new Pedido({
        nom: nomProducte,
        volum: volumUnitari,
        quantitat: nombreCaixes,
        tipusCarrega: TIPUS_CARREGA[(seed >> 12) % TIPUS_CARREGA.length],
      }),
    );
  }
  return pedidos;
}

function creaEntregues(punts) {
  return punts.map((p, idx) => {
    const pedidos = generaPedidosDetallats(idx);

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
      identificador: `BAR-${String(idx + 1).padStart(3, '0')}`,
      nom: nomLocalBar(idx),
      adreca: `${p.nom}, rodalies`,
      pedidos,
      horaInici,
      horaFinal,
      coordenades: { x: p.x, y: p.y },
    });
  });
}

function serialitzaPedidoPerHtml(p) {
  return {
    nom: p.nom,
    volumPerCaixa: p.volumPerCaixa,
    quantitatCaixes: p.quantitatCaixes,
    volumTotal: p.volumTotal,
    tipusCarrega: p.tipusCarrega ?? '',
  };
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
    /** `simplified` redueix molt la mida del HTML respecte `full` (mateix traç visual al mapa). */
    url.searchParams.set('overview', 'simplified');
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
        nomClient: e.nom ?? '',
        volumTotalEntrega: Number(e.volumTotal ?? 0),
        x: e.coordenades.x,
        y: e.coordenades.y,
        arribada: e.arribadaHora,
        franja: `${e.horaInici ?? '--'}-${e.horaFinal ?? '--'}`,
        pedidos: (e.pedidos || []).map(serialitzaPedidoPerHtml),
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
#tbodyPedidos{font-size:12px}#tbodyPedidos td:nth-child(7){max-width:280px;word-break:break-word}
.mono{font-variant-numeric:tabular-nums}
.scroll-wide{overflow-x:auto;-webkit-overflow-scrolling:touch}
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
<div class="card"><h3 style="margin:0 0 8px">Entregues per camió</h3><table><thead><tr><th>Camió</th><th>#</th><th>Entrega</th><th>Client</th><th>Vol. total</th><th>Arribada</th><th>Franja</th></tr></thead><tbody id="tbody"></tbody></table></div>
<div class="card scroll-wide"><h3 style="margin:0 0 8px">Línies de pedido (producte, quantitat, caixes eq.)</h3><p class="small" style="margin:0 0 8px;color:#64748b;font-size:13px">Cada fila és una línia de comanda: total CE = multiplicador × caixes eq. (barril = 4 caixes/unitat física). Filtra amb el selector del mapa.</p><table><thead><tr><th>Camió</th><th>Viatge</th><th>Parada</th><th>Entrega</th><th>Client</th><th>#Línia</th><th>Producte</th><th>Tipus</th><th class="mono">Qt CE</th><th class="mono">×/u</th><th class="mono">CE línia</th></tr></thead><tbody id="tbodyPedidos"></tbody></table></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=${payload};
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt3(n){const x=Number(n);return Number.isFinite(x)?x.toFixed(3):'—';}
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
const tbodyPedidos=document.getElementById('tbodyPedidos');
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
    var pedLines=(e.pedidos||[]).map(function(pd,li){
      return '<div style="margin:4px 0;padding:4px 0;border-bottom:1px solid #e5e7eb;font-size:12px"><strong>'+esc(pd.nom)+'</strong><br/>'+
        'Qt CE <span class="mono">'+pd.quantitatCaixes+'</span> × '+fmt3(pd.volumPerCaixa)+' → <span class="mono">'+fmt3(pd.volumTotal)+'</span> CE · '+esc(pd.tipusCarrega||'')+'</div>';
    }).join('');
    var pop='<div style="max-width:340px;max-height:280px;overflow:auto"><b>'+esc(ruta.camio.id)+'</b> · viatge '+ruta.tripSeq+'<br/><b>'+esc(e.id)+'</b> · '+esc(e.nomClient||'')+
      '<br/>Caixes eq. entrega <span class="mono">'+fmt3(e.volumTotalEntrega)+'</span><br/>Arribada '+(e.arribada||'--:--')+'<hr style="margin:6px 0"/>'+pedLines+'</div>';
    L.circleMarker([my,mx],{radius:5,color,fillColor:color,fillOpacity:0.9}).addTo(g).bindPopup(pop);
    boundsAll.push([my,mx]);
    bR.push([my,mx]);
    tbody.innerHTML+=\`<tr class="row-detall" data-route="\${idx}" data-camio="\${ruta.camio.id}"><td>\${ruta.camio.id} · \${ruta.tripSeq}</td><td>\${e.ordre}</td><td>\${e.id}</td><td>\${esc(e.nomClient)}</td><td class="mono">\${fmt3(e.volumTotalEntrega)}</td><td>\${e.arribada||'--:--'}</td><td>\${e.franja}</td></tr>\`;
    (e.pedidos||[]).forEach(function(pd,li){
      tbodyPedidos.innerHTML+=\`<tr class="row-pedido row-detall" data-route="\${idx}" data-camio="\${ruta.camio.id}"><td>\${esc(ruta.camio.id)}</td><td>\${ruta.tripSeq}</td><td>\${e.ordre}</td><td>\${esc(e.id)}</td><td>\${esc(e.nomClient)}</td><td>\${li+1}</td><td>\${esc(pd.nom)}</td><td>\${esc(pd.tipusCarrega)}</td><td class="mono">\${pd.quantitatCaixes}</td><td class="mono">\${fmt3(pd.volumPerCaixa)}</td><td class="mono">\${fmt3(pd.volumTotal)}</td></tr>\`;
    });
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
  document.querySelectorAll('.row-ruta,.row-detall,.row-pedido').forEach(tr=>{
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
  console.error('Error generant prova-bars-bcn-40:', error);
  process.exitCode = 1;
});
