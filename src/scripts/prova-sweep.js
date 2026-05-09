import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { generarRutes } from '../models/logistica/services/sweep-optimizer.service.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOTA_EXEMPLE_15_CAMIONS } from '../models/logistica/config/flota-exemple-15.js';
import {
  generaPuntsSobreCarrerRodona,
  MOLLET_CENTRE_RODONA,
  MOLLET_MAGATZEM_AFORES,
} from './utils/punts-sobre-carrer.js';

async function main() {
  console.log('Generant 200 punts sobre vial dins 20 km de Mollet (OSRM nearest)...');
  const entreguesEscala200 = await generaEntreguesEscala200({
    fetchImpl: fetch,
  });

  const escenaris = [
    {
      nom: 'Escala 200 entregues / rodona 20 km Mollet / flota 15 exemple',
      puntMagatzem: { ...MOLLET_MAGATZEM_AFORES },
      flotaCamions: FLOTA_EXEMPLE_15_CAMIONS.perOptimizador(),
      entregues: entreguesEscala200,
      velocitatKmH: 38,
    },
  ];

  for (const escenari of escenaris) {
    const resultat = await generarRutes(
      escenari.entregues,
      escenari.flotaCamions,
      escenari.puntMagatzem,
      {
        velocitatKmH: escenari.velocitatKmH,
        usaMock: true,
        EntregaClass: Entrega,
        tempsBaseDescarregaMinuts: 10,
        tempsPerCaixaMinuts: 1,
        assignacioCompleta: true,
      },
    );

    pintaResultatEscenari(escenari, resultat);
    await generaInformeVisual(escenari, resultat);
  }
}

main().catch((error) => {
  console.error('Error executant la prova Sweep:', error);
  process.exitCode = 1;
});

function creaEntrega({ id, adreca, horaInici = null, horaFinal = null, x, y, pedidos }) {
  return new Entrega({
    identificador: id,
    adreca,
    horaInici,
    horaFinal,
    coordenades: { x, y },
    pedidos,
  });
}

function generaEntreguesBase() {
  return [
    creaEntrega({
      id: 'B-001',
      adreca: 'Carrer de Mallorca 401, Barcelona',
      horaInici: '08:30',
      horaFinal: '11:30',
      x: 2.177,
      y: 41.404,
      pedidos: [
        { nom: 'Begudes', volum: 5, quantitat: 4 },
        { nom: 'Snacks', volum: 2, quantitat: 10 },
      ],
    }),
    creaEntrega({
      id: 'B-002',
      adreca: 'Carrer de Sants 120, Barcelona',
      horaInici: '09:00',
      horaFinal: '13:00',
      x: 2.138,
      y: 41.376,
      pedidos: [{ nom: 'Fruita', volum: 3, quantitat: 8 }],
    }),
    creaEntrega({
      id: 'B-003',
      adreca: 'Gran Via de les Corts Catalanes 585, Barcelona',
      horaInici: '15:00',
      horaFinal: '18:00',
      x: 2.163,
      y: 41.387,
      pedidos: [{ nom: 'Congelats', volum: 4, quantitat: 12 }],
    }),
    creaEntrega({
      id: 'B-004',
      adreca: 'Avinguda Diagonal 640, Barcelona',
      x: 2.108,
      y: 41.39,
      pedidos: [{ nom: 'Neteja', volum: 6, quantitat: 5 }],
    }),
    creaEntrega({
      id: 'B-005',
      adreca: 'Passeig de Gracia 35, Barcelona',
      horaInici: '16:00',
      horaFinal: '19:30',
      x: 2.165,
      y: 41.392,
      pedidos: [{ nom: 'Sec', volum: 2, quantitat: 20 }],
    }),
    creaEntrega({
      id: 'B-006',
      adreca: 'Rambla del Poblenou 95, Barcelona',
      x: 2.203,
      y: 41.401,
      pedidos: [{ nom: 'Llaunes', volum: 3, quantitat: 7 }],
    }),
    creaEntrega({
      id: 'B-007',
      adreca: 'Carrer dArago 250, Barcelona',
      horaInici: '10:00',
      horaFinal: '12:00',
      x: 2.171,
      y: 41.392,
      pedidos: [{ nom: 'Paper', volum: 4, quantitat: 5 }],
    }),
    creaEntrega({
      id: 'B-008',
      adreca: 'Carrer de Muntaner 200, Barcelona',
      horaInici: '14:30',
      horaFinal: '18:30',
      x: 2.152,
      y: 41.392,
      pedidos: [{ nom: 'Lactics', volum: 3, quantitat: 9 }],
    }),
  ];
}

