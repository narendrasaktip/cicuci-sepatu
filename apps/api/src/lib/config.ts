import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().startsWith('mysql://'),
  REDIS_URL: z.string().url(),
  APP_BASE_URL: z.string().url().default('http://127.0.0.1:5173'),
}).parse(process.env);
