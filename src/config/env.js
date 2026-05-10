import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arrelProjecte = join(__dirname, '..', '..');

dotenv.config({ path: join(arrelProjecte, '.env') });
dotenv.config({ path: join(arrelProjecte, '.env.local'), override: true });

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN,
};
