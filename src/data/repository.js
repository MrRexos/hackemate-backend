/**
 * Pont entre Supabase i {@link Entrega} / {@link Pedido}.
 *
 * **Modes** (`LOGISTICS_SOURCE_MODE`):
 * - `flat`: una vista/taula amb una fila per producte (mateix entrega_id repetit).
 * - `joined`: dues taules (entregues + pedidos); es fan 2 SELECT i es fusionen en memòria.
 *
 * Omple les variables `LOGISTICS_*` del `.env.local` segons l’esquema real del company.
 */
import { env } from '../config/env.js';
import { Entrega } from '../models/logistica/classes/entrega.model.js';
import { geocodificarAdrecaNominatim } from '../models/logistica/services/geocodificar-adreca.service.js';
import { assertSupabaseConfigured, createSupabaseClient } from './database.js';
import {
  columnMapEntregaTable,
  columnMapFlat,
  columnMapPedidoTable,
  columnMapPersist,
} from './schema-map.js';

function tieneCoords(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la) && Number.isFinite(lo);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Agrupa files planes per identificador d’entrega.
 * @param {Record<string, unknown>[]} rows
 */
export function agrupaFilesPerEntrega(rows, cols = columnMapFlat()) {
  const map = new Map();

  for (const row of rows) {
    const rawId = row[cols.entregaId];
    if (rawId == null || rawId === '') continue;
    const key = String(rawId);

    if (!map.has(key)) {
      map.set(key, {
        meta: {
          entrega_id: key,
          nom_entrega: row[cols.nomEntrega] ?? null,
          adreca: row[cols.adreca] ?? '',
          hora_inici: row[cols.horaInici] ?? null,
          hora_fi: row[cols.horaFi] ?? null,
          latitud: row[cols.latitud],
          longitud: row[cols.longitud],
        },
        pedidos: [],
      });
    }

    const bloc = map.get(key);
    bloc.pedidos.push({
      nom: row[cols.pedidoNom] ?? '',
      volum: Number(row[cols.volumUnitari]) || 0,
      quantitat: Number(row[cols.quantitat]) || 0,
      tipusCarrega: row[cols.tipusCarrega] ?? null,
    });
  }

  return map;
}

/**
 * Mode `joined`: llegeix taules separades i construeix el mateix Map que `agrupaFilesPerEntrega`.
 * Inclou entregues sense cap línia de pedido (`pedidos: []`).
 */
export function agrupaTaulesEntregaPedido(entreguesRows, pedidosRows, ce = columnMapEntregaTable(), cp = columnMapPedidoTable()) {
  const map = new Map();

  for (const ent of entreguesRows) {
    const rawId = ent[ce.pk];
    if (rawId == null || rawId === '') continue;
    const key = String(rawId);
    map.set(key, {
      meta: {
        entrega_id: key,
        nom_entrega: ent[ce.nom] ?? null,
        adreca: ent[ce.adreca] ?? '',
        hora_inici: ent[ce.horaInici] ?? null,
        hora_fi: ent[ce.horaFi] ?? null,
        latitud: ent[ce.latitud],
        longitud: ent[ce.longitud],
      },
      pedidos: [],
    });
  }

  for (const p of pedidosRows) {
    const rawFk = p[cp.fkEntrega];
    if (rawFk == null || rawFk === '') continue;
    const key = String(rawFk);
    const bloc = map.get(key);
    if (!bloc) continue;
    bloc.pedidos.push({
      nom: p[cp.nom] ?? '',
      volum: Number(p[cp.volum]) || 0,
      quantitat: Number(p[cp.quantitat]) || 0,
      tipusCarrega: p[cp.tipus] ?? null,
    });
  }

  return map;
}

