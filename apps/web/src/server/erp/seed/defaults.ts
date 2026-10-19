import { sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { companySettings, roles, type SettingType } from '../../db/schema';
import { SYSTEM_ROLES } from '../../lib/erpPermissions';
import { invalidateRoleCache } from '../context';
import { flushSettings } from '../settings';

export const ADDRESS = '306, Venus Benecia Building, Pakwan Cross Road, S.G.Highway, Ahmedabad, Gujarat';

/** Standard text users can insert into a quotation's details paragraph */
export const DEFAULT_DETAILS =
  'Voice Tunes India is a premier multimedia production company specializing in a wide range of video solutions. ' +
  'We offer comprehensive services including Script Writing, Translation in Major Languages, And Professional Voice overs. ' +
  'Our expertise extends to All Kinds of Advertisement and Promotional Video Development, Including Normal Graphic Videos, ' +
  'Motion Graphic Videos, Explainer Videos, 2D And 3D Animations, Corporate Shoots, Product Shoots, Chroma Shoots, Anchor Shoots, ' +
  'Social Media Marketing and More. With a focus on creativity and quality, we ensure every project effectively communicates ' +
  'your message and engages your audience.';

export const TERMS = [
  'Quotation is exclusive of GST (18%).',
  '50% advance payment required before project initiation.',
  'Balance 50% on completion & before delivery of final output.',
  'Standard delivery timelines will be mutually agreed upon based on project duration and complexity.',
  'Includes two rounds of minor revisions. Additional changes will be charged separately.',
  'Final deliverables : Full HD video file (other formats available on request).',
].join('\n');

/** group, key, type, label, default */
export const SETTINGS: [string, string, SettingType, string, unknown][] = [
  ['company', 'company.name', 'string', 'Company name', 'Voice Tunes India'],
  ['company', 'company.address', 'text', 'Address (printed below the logo on quotations)', ADDRESS],
  ['company', 'company.email', 'string', 'Email', 'contact@voicetunes.in'],
  ['company', 'company.phone', 'string', 'Phone', '89808 21377'],
  ['company', 'company.gstin', 'string', 'GSTIN', ''],
  ['company', 'company.website', 'string', 'Website', ''],

  ['quotation', 'quotation.number_prefix', 'string', 'Quotation number prefix', 'QT'],
  ['quotation', 'quotation.currency', 'string', 'Currency code', 'INR'],
  ['quotation', 'quotation.quantity_presets', 'list', 'Quantity dropdown values', [1, 2, 3, 4, 5, 10]],
  ['quotation', 'quotation.default_details', 'text', 'Standard quotation details (company introduction)', DEFAULT_DETAILS],
  ['quotation', 'quotation.terms', 'text', 'Default terms & conditions (one per line)', TERMS],

  ['tax', 'tax.gst_enabled', 'boolean', 'Apply GST', true],
  ['tax', 'tax.gst_rate', 'number', 'GST rate (%)', 18],
];

/**
 * Idempotent, and safe on every API start: creates the system roles (with their default permissions)
 * and the company settings that are missing. Labels and ordering are kept current; permissions an
 * admin granted or revoked and setting values an admin edited are never overwritten.
 */
export async function ensureErpDefaults(): Promise<void> {
  await db
    .insert(roles)
    .values(SYSTEM_ROLES.map(([slug, name, description, permissions]) => ({ slug, name, description, permissions, isSystem: true })))
    .onConflictDoUpdate({ target: roles.slug, set: { isSystem: true } });

  await db
    .insert(companySettings)
    .values(SETTINGS.map(([group, key, type, label, value], order) => ({ group, key, type, label, value: value as never, sortOrder: order })))
    .onConflictDoUpdate({
      target: companySettings.key,
      set: { group: sql`excluded."group"`, type: sql`excluded."type"`, label: sql`excluded."label"`, sortOrder: sql`excluded."sort_order"` },
    });

  invalidateRoleCache();
  flushSettings();
}
