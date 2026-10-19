import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { leadSources } from '../db/schema';
import { metaConfigured, syncSource } from '../services/leadSources';
import { assignWaitingLeads } from '../services/leadAssignment';
import { pollPendingExotelCalls } from '../services/exotel';

async function syncSources(type: 'google_sheet' | 'meta') {
  const sources = await db.select().from(leadSources).where(eq(leadSources.active, true));
  for (const source of sources.filter((s) => s.type === type)) {
    if (type === 'meta' && (!metaConfigured() || !source.config.formIds?.length)) continue;
    try {
      const summary = await syncSource(source);
      if (summary.imported || summary.duplicate || summary.error) {
        console.log(`[LeadSync] ${source.name}: +${summary.imported} new, ${summary.duplicate} repeat, ${summary.error} errors`);
      }
    } catch (err) {
      console.error(`[LeadSync] ${source.name} failed:`, (err as Error).message);
    }
  }
}

/** Every 2 minutes: new rows from active Google Sheets, then hand out leads that were waiting for a BDM */
export async function syncGoogleSheets(): Promise<void> {
  await syncSources('google_sheet');
  await assignWaitingLeads();
}

/** Every 5 minutes: Meta lead forms (webhooks deliver instantly when configured; this catches the rest) */
export async function syncMetaForms(): Promise<void> {
  await syncSources('meta');
}

/** Every minute: duration/recording for Exotel calls whose status webhook didn't arrive */
export async function syncExotelCalls(): Promise<void> {
  await pollPendingExotelCalls();
}