function generaEntreguesAltaDemanda() {
  return [
    ...generaEntreguesBase(),
    creaEntrega({
      id: 'A-009',
      adreca: 'Travessera de Gracia 120, Barcelona',
      horaInici: '08:00',
      horaFinal: '12:00',
      x: 2.155,
      y: 41.401,
      pedidos: [{ nom: 'Farina', volum: 5, quantitat: 12 }],
    }),
    creaEntrega({
      id: 'A-010',
      adreca: 'Carrer de Balmes 90, Barcelona',
      horaInici: '09:30',
      horaFinal: '13:00',
      x: 2.16,
      y: 41.39,
      pedidos: [{ nom: 'Conserves', volum: 4, quantitat: 11 }],
    }),
    creaEntrega({
      id: 'A-011',
      adreca: 'Passeig de Sant Joan 80, Barcelona',
      horaInici: '15:30',
      horaFinal: '18:30',
      x: 2.173,
      y: 41.397,
      pedidos: [{ nom: 'Sec', volum: 3, quantitat: 16 }],
    }),
    creaEntrega({
      id: 'A-012',
      adreca: 'Carrer de Marina 210, Barcelona',
      x: 2.19,
      y: 41.401,
      pedidos: [{ nom: 'Refrescos', volum: 2, quantitat: 25 }],
    }),
    creaEntrega({
      id: 'A-013',
      adreca: 'Rambla de Catalunya 15, Barcelona',
      horaInici: '13:45',
      horaFinal: '16:00',
      x: 2.165,
      y: 41.389,
      pedidos: [{ nom: 'Pastes', volum: 3, quantitat: 10 }],
    }),
    creaEntrega({
      id: 'A-014',
      adreca: 'Carrer de Casp 42, Barcelona',
      horaInici: '11:00',
      horaFinal: '14:00',
      x: 2.177,
      y: 41.389,
      pedidos: [{ nom: 'Pizzes', volum: 6, quantitat: 9 }],
    }),
    creaEntrega({
      id: 'A-015',
      adreca: 'Avinguda Roma 122, Barcelona',
      horaInici: '17:00',
      horaFinal: '20:00',
      x: 2.149,
      y: 41.381,
      pedidos: [{ nom: 'Salses', volum: 2, quantitat: 18 }],
    }),
    creaEntrega({
      id: 'A-016',
      adreca: 'Carrer de Tarragona 85, Barcelona',
      x: 2.144,
      y: 41.378,
      pedidos: [{ nom: 'Aigua', volum: 7, quantitat: 8 }],
    }),
  ];
}

