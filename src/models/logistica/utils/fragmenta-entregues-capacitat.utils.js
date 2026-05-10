import { Entrega } from '../classes/entrega.model.js';
import { volumLimitOperatiuPerAssignacio } from '../constants/capacitat-camio.constants.js';

/**
 * Volum màxim per fragment (mateix límit estricte que {@link volumPermetAfegirACamio}).
 */
export function capacitatOperativaMaximaFlota(camions) {
  let m = 0;
  if (!Array.isArray(camions)) return m;
  for (const c of camions) {
    const v = volumLimitOperatiuPerAssignacio(c);
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/**
 * Empaqueta pedidos en bins amb suma de volum ≤ volumMax (First Fit Decreasing).
 * Si algun pedido individual supera volumMax, retorna null (no es pot servir amb un sol camió sense partir línia).
 *
 * @param {object[]} pedidos
 * @param {number} volumMax
 * @returns {object[][]|null}
 */
export function empaquetaPedidosEnBinsPerVolumMax(pedidos, volumMax) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return [];
  const sorted = [...pedidos].sort(
    (a, b) => Number(b.volumTotal || 0) - Number(a.volumTotal || 0),
  );
  /** @type {object[][]} */
  const bins = [];

  for (const p of sorted) {
    const vp = Number(p.volumTotal || 0);
    if (vp > volumMax + 1e-9) return null;

    let posat = false;
    for (const bin of bins) {
      const sum = bin.reduce((s, x) => s + Number(x.volumTotal || 0), 0);
      if (sum + vp <= volumMax + 1e-9) {
        bin.push(p);
        posat = true;
        break;
      }
    }
    if (!posat) bins.push([p]);
  }
  return bins;
}

/**
 * Parteix entregues el volum total de les quals supera el màxim operatiu de la flota en diverses entregues
 * (mateixa adreça i coords, pedidos repartits). Això permet assignar més d’un camió al mateix destí.
 *
 * @template {typeof Entrega} T
 * @param {object[]} entregues
 * @param {object[]} camions
 * @param {new (p: object) => object} [EntregaClass]
 * @returns {object[]}
 */
export function fragmentaEntreguesSuperiorsACapacitatMaxCamio(entregues, camions, EntregaClass = Entrega) {
  const maxOp = capacitatOperativaMaximaFlota(camions);
  if (!(maxOp > 0) || !Array.isArray(entregues) || entregues.length === 0) return entregues;

  /** @type {object[]} */
  const out = [];

  for (const e of entregues) {
    const vol = Number(e.volumTotal ?? 0);
    const pedidos = e.pedidos || [];

    if (vol <= maxOp + 1e-9 || pedidos.length === 0) {
      out.push(e);
      continue;
    }

    const bins = empaquetaPedidosEnBinsPerVolumMax(pedidos, maxOp);
    if (!bins || bins.length <= 1) {
      out.push(e);
      continue;
    }

    bins.forEach((chunk, idx) => {
      const suf = bins.length > 1 ? `__frag${idx + 1}` : '';
      out.push(
        new EntregaClass({
          adreca: e.adreca,
          carrer: e.carrer ?? null,
          codiPostal: e.codiPostal ?? null,
          municipi: e.municipi ?? null,
          nom: e.nom,
          pedidos: chunk,
          horaInici: e.horaInici,
          horaFinal: e.horaFinal,
          identificador: `${e.identificador}${suf}`,
          coordenades: e.coordenades,
          angle: e.angle ?? null,
          horaDEntrega: e.horaDEntrega ?? null,
        }),
      );
    });
  }

  return out;
}
