import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude, for the super admin's assistant and call summaries. Set ANTHROPIC_API_KEY (console.anthropic.com);
 * ASSISTANT_MODEL overrides the model.
 */
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export const AI_MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5';

/**
 * If Claude's safety filters decline a request, the API re-runs it on the recommended fallback model
 * instead of returning the refusal.
 */
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** The text blocks of a response, joined */
export const responseText = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