export async function persistirCoordenadesEntrega(client, entregaId, lat, lon, colsPersist = columnMapPersist()) {
  const patch = {
    [colsPersist.latitud]: lat,
    [colsPersist.longitud]: lon,
  };

  const { error } = await client.from(env.logisticsEntreguesTable).update(patch).eq(colsPersist.pk, entregaId);

  if (error) {
    throw new Error(`No s’han pogut guardar coordenades per entrega ${entregaId}: ${error.message}`);
  }
}

async function fetchRowsFlat(client) {
  const font = env.logisticsFlatView;
  const { data: rows, error } = await client.from(font).select('*');
  if (error) {
    throw new Error(`Error llegint font pla "${font}": ${error.message}`);
  }
  return Array.isArray(rows) ? rows : [];
}

async function fetchRowsJoined(client) {
  const te = env.logisticsTableEntregues;
  const tp = env.logisticsTablePedidos;
  const { data: entregues, error: e1 } = await client.from(te).select('*');
  if (e1) {
    throw new Error(`Error llegint taula entregues "${te}": ${e1.message}`);
  }
  const { data: pedidos, error: e2 } = await client.from(tp).select('*');
  if (e2) {
    throw new Error(`Error llegint taula pedidos "${tp}": ${e2.message}`);
  }
  return {
    entregues: Array.isArray(entregues) ? entregues : [],
    pedidos: Array.isArray(pedidos) ? pedidos : [],
  };
}

/**
 * Construeix Map meta+pedidos des del mode configurat.
 */
export async function fetchGroupedEntregues(client) {
  const mode = env.logisticsSourceMode;

  if (mode === 'joined') {
    const { entregues, pedidos } = await fetchRowsJoined(client);
    return agrupaTaulesEntregaPedido(entregues, pedidos);
  }

  const rows = await fetchRowsFlat(client);
  if (rows.length === 0) {
    return new Map();
  }
  return agrupaFilesPerEntrega(rows, columnMapFlat());
}

async function instanciaEntreguesDesDeGrups(grups, client, fetchImpl, pausaMs) {
  const colsPersist = columnMapPersist();
  const resultat = [];
  let primeraGeocodificacio = true;

  for (const [, { meta, pedidos }] of grups) {
    let lon = Number(meta.longitud);
    let lat = Number(meta.latitud);

    if (!tieneCoords(lat, lon)) {
      const adreca = String(meta.adreca || '').trim();
      if (!adreca) {
        throw new Error(`Entrega ${meta.entrega_id}: falta adreca per geocodificar i no hi ha coordenades guardades.`);
      }

      if (!primeraGeocodificacio && pausaMs > 0) await sleep(pausaMs);
      primeraGeocodificacio = false;

      const coords = await geocodificarAdrecaNominatim(adreca, fetchImpl);
      lon = coords.x;
      lat = coords.y;

      await persistirCoordenadesEntrega(client, meta.entrega_id, lat, lon, colsPersist);
    }

    resultat.push(
      new Entrega({
        identificador: meta.entrega_id,
        nom: meta.nom_entrega,
        adreca: meta.adreca || null,
        horaInici: meta.hora_inici ?? null,
        horaFinal: meta.hora_fi ?? null,
        coordenades: { x: lon, y: lat },
        pedidos,
      }),
    );
  }

  return resultat;
}

/**
 * Obté entregues des de Supabase, agrupa productes, geocodifica si cal i persisteix coords.
 *
 * @param {object} [options]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.client]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.pausaGeocodificacioMs=1100]
 */
export async function fetchEntregasFromSource(options = {}) {
  assertSupabaseConfigured();

  const client = options.client ?? createSupabaseClient();
  const fetchImpl = options.fetchImpl ?? fetch;
  const pausaMs = Number(options.pausaGeocodificacioMs) >= 0 ? Number(options.pausaGeocodificacioMs) : 1100;

  const grups = await fetchGroupedEntregues(client);
  if (grups.size === 0) {
    return [];
  }

  return instanciaEntreguesDesDeGrups(grups, client, fetchImpl, pausaMs);
}
