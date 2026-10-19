import type { IncomingMessage, ServerResponse } from 'http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createApp } from '@/server/app';

/**
 * The whole backend: every /api/* request is handed to the Express app in src/server, which runs as
 * one Vercel function (and in `next dev` / `next start` locally). The Pages Router is used for this one
 * route because it passes Node's request/response objects through, which Express needs.
 */
export const config = {
  api: {
    // Express parses bodies itself (JSON, multipart uploads, Meta's signed webhook bytes)
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
  // Long enough for the phone app's 25-second dialer poll, the assistant looking up several answers, call
  // transcription and background jobs that run after a response
  maxDuration: 300,
};

let app: ReturnType<typeof createApp> | undefined;

// Next decorates the request and response with helpers of its own (req.query, res.json, …) as own
// properties, which would hide Express's versions on the prototype. Remove them before Express runs.
const NEXT_REQ_PROPS = ['query', 'body', 'cookies', 'previewData', 'preview', 'draftMode'];
const NEXT_RES_PROPS = ['status', 'send', 'json', 'redirect', 'setDraftMode', 'setPreviewData', 'clearPreviewData', 'revalidate'];

export default function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  app ??= createApp();
  for (const prop of NEXT_REQ_PROPS) delete (req as unknown as Record<string, unknown>)[prop];
  for (const prop of NEXT_RES_PROPS) delete (res as unknown as Record<string, unknown>)[prop];

  return new Promise<void>((resolve) => {
    res.once('finish', () => resolve());
    res.once('close', () => resolve());
    app!(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });
}
