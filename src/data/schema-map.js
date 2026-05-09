/**
 * Mapeig columnes BD ↔ lògica del repositori (tot configurable per .env).
 */

function col(name, fallback) {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

/** Columnes esperades a files “planes” (vista o taula amb una fila per producte). */
export function columnMapFlat() {
  return {
    entregaId: col('LOGISTICS_COL_ENTREGA_ID', 'entrega_id'),
    nomEntrega: col('LOGISTICS_COL_NOM_ENTREGA', 'nom_entrega'),
    adreca: col('LOGISTICS_COL_ADRECA', 'adreca'),
    horaInici: col('LOGISTICS_COL_HORA_INICI', 'hora_inici'),
    horaFi: col('LOGISTICS_COL_HORA_FI', 'hora_fi'),
    latitud: col('LOGISTICS_COL_LATITUD', 'latitud'),
    longitud: col('LOGISTICS_COL_LONGITUD', 'longitud'),
    pedidoNom: col('LOGISTICS_COL_PEDIDO_NOM', 'pedido_nom'),
    volumUnitari: col('LOGISTICS_COL_VOLUM_UNITARI', 'volum_unitari'),
    quantitat: col('LOGISTICS_COL_QUANTITAT', 'quantitat'),
    tipusCarrega: col('LOGISTICS_COL_TIPUS_CARREGA', 'tipus_carrega'),
  };
}

/** PK i columnes coords per UPDATE a la taula d’entregues. */
export function columnMapPersist() {
  return {
    pk: col('LOGISTICS_COL_ENTREGA_PK', 'id'),
    latitud: col('LOGISTICS_COL_LATITUD', 'latitud'),
    longitud: col('LOGISTICS_COL_LONGITUD', 'longitud'),
  };
}

/** Taula `entregues` en mode `joined` (una fila per entrega). */
export function columnMapEntregaTable() {
  return {
    pk: col('LOGISTICS_ENTREGA_PK', 'id'),
    nom: col('LOGISTICS_ENTREGA_NOM', 'nom_entrega'),
    adreca: col('LOGISTICS_ENTREGA_ADRECA', 'adreca'),
    horaInici: col('LOGISTICS_ENTREGA_HORA_INICI', 'hora_inici'),
    horaFi: col('LOGISTICS_ENTREGA_HORA_FI', 'hora_fi'),
    latitud: col('LOGISTICS_ENTREGA_LATITUD', 'latitud'),
    longitud: col('LOGISTICS_ENTREGA_LONGITUD', 'longitud'),
  };
}

/** Taula `pedidos` en mode `joined`. */
export function columnMapPedidoTable() {
  return {
    fkEntrega: col('LOGISTICS_PEDIDO_ENTREGA_ID', 'entrega_id'),
    nom: col('LOGISTICS_PEDIDO_NOM', 'nom_producte'),
    volum: col('LOGISTICS_PEDIDO_VOLUM_UNITARI', 'volum_unitari'),
    quantitat: col('LOGISTICS_PEDIDO_QUANTITAT', 'quantitat'),
    tipus: col('LOGISTICS_PEDIDO_TIPUS_CARREGA', 'tipus_carrega'),
  };
}
