import { env } from './env.js';

export const supabaseConfig = {
  url: env.supabaseUrl,
  anonKey: env.supabaseAnonKey,
};

export const isSupabaseConfigured = Boolean(
  supabaseConfig.url && supabaseConfig.anonKey,
);