function generaEntreguesFinestresEstricte() {
  return [
    creaEntrega({
      id: 'F-001',
      adreca: 'Carrer de València 310, Barcelona',
      horaInici: '08:20',
      horaFinal: '09:10',
      x: 2.176,
      y: 41.395,
      pedidos: [{ nom: 'Fresc', volum: 3, quantitat: 8 }],
    }),
    creaEntrega({
      id: 'F-002',
      adreca: 'Carrer de Girona 145, Barcelona',
      horaInici: '08:50',
      horaFinal: '10:00',
      x: 2.17,
      y: 41.399,
      pedidos: [{ nom: 'Llet', volum: 2, quantitat: 11 }],
    }),
    creaEntrega({
      id: 'F-003',
      adreca: 'Carrer del Consell de Cent 410, Barcelona',
      horaInici: '09:30',
      horaFinal: '10:45',
      x: 2.185,
      y: 41.393,
      pedidos: [{ nom: 'Iogurts', volum: 2, quantitat: 9 }],
    }),
    creaEntrega({
      id: 'F-004',
      adreca: 'Carrer de Roger de Lluria 220, Barcelona',
      horaInici: '11:00',
      horaFinal: '13:30',
      x: 2.172,
      y: 41.392,
      pedidos: [{ nom: 'Gel', volum: 4, quantitat: 7 }],
    }),
    creaEntrega({
      id: 'F-005',
      adreca: 'Carrer de Napols 300, Barcelona',
      horaInici: '14:10',
      horaFinal: '15:00',
      x: 2.181,
      y: 41.4,
      pedidos: [{ nom: 'Sec', volum: 3, quantitat: 6 }],
    }),
    creaEntrega({
      id: 'F-006',
      adreca: 'Carrer de Padilla 215, Barcelona',
      horaInici: '15:00',
      horaFinal: '16:00',
      x: 2.184,
      y: 41.403,
      pedidos: [{ nom: 'Snacks', volum: 2, quantitat: 10 }],
    }),
    creaEntrega({
      id: 'F-007',
      adreca: 'Carrer dIndependencia 330, Barcelona',
      horaInici: '16:00',
      horaFinal: '17:00',
      x: 2.186,
      y: 41.408,
      pedidos: [{ nom: 'Carn', volum: 5, quantitat: 5 }],
    }),
    creaEntrega({
      id: 'F-008',
      adreca: 'Carrer de Bac de Roda 100, Barcelona',
      horaInici: '17:10',
      horaFinal: '18:20',
      x: 2.199,
      y: 41.412,
      pedidos: [{ nom: 'Congelat', volum: 4, quantitat: 6 }],
    }),
    creaEntrega({
      id: 'F-009',
      adreca: 'Carrer de Bilbao 90, Barcelona',
      x: 2.205,
      y: 41.409,
      pedidos: [{ nom: 'Fruita', volum: 3, quantitat: 8 }],
    }),
    creaEntrega({
      id: 'F-010',
      adreca: 'Carrer de Pere IV 250, Barcelona',
      x: 2.196,
      y: 41.405,
      pedidos: [{ nom: 'Caixes buides', volum: 1, quantitat: 30 }],
    }),
  ];
}

async function generaEntreguesEscala200(options = {}) {
  const coords = await generaPuntsSobreCarrerRodona(200, {
    centreRodona: MOLLET_CENTRE_RODONA,
    radiKm: 20,
    excloureZonaMuntanya: false,
    ...options,
  });
  const entregues = [];

  for (let i = 1; i <= 200; i += 1) {
    const { x, y } = coords[i - 1];

    let horaInici = null;
    let horaFinal = null;
    const tipusFranja = i % 3;

    if (tipusFranja === 0) {
      const inici = 8 * 60 + (i % 8) * 20;
      const fi = Math.min(inici + 150, 14 * 60);
      horaInici = minutsAHora(inici);
      horaFinal = minutsAHora(fi);
    } else if (tipusFranja === 1) {
      const inici = 14 * 60 + (i % 8) * 25;
      const fi = Math.min(inici + 170, 21 * 60);
      horaInici = minutsAHora(inici);
      horaFinal = minutsAHora(fi);
    }

    // Volums ajustats per apuntar a ~10 entregues per camio de 120.
    const volumA = 1 + (i % 2); // 1..2
    const quantitatA = 4 + (i % 3); // 4..6
    const volumB = 1; // fix
    const quantitatB = 2 + (i % 3); // 2..4

    entregues.push(
      creaEntrega({
        id: `S-${String(i).padStart(4, '0')}`,
        adreca: `Entrega simulada vial ${i} (≤20 km Mollet)`,
        horaInici,
        horaFinal,
        x,
        y,
        pedidos: [
          { nom: `Familia-${(i % 6) + 1}`, volum: volumA, quantitat: quantitatA },
          { nom: `Complement-${(i % 4) + 1}`, volum: volumB, quantitat: quantitatB },
        ],
      }),
    );
  }

  return entregues;
}

