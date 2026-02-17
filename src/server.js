import app from './app.js';
import { config } from './shared/config/env.js';
import { connectDb, disconnectDb } from './shared/config/db.js';

const server = app.listen(config.port, async () => {
  const dbOk = await connectDb();
  console.log(`[server] Listening on http://localhost:${config.port}`);
  console.log(`[server] API base: http://localhost:${config.port}/api`);
  if (dbOk) {
    console.log('[server] Database connected successfully');
  } else {
    console.warn('[server] Database not connected. Set DATABASE_URL in .env and run: npx prisma migrate dev');
  }
});

const shutdown = () => {
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
