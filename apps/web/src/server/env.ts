/**
 * Loads .env / .env.local the same way Next.js does, for command-line scripts (seed, migrations,
 * imports) that run outside Next. Inside the app Next has already loaded them, so this is a no-op there.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