function pintaResultatEscenari(escenari, resultat) {
  const volumTotalFlota = resultat.rutes.reduce((acc, ruta) => acc + Number(ruta.camio.capacitatMaxima || 0), 0);
  const volumTotalOcupat = resultat.rutes.reduce((acc, ruta) => acc + Number(ruta.volumOcupat || 0), 0);
  const ocupacio = volumTotalFlota > 0 ? ((volumTotalOcupat / volumTotalFlota) * 100).toFixed(2) : '0.00';
  const totalEntregues = escenari.entregues.length;
  const assignades = totalEntregues - resultat.entreguesNoAssignades.length;

  console.log(`\n\n=== ESCENARI: ${escenari.nom} ===`);
  console.log(`Entregues totals: ${totalEntregues}`);
  console.log(`Assignades: ${assignades} | No assignades: ${resultat.entreguesNoAssignades.length}`);
  console.log(`Rutes generades: ${resultat.rutes.length}`);
  console.log(`Ocupacio global: ${volumTotalOcupat}/${volumTotalFlota} (${ocupacio}%)`);

  resultat.rutes.forEach((ruta, index) => {
    const percent = ((Number(ruta.volumOcupat || 0) / Number(ruta.camio.capacitatMaxima || 1)) * 100).toFixed(2);
    const mati = ruta.entregues.filter((e) => teMati(e)).length;
    const tarda = ruta.entregues.filter((e) => teTarda(e)).length;
    const lliures = ruta.entregues.length - mati - tarda;

    console.log(`\nRuta ${index + 1} - Camio ${ruta.camio.id}`);
    console.log(`  Capacitat: ${ruta.camio.capacitatMaxima} | Volum: ${ruta.volumOcupat} (${percent}%)`);
    console.log(`  Entregues: total=${ruta.entregues.length}, mati=${mati}, tarda=${tarda}, lliures=${lliures}`);
    console.log(
      `  Sortida magatzem≈${ruta.horaSortidaMagatzem ?? '--:--'} | Tornada magatzem≈${ruta.horaTornadaMagatzem ?? '--:--'}`,
    );
    console.log(`  Temps magatzem -> 1a entrega≈${Math.round(Number(ruta.tempsMagatzemPrimeraEntregaMinuts || 0))} min`);

    ruta.entregues.forEach((entrega) => {
      const arribada = entrega.arribadaHora ?? '--:--';
      const deltaFranja = calculaDeltaFranja(entrega);
      console.log(
        `   - ${entrega.identificador} | arribada≈${arribada} | delta=${deltaFranja} | angle=${Number(entrega.angle).toFixed(2)} | volum=${entrega.volumTotal} caixes | franja=${entrega.horaInici ?? '--'}-${entrega.horaFinal ?? '--'}`,
      );
    });
  });

  if (resultat.entreguesNoAssignades.length > 0) {
    console.log('\nNo assignades:');
    resultat.entreguesNoAssignades.forEach((entrega) => {
      console.log(
        ` - ${entrega.identificador} | volum=${entrega.volumTotal} | franja=${entrega.horaInici ?? '--'}-${entrega.horaFinal ?? '--'} | ${entrega.motiuNoAssignacio?.codi ?? ''}`,
      );
    });
  }
}

