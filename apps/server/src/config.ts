import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  dataDir: env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  get dbPath() {
    return env.DB_PATH ?? path.join(this.dataDir, 'easy-kanban.db');
  },
  adminEmail: env.ADMIN_EMAIL ?? 'admin@local',
  adminPassword: env.ADMIN_PASSWORD ?? 'changeme',
  adminName: env.ADMIN_NAME ?? 'Admin',
  /** If unset a random secret is generated and persisted in the DB. */
  jwtSecret: env.JWT_SECRET ?? '',
  tokenTtlDays: Number(env.TOKEN_TTL_DAYS ?? 30),
  /** Comma separated list of allowed origins for CORS (for a separately
   *  hosted mobile/web client). "*" allows any. */
  corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  webDir: env.WEB_DIR ?? path.resolve(process.cwd(), 'apps/web/dist'),
  /** Mark agents offline when no heartbeat/activity for this many minutes */
  agentOfflineMinutes: Number(env.AGENT_OFFLINE_MINUTES ?? 15),
  /** Running agent runs older than this are marked failed (stale). 0 = off */
  staleRunHours: Number(env.STALE_RUN_HOURS ?? 6),
  publicUrl: env.PUBLIC_URL ?? '',
};
