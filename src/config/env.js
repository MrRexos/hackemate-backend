import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arrelProjecte = join(__dirname, '..', '..');

// `.env` base + `.env.local` (prioritat; no es commitirà — vegeu `.gitignore`)
dotenv.config({ path: join(arrelProjecte, '.env') });
dotenv.config({ path: join(arrelProjecte, '.env.local'), override: true });

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN,
  /** URL projecte Supabase (`https://xxx.supabase.co`). Obligatori per al repositori logístic. */
  supabaseUrl: process.env.SUPABASE_URL?.trim(),
  /** Clau JWT «anon» clàssica (dashboard → API). */
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim(),
  /** Clau pública tipus `sb_publishable_…` (substitueix anon si el dashboard només en mostra una d’aquestes). */
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY?.trim(),
  /** Clau de servei (recomanada al servidor per UPDATE sense RLS); fallback a anon/publishable. */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  /**
   * `flat` = una vista/taula amb una fila per línia de producte.
   * `joined` = dues taules (`LOGISTICS_TABLE_*`) que es llegeixen per separat.
   */
  logisticsSourceMode: (() => {
    // Per defecte `joined`: mateixes taules que `database/supabase-logistics-schema.sql` (no cal la vista pla).
    const m = (process.env.LOGISTICS_SOURCE_MODE ?? 'joined').toLowerCase().trim();
    return m === 'flat' ? 'flat' : 'joined';
  })(),
  /** Nom vista/taula mode pla (SELECT *). */
  logisticsFlatView: process.env.LOGISTICS_FLAT_VIEW ?? 'logistics_entregues_pedidos_pla',
  /** Taula entregues mode `joined`. */
  logisticsTableEntregues: process.env.LOGISTICS_TABLE_ENTREGUES?.trim() ?? 'logistics_entregues',
  /** Taula línies de producte mode `joined`. */
  logisticsTablePedidos: process.env.LOGISTICS_TABLE_PEDIDOS?.trim() ?? 'logistics_pedidos',
  /** Taula on fer UPDATE de lat/long (sol coincidir amb la taula d’entregues del company). */
  logisticsEntreguesTable: process.env.LOGISTICS_ENTREGUES_TABLE ?? 'logistics_entregues',
};
