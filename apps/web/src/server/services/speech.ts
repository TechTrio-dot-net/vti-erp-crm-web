/**
 * Speech to text for call recordings and the assistant's microphone button. Any service with the
 * OpenAI-style `POST /audio/transcriptions` endpoint works; it detects the language by itself, so Hindi,
 * English, Hinglish, Marathi, Gujarati… calls all come back as text in the language that was spoken.
 *
 *   TRANSCRIBE_API_KEY   (or OPENAI_API_KEY)
 *   TRANSCRIBE_BASE_URL  default https://api.openai.com/v1 — e.g. https://api.groq.com/openai/v1 for Groq
 *   TRANSCRIBE_MODEL     default whisper-1 — e.g. gpt-4o-transcribe, or whisper-large-v3 on Groq
 *   TRANSCRIBE_LANGUAGE  optional ISO code (hi, en…) to force one language instead of detecting it
 */
const config = () => {
  const apiKey = process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.TRANSCRIBE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.TRANSCRIBE_MODEL || 'whisper-1',
    language: process.env.TRANSCRIBE_LANGUAGE || undefined,
  };
};

export const speechConfigured = () => config() !== null;

export const speechStatus = () => {
  const c = config();
  return c ? { configured: true, model: c.model, host: new URL(c.baseUrl).host } : { configured: false };
};

/** The transcription services refuse files above 25 MB */
export const SPEECH_MAX_BYTES = 25 * 1024 * 1024;

/** Formats the transcription services read; phones also save AMR / 3GP, which they don't */
const SUPPORTED = new Set(['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'opus', 'wav', 'webm', 'aac']);

export class SpeechError extends Error {
  /** false when trying again won't help (unsupported format, file too large, rejected request) */
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

const extension = (fileName: string) => fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

export async function transcribeAudio(
  audio: Buffer,
  fileName: string,
  mimeType: string,
  options: { prompt?: string; timeoutMs?: number } = {}
): Promise<{ text: string; language: string | null }> {
  const c = config();
  if (!c) throw new SpeechError('Speech to text is not set up (TRANSCRIBE_API_KEY)', false);
  const ext = extension(fileName);
  if (ext && !SUPPORTED.has(ext)) {
    throw new SpeechError(`The recording is a .${ext} file, which speech to text can't read. If the phone's call recorder can save M4A or MP3, switch it to that.`, false);
  }
  if (!audio.length) throw new SpeechError('The recording is empty', false);
  if (audio.length > SPEECH_MAX_BYTES) throw new SpeechError(`The recording is ${Math.round(audio.length / 1048576)} MB; speech to text accepts up to 25 MB`, false);

  const form = new FormData();
  // OpenAI names the format by the file extension; .opus is Ogg audio
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), ext === 'opus' ? fileName.replace(/\.opus$/i, '.ogg') : fileName);
  form.append('model', c.model);
  // Whisper models also report the language they detected
  form.append('response_format', c.model.includes('whisper') ? 'verbose_json' : 'json');
  if (c.language) form.append('language', c.language);
  if (options.prompt) form.append('prompt', options.prompt);

  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
  } catch (err) {
    throw new SpeechError(`Could not reach the speech-to-text service: ${(err as Error).message}`, true);
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; language?: string; error?: { message?: string } };
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new SpeechError(`Speech to text failed (${res.status}): ${body.error?.message ?? 'no details'}`.slice(0, 500), retryable);
  }
  return { text: (body.text ?? '').trim(), language: body.language ?? null };
}
