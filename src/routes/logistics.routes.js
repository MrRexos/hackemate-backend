/**
 * Rutes de diagnòstic logística → Supabase (només desenvolupament / proves manuals).
 */
import { Router } from 'express';

import { env } from '../config/env.js';
import { fetchEntregasFromSource } from '../data/repository.js';

const router = Router();

/**
 * GET /api/logistics/integration-config
 * Resum de configuració (sense secrets) per alinear amb les taules del company.
 */
router.get('/integration-config', (req, res) => {
  const apiKeyPresent = !!(
    env.supabaseServiceRoleKey || env.supabasePublishableKey || env.supabaseAnonKey
  );
  res.json({
    supabaseUrlPresent: !!env.supabaseUrl,
    apiKeyPresent,
    sourceMode: env.logisticsSourceMode,
    flatView: env.logisticsSourceMode === 'flat' ? env.logisticsFlatView : null,
    tableEntregues: env.logisticsSourceMode === 'joined' ? env.logisticsTableEntregues : null,
    tablePedidos: env.logisticsSourceMode === 'joined' ? env.logisticsTablePedidos : null,
    entreguesPersistenceTable: env.logisticsEntreguesTable,
    hint:
      env.logisticsSourceMode === 'joined'
        ? 'Mode joined: defineix LOGISTICS_TABLE_ENTREGUES i LOGISTICS_TABLE_PEDIDOS + columnes LOGISTICS_ENTREGA_* / LOGISTICS_PEDIDO_* al .env.local'
        : 'Mode flat: defineix LOGISTICS_FLAT_VIEW (vista o taula amb una fila per producte)',
  });
});

/**
 * GET /api/logistics/entregues-preview
 * Carrega entregues agrupades des de la font pla (pot tardar si hi ha molta geocodificació).
 */
router.get('/entregues-preview', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 100);
    const entregues = await fetchEntregasFromSource();
    const slice = entregues.slice(0, limit);

    res.json({
      ok: true,
      sourceMode: env.logisticsSourceMode,
      fontPla: env.logisticsSourceMode === 'flat' ? env.logisticsFlatView : null,
      tableEntregues: env.logisticsSourceMode === 'joined' ? env.logisticsTableEntregues : null,
      tablePedidos: env.logisticsSourceMode === 'joined' ? env.logisticsTablePedidos : null,
      taulaCoords: env.logisticsEntreguesTable,
      totalEntregues: entregues.length,
      mostrades: slice.length,
      entregues: slice.map((e) => ({
        identificador: e.identificador,
        nom: e.nom,
        volumTotal: e.volumTotal,
        numPedidos: e.pedidos.length,
        coordenades: e.coordenades,
      })),
    });
  } catch (err) {
    const msg = String(err?.message ?? err);
    const senseConfig = msg.includes('Configuració Supabase');
    res.status(senseConfig ? 503 : 500).json({
      ok: false,
      error: msg,
      hint: senseConfig ? 'Revisa SUPABASE_URL i clau API al .env / .env.local' : undefined,
    });
  }
});

export default router;
