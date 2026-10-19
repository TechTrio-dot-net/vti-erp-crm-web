import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { users } from '../db/schema';
import { authMiddleware, requireRole, type AuthRequest } from '../lib/auth';
import { aiConfigured, AI_MODEL } from '../lib/ai';
import { HttpError, sendError } from '../lib/http';
import { MAX_UPLOAD_BYTES } from '../lib/storage';
import { askAssistant, type ChatTurn } from '../services/assistant';
import { SpeechError, speechConfigured, speechStatus, transcribeAudio } from '../services/speech';

/** The super admin's AI assistant: questions in any language, typed or spoken */
const router = Router();
router.use(authMiddleware, requireRole('SUPER_ADMIN'));

const MAX_TURNS = 40;
const MAX_CHARS = 10_000;

router.get('/status', (_req, res) => {
  res.json({ ai: aiConfigured() ? { configured: true, model: AI_MODEL } : { configured: false }, speech: speechStatus() });
});

router.post('/chat', async (req: AuthRequest, res) => {
  try {
    if (!aiConfigured()) throw new HttpError(503, 'The assistant is not set up — add ANTHROPIC_API_KEY to the environment variables and redeploy');
    const raw: unknown[] = Array.isArray(req.body?.messages) ? req.body.messages.slice(-MAX_TURNS) : [];
    const turns: ChatTurn[] = [];
    for (const m of raw as Array<Record<string, unknown>>) {
      if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) continue;
      turns.push({ role: m.role, content: m.content.slice(0, MAX_CHARS) });
    }
    // The conversation starts and ends with the admin
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw new HttpError(400, 'Ask a question');
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    res.json(await askAssistant(turns, { name: me?.name ?? 'the super admin' }));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ message: 'The assistant is busy — try again in a minute' });
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ message: 'ANTHROPIC_API_KEY was rejected — check the key' });
    if (err instanceof Anthropic.APIError) {
      console.error('[Assistant] Claude API error:', err.status, err.message);
      return res.status(502).json({ message: 'The assistant could not answer right now — try again' });
    }
    sendError(res, err, 'The assistant could not answer');
  }
});

// Spoken questions: a few seconds to a couple of minutes of browser audio (webm/ogg/mp4)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

router.post('/transcribe', upload.single('audio'), async (req: AuthRequest, res) => {
  try {
    if (!speechConfigured()) throw new HttpError(503, 'Voice input is not set up — add TRANSCRIBE_API_KEY (or OPENAI_API_KEY)');
    if (!req.file?.buffer.length) throw new HttpError(400, 'No audio received');
    const type = req.file.mimetype.split(';')[0];
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'webm';
    const { text, language } = await transcribeAudio(req.file.buffer, `question.${ext}`, type, { timeoutMs: 45_000 });
    res.json({ text, language });
  } catch (err) {
    if (err instanceof SpeechError) return res.status(err.retryable ? 502 : 400).json({ message: err.message });
    sendError(res, err, 'Could not understand the audio');
  }
});

export default router;
