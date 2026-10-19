/**
 * Public addresses of this deployment. On Vercel they default to the project's production domain, so
 * WEB_URL only needs setting for a custom domain; locally everything runs on http://localhost:3000.
 */
const trim = (url: string) => url.replace(/\/+$/, '');

/** The website's address, used in emails and links */
export function siteUrl(): string {
  if (process.env.WEB_URL) return trim(process.env.WEB_URL);
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${trim(vercelHost)}`;
  return 'http://localhost:3000';
}

/** Where Meta and Exotel can reach the webhooks; unset while running on localhost */
export function publicApiUrl(): string | undefined {
  if (process.env.PUBLIC_API_URL) return trim(process.env.PUBLIC_API_URL);
  const site = siteUrl();
  return /\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(site) ? undefined : site;
}
