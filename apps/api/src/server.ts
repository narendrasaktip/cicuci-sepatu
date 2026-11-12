import { app } from './app.js';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
const server = app.listen(config.PORT, '127.0.0.1', () => console.info(`API listening on ${config.PORT}`));
async function shutdown() { server.close(async () => { await db.$disconnect(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