function horaMinuts(hora) {
  if (!hora || typeof hora !== 'string') return null;
  const [h, m] = hora.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function teMati(entrega) {
  const fi = horaMinuts(entrega.horaFinal);
  return fi != null && fi <= 14 * 60;
}

function teTarda(entrega) {
  const inici = horaMinuts(entrega.horaInici);
  return inici != null && inici >= 14 * 60;
}

function minutsAHora(minutsTotals) {
  const h = Math.floor(minutsTotals / 60);
  const m = minutsTotals % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function calculaDeltaFranja(entrega) {
  if (entrega.arribadaMinuts == null) return 'sense ETA';

  const arribada = Number(entrega.arribadaMinuts);
  const inici = horaMinuts(entrega.horaInici);
  const fi = horaMinuts(entrega.horaFinal);

  if (inici == null && fi == null) return 'sense franja';
  if (inici != null && arribada < inici) return `${Math.round(inici - arribada)} min abans`;
  if (fi != null && arribada > fi) return `${Math.round(arribada - fi)} min tard`;
  return 'dins franja';
}

async function generaInformeVisual(escenari, resultat) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputDir = path.join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });

  const nomFitxer = `sweep-visual-${slugify(escenari.nom)}.html`;
  const outputPath = path.join(outputDir, nomFitxer);

  const punts = [
    escenari.puntMagatzem,
    ...resultat.rutes.flatMap((ruta) => ruta.entregues.map((entrega) => entrega.coordenades)),
  ];

  const projector = creaProjector(punts, 980, 620);
  const colors = [
    '#ef4444', '#2563eb', '#16a34a', '#9333ea', '#ea580c',
    '#0891b2', '#4f46e5', '#65a30d', '#be123c', '#0f766e',
    '#a855f7', '#ca8a04', '#db2777', '#7c3aed', '#059669',
  ];

  const warehouse = projector(escenari.puntMagatzem);

  const routesSvg = resultat.rutes.map((ruta, idx) => {
    const color = colors[idx % colors.length];
    const stops = ruta.entregues.map((e) => projector(e.coordenades));
    const all = [warehouse, ...stops, warehouse];

    const line = all.map((p) => `${p.x},${p.y}`).join(' ');
    const circles = stops.map((p, i) =>
      `<g><circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${color}" /><text x="${p.x + 7}" y="${p.y - 7}" font-size="11" fill="#0f172a">${i + 1}</text></g>`,
    ).join('');

    return `<g class="route-layer" data-route-index="${idx}" data-route-id="${escapeHtml(ruta.camio.id)}"><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>${circles}</g>`;
  }).join('\n');

  const routeOptions = resultat.rutes
    .map((ruta, idx) => `<option value="${idx}">${escapeHtml(nomCamioVisual(ruta.camio.id))} (ruta ${idx + 1})</option>`)
    .join('');

  const legendItems = resultat.rutes
    .map((ruta, idx) => {
      const color = colors[idx % colors.length];
      return `<span class="legend-item" data-route-index="${idx}"><span class="legend-dot" style="background:${color}"></span>${escapeHtml(nomCamioVisual(ruta.camio.id))} · Ruta ${idx + 1}</span>`;
    })
    .join('');

  const summaryRows = resultat.rutes.map((ruta, idx) => {
    const color = colors[idx % colors.length];
    const ocupacio = ((Number(ruta.volumOcupat || 0) / Number(ruta.camio.capacitatMaxima || 1)) * 100).toFixed(1);
    return `
      <tr class="summary-row" data-route-index="${idx}" data-route-id="${escapeHtml(ruta.camio.id)}">
        <td><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:999px;margin-right:8px;"></span>${nomCamioVisual(ruta.camio.id)}</td>
        <td>${ruta.entregues.length}</td>
        <td>${ruta.volumOcupat}/${ruta.camio.capacitatMaxima} (${ocupacio}%)</td>
        <td>${ruta.horaSortidaMagatzem ?? '--:--'}</td>
        <td>${ruta.horaTornadaMagatzem ?? '--:--'}</td>
      </tr>
    `;
  }).join('');

  const deliveryRows = resultat.rutes.flatMap((ruta, idx) =>
    ruta.entregues.map((e) => `
      <tr class="delivery-row" data-route-index="${idx}" data-route-id="${escapeHtml(ruta.camio.id)}">
        <td>${nomCamioVisual(ruta.camio.id)}</td>
        <td>${e.identificador}</td>
        <td>${e.arribadaHora ?? '--:--'}</td>
        <td>${e.horaInici ?? '--'} - ${e.horaFinal ?? '--'}</td>
        <td>${calculaDeltaFranja(e)}</td>
      </tr>
    `),
  ).join('');

  const noAssignadesRows = resultat.entreguesNoAssignades
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(String(e.identificador ?? ''))}</td>
        <td>${e.volumTotal ?? ''}</td>
        <td>${escapeHtml(`${e.horaInici ?? '--'} - ${e.horaFinal ?? '--'}`)}</td>
        <td><code>${escapeHtml(e.motiuNoAssignacio?.codi ?? '')}</code></td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="ca">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resultat visual Sweep</title>
  <style>
    body { font-family: Inter, Segoe UI, Arial, sans-serif; margin: 20px; color: #0f172a; background: #f8fafc; }
    h1, h2 { margin: 0 0 10px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .meta { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; margin-top: 10px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
    svg { width: 100%; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(#ffffff, #f8fafc); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; }
    .small { color: #475569; font-size: 13px; }
    .toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .toolbar select { padding:6px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
    .legend { display:flex; gap:10px; flex-wrap:wrap; margin-top:8px; }
    .legend-item { font-size:12px; color:#334155; display:inline-flex; align-items:center; gap:6px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:999px; padding:4px 8px; }
    .legend-dot { width:10px; height:10px; border-radius:999px; display:inline-block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Resultat visual Sweep</h1>
    <div class="small">Escenari: ${escapeHtml(escenari.nom)}</div>
    <div class="meta">
      <div class="kpi"><strong>Entregues</strong><br>${escenari.entregues.length}</div>
      <div class="kpi"><strong>Rutes</strong><br>${resultat.rutes.length}</div>
      <div class="kpi"><strong>No assignades</strong><br>${resultat.entreguesNoAssignades.length}</div>
      <div class="kpi"><strong>Velocitat</strong><br>${escenari.velocitatKmH} km/h</div>
    </div>
  </div>

  <div class="card">
    <h2>Mapa esquematic de rutes</h2>
    <p class="small">Punt negre = magatzem. Cada color representa una ruta. Numeracio = ordre de parada.</p>
    <div class="toolbar">
      <label for="routeFilter"><strong>Mostra ruta:</strong></label>
      <select id="routeFilter">
        <option value="all">Totes les rutes</option>
        ${routeOptions}
      </select>
    </div>
    <div class="legend">${legendItems}</div>
    <svg viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="1000" height="640" fill="transparent"></rect>
      ${routesSvg}
      <circle cx="${warehouse.x}" cy="${warehouse.y}" r="8" fill="#0f172a"></circle>
      <text x="${warehouse.x + 10}" y="${warehouse.y - 10}" font-size="12" fill="#0f172a">Magatzem</text>
    </svg>
  </div>

  <div class="card">
    <h2>Resum per camio</h2>
    <p class="small">Aquest resum i la taula d'arribades es filtren amb el selector de ruta.</p>
    <table>
      <thead>
        <tr><th>Camio</th><th>Parades</th><th>Ocupacio</th><th>Sortida</th><th>Tornada</th></tr>
      </thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Arribades per entrega</h2>
    <table>
      <thead>
        <tr><th>Camio</th><th>Entrega</th><th>Arribada</th><th>Franja</th><th>Delta</th></tr>
      </thead>
      <tbody>${deliveryRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Entregues no assignades</h2>
    ${
      resultat.entreguesNoAssignades.length === 0
        ? '<p class="small">Cap.</p>'
        : `<table>
      <thead>
        <tr><th>Id</th><th>Volum</th><th>Franja</th><th>Codi</th></tr>
      </thead>
      <tbody>${noAssignadesRows}</tbody>
    </table>`
    }
  </div>
  <script>
    const filter = document.getElementById('routeFilter');
    const routeLayers = Array.from(document.querySelectorAll('.route-layer'));
    const summaryRows = Array.from(document.querySelectorAll('.summary-row'));
    const deliveryRows = Array.from(document.querySelectorAll('.delivery-row'));
    const legendItems = Array.from(document.querySelectorAll('.legend-item'));

    function applyFilter(value) {
      const showAll = value === 'all';
      routeLayers.forEach((el) => {
        const show = showAll || el.dataset.routeIndex === value;
        el.style.display = show ? '' : 'none';
      });
      summaryRows.forEach((el) => {
        const show = showAll || el.dataset.routeIndex === value;
        el.style.display = show ? '' : 'none';
      });
      deliveryRows.forEach((el) => {
        const show = showAll || el.dataset.routeIndex === value;
        el.style.display = show ? '' : 'none';
      });
      legendItems.forEach((el) => {
        const active = showAll || el.dataset.routeIndex === value;
        el.style.opacity = active ? '1' : '0.35';
      });
    }

    filter.addEventListener('change', (e) => applyFilter(e.target.value));
    applyFilter('all');
  </script>
</body>
</html>`;

  await writeFile(outputPath, html, 'utf8');
  console.log(`\nInforme visual generat a: ${outputPath}`);
}

function creaProjector(punts, ample, alt) {
  const xs = punts.map((p) => Number(p.x));
  const ys = punts.map((p) => Number(p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 30;

  const dx = Math.max(0.0001, maxX - minX);
  const dy = Math.max(0.0001, maxY - minY);

  return (punt) => {
    const nx = (Number(punt.x) - minX) / dx;
    const ny = (Number(punt.y) - minY) / dy;
    return {
      x: pad + nx * (ample - pad * 2),
      y: alt - pad - ny * (alt - pad * 2),
    };
  };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nomCamioVisual(idCamio) {
  const raw = String(idCamio ?? '').trim();
  const digits = raw.match(/\d+/)?.[0];
  if (digits) return `Camio ${digits.padStart(2, '0')}`;
  return raw ? `Camio ${raw}` : 'Camio sense id';
}
