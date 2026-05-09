/**
 * Genera un HTML llegible amb el resultat de {@link planificarRutesDesDeBaseDades}.
 */
import { descripcioMotiuNoAssignacio } from '../models/logistica/services/sweep-optimizer.service.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Awaited<ReturnType<import('./planificacio-bd.service.js').planificarRutesDesDeBaseDades>>} payload
 */
export function generaHtmlInformePlanificacio(payload) {
  const { magatzem, fontConfig, entreguesCarregades, resultat } = payload;
  const { rutes, entreguesNoAssignades } = resultat;
  const generat = new Date().toISOString();

  const filesRutes = rutes
    .map((ruta, idx) => {
      const camioId = escapeHtml(ruta.camio?.id ?? '?');
      const cap = escapeHtml(String(ruta.camio?.capacitatMaxima ?? ''));
      const vol = escapeHtml(String(ruta.volumOcupat ?? ''));
      const sortida = escapeHtml(ruta.horaSortidaMagatzem ?? '—');
      const tornada = escapeHtml(ruta.horaTornadaMagatzem ?? '—');
      const virt = ruta.__camioVirtual ? ' <span class="badge">virtual</span>' : '';

      const parades =
        ruta.entregues?.length > 0
          ? `<ol class="parades">${ruta.entregues
              .map(
                (e) =>
                  `<li><strong>${escapeHtml(e.identificador)}</strong> ${escapeHtml(e.nom ?? '')}`
                  + ` · volum ${escapeHtml(e.volumTotal)} · ETA ${escapeHtml(e.arribadaHora ?? e.horaDEntrega ?? '—')}`
                  + ` · ${escapeHtml(e.adreca ?? '')}</li>`,
              )
              .join('')}</ol>`
          : '<p class="muted">Sense parades</p>';

      return `
<section class="ruta">
  <h3>Ruta ${idx + 1} — Camió ${camioId}${virt}</h3>
  <p class="meta">Capacitat nominal ${cap} · Volum ruta ${vol} · Sortida ~${sortida} · Tornada ~${tornada}</p>
  ${parades}
</section>`;
    })
    .join('\n');

  const filesNoAssignades =
    entreguesNoAssignades?.length > 0
      ? `<section class="no-assignades"><h3>No assignades (${entreguesNoAssignades.length})</h3><ul>${entreguesNoAssignades
          .map(
            (e) =>
              `<li><strong>${escapeHtml(e.identificador)}</strong> — ${escapeHtml(descripcioMotiuNoAssignacio(e))}</li>`,
          )
          .join('')}</ul></section>`
      : '';

  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Informe planificació logística</title>
  <style>
    :root { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
    body { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.35rem; }
    h2 { font-size: 1.05rem; margin-top: 1.5rem; }
    .badge { background: #e2e8f0; padding: 0.1rem 0.45rem; border-radius: 4px; font-size: 0.75rem; }
    .muted { color: #64748b; }
    .resum { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .ruta { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .ruta h3 { margin-top: 0; font-size: 1rem; }
    .meta { font-size: 0.9rem; color: #475569; margin: 0.25rem 0 0.75rem; }
    .parades { margin: 0; padding-left: 1.25rem; }
    .parades li { margin: 0.35rem 0; }
    .no-assignades { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
    code { font-size: 0.85rem; background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Informe de planificació</h1>
  <p class="muted">Generat: <code>${escapeHtml(generat)}</code></p>
  <div class="resum">
    <p><strong>Magatzem:</strong> lon ${escapeHtml(magatzem.x)}, lat ${escapeHtml(magatzem.y)}</p>
    <p><strong>Font BD:</strong> mode <code>${escapeHtml(fontConfig.sourceMode)}</code>
      ${fontConfig.flatView ? ` · vista/taula <code>${escapeHtml(fontConfig.flatView)}</code>` : ''}
      ${fontConfig.tableEntregues ? ` · entregues <code>${escapeHtml(fontConfig.tableEntregues)}</code>` : ''}
      ${fontConfig.tablePedidos ? ` · pedidos <code>${escapeHtml(fontConfig.tablePedidos)}</code>` : ''}
    </p>
    <p><strong>Entregues llegides:</strong> ${escapeHtml(entreguesCarregades)} ·
       <strong>Rutes:</strong> ${escapeHtml(rutes.length)} ·
       <strong>No assignades:</strong> ${escapeHtml(entreguesNoAssignades?.length ?? 0)}</p>
  </div>
  <h2>Rutes</h2>
  ${filesRutes || '<p class="muted">Cap ruta amb parades.</p>'}
  ${filesNoAssignades}
</body>
</html>`;
}
