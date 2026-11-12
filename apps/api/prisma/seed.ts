import argon2 from 'argon2';
import { z } from 'zod';
import { db } from '../src/lib/db.js';
const input = z.object({ OWNER_EMAIL: z.string().email(), OWNER_PASSWORD: z.string().min(12).max(128), OWNER_NAME: z.string().min(1).default('Owner') }).parse(process.env);
try {
  await db.user.create({ data: { email: input.OWNER_EMAIL.toLowerCase(), name: input.OWNER_NAME, passwordHash: await argon2.hash(input.OWNER_PASSWORD, { type: argon2.argon2id }), role: 'OWNER' } });
  console.info('Owner dibuat. Hapus OWNER_PASSWORD dari environment setelah bootstrap.');
} finally { await db.$disconnect(); }
