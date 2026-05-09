/**
 * Connexió a Supabase (API REST). Les credencials han de venir només de `process.env`
 * (carregades via `dotenv` des de {@link ../config/env.js}).
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Comprova que hi ha URL i clau (servei o anon). Llança si falta configuració.
 */
function supabaseApiKey() {
  return (
    env.supabaseServiceRoleKey || env.supabasePublishableKey || env.supabaseAnonKey || ''
  ).trim();
}

export function assertSupabaseConfigured() {
  const url = env.supabaseUrl;
  const key = supabaseApiKey();
  if (!url) {
    throw new Error(
      'Configuració Supabase: definex SUPABASE_URL al .env (ex.: https://xxxx.supabase.co).',
    );
  }
  if (!key) {
    throw new Error(
      'Configuració Supabase: definex SUPABASE_SERVICE_ROLE_KEY (recomanat per UPDATE), SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY al .env.',
    );
  }
}

/**
 * Client Supabase per consultes i actualitzacions des del servidor.
 * Preferir `SUPABASE_SERVICE_ROLE_KEY` per poder fer UPDATE de coordenades amb RLS típic.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createSupabaseClient() {
  assertSupabaseConfigured();
  const key = supabaseApiKey();
  return createClient(env.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
