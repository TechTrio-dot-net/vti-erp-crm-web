import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { setupModules } from './modules/index';
import { siteUrl } from './lib/publicUrl';

// Timestamps computed in raw SQL arrive as "2026-09-13 10:22:47.361+00", which Safari's Date can't parse.
// Emit every such value as ISO 8601 like the rest of the API.
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?)$/;

const allowedOrigins = new Set(
  [siteUrl(), process.env.WEB_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, 'http://localhost:3000', 'http://127.0.0.1:3000']
    .filter((o): o is string => !!o)
    .map((o) => o.replace(/\/$/, ''))
);

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, origin ?? true);
    return callback(null, false);
  },
  credentials: true,
};

/**
 * The HTTP application. It never listens itself: src/pages/api/[...path].ts hands it every /api request
 * (on Vercel and in `next dev`), and the tests call it directly.
 */
export function createApp(): express.Express {
  const app = express();

  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'string' && value.length <= 35 && PG_TIMESTAMP.test(value) ? new Date(value).toISOString() : value
  );
  // Behind Vercel's proxy, so X-Forwarded-For is the real client IP (activity log, rate limits)
  app.set('trust proxy', 1);

  app.use(cors(corsOptions));
  // Vercel compresses responses at its edge; compress here only when serving directly
  if (!process.env.VERCEL) app.use(compression());
  app.use(
    express.json({
      limit: '1mb',
      // Meta signs the exact request bytes, so keep them for the webhook's signature check
      verify: (req, _res, buf) => {
        if ((req as express.Request).originalUrl?.startsWith('/api/integrations/meta/webhook')) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    })
  );
  app.use(cookieParser());

  app.get('/api/health', (_, res) => res.json({ status: 'ok', db: 'postgres', ts: Date.now() }));
  setupModules(app);

  return app;
}
