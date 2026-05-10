import { Entrega } from '../classes/entrega.model.js';
import { Pedido } from '../classes/pedido.model.js';
import { normalitzaValorDia } from '../services/excel-a-pedidos.reader.js';

export function esInstanciaEntrega(entrega, EntregaClass) {
  return entrega instanceof EntregaClass;
}

export function construeixEntrega(entrega, EntregaClass) {
  return esInstanciaEntrega(entrega, EntregaClass) ? entrega : new EntregaClass(entrega);
}

/** Adreça buida / sense text: totes les línies sense `adreca` van al mateix grup (dia + nom). */
function normalitzaClauAdrecaPerAgrupacio(adreca) {
  if (adreca == null || String(adreca).trim() === '') return '';
  return String(adreca).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Sufix estable i curt per l’`identificador` segons la clau d’adreça (evita IDs duplicats mateix dia + nom). */
function suffixIdentificadorPerClauAdreca(adrecaKey) {
  if (!adrecaKey) return 'sense-adreca';
  let h = 0;
  for (let i = 0; i < adrecaKey.length; i += 1) {
    h = (h << 5) - h + adrecaKey.charCodeAt(i);
    h |= 0;
  }
  return `ad${(Math.abs(h) >>> 0).toString(36)}`;
}

/**
 * @param {Pedido} pedido
 * @returns {{ diaKey: string, nomKey: string, adrecaKey: string, clau: string }}
 */
function clausAgrupacioPedido(pedido) {
  const diaKey = normalitzaValorDia(pedido.dia) ?? '';
  const nomKey = pedido.nom == null ? '' : String(pedido.nom).trim();
  const adrecaKey = normalitzaClauAdrecaPerAgrupacio(pedido.adreca);
  return {
    diaKey,
    nomKey,
    adrecaKey,
    clau: `${diaKey}\u0001${nomKey}\u0001${adrecaKey}`,
  };
}

/**
 * Agrupa un array de {@link Pedido} en {@link Entrega}: una entrega per cada triple únic
 * (dia calendari, nom client, adreça normalitzada). Les línies sense `adreca` comparteixen la mateixa clau buida.
 * Camps d’adreça estructurada es prenen de la primera línia del grup que en tingui; el volum el calcula `Entrega`.
 *
 * @param {Pedido[]|object[]} pedidos Instàncies o objectes compatibles amb `Pedido`.
 * @param {{ EntregaClass?: typeof Entrega }} [options]
 * @returns {Entrega[]}
 */
export function agrupaPedidosEnEntregues(pedidos, options = {}) {
  const EntregaClass = options.EntregaClass ?? Entrega;
  if (!Array.isArray(pedidos) || pedidos.length === 0) return [];

  /** @type {Map<string, Pedido[]>} */
  const grups = new Map();

  for (const raw of pedidos) {
    const pedido = raw instanceof Pedido ? raw : new Pedido(raw);
    const { clau } = clausAgrupacioPedido(pedido);
    if (!grups.has(clau)) grups.set(clau, []);
    grups.get(clau).push(pedido);
  }

  /** @type {Entrega[]} */
  const entregues = [];

  for (const [, grup] of grups) {
    const primer = grup[0];
    const { diaKey, nomKey, adrecaKey } = clausAgrupacioPedido(primer);
    const adreca =
      grup.map((p) => p.adreca).find((a) => a != null && String(a).trim() !== '') ?? null;
    const carrer =
      grup.map((p) => p.carrer).find((v) => v != null && String(v).trim() !== '') ?? null;
    const codiPostal =
      grup.map((p) => p.codiPostal).find((v) => v != null && String(v).trim() !== '') ?? null;
    const municipi =
      grup.map((p) => p.municipi).find((v) => v != null && String(v).trim() !== '') ?? null;
    const nom = nomKey === '' ? null : nomKey;
    const baseId = diaKey || nomKey ? `${diaKey}__${nomKey}` : 'agrup-sense-dia-nom';
    const identificador = `${baseId}__${suffixIdentificadorPerClauAdreca(adrecaKey)}`;

    entregues.push(
      new EntregaClass({
        identificador,
        nom,
        adreca,
        carrer,
        codiPostal,
        municipi,
        pedidos: grup,
      }),
    );
  }

  return entregues;
}
