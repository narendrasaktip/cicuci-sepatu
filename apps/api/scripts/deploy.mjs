import process from 'node:process';
import { spawnSync } from 'node:child_process';
const url = new URL(process.env.DATABASE_URL ?? '');
if (decodeURIComponent(url.pathname) !== '/cicuci_sepatu_dev') throw new Error('Refusing migration outside cicuci_sepatu_dev');
const result = spawnSync(process.execPath, ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
