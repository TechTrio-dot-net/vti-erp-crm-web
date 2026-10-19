import { SERVICE_FIELDS, type ServiceField } from '../db/schema';

export const SERVICE_VIDEO_EDITING = 'video-editing';
export const SERVICE_VOICE_OVER = 'voice-over';
export const SERVICE_DUBBING = 'dubbing';
export const SERVICE_SOCIAL_MEDIA_MARKETING = 'social-media-marketing';
export const SERVICE_WEBSITE = 'website';

export const SERVICE_STATUSES = ['active', 'coming_soon', 'inactive'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Seed defaults for the services shipped with the app; live values are on each service's `fields` */
export const DEFAULT_SERVICE_FIELDS: Record<string, ServiceField[]> = {
  [SERVICE_VIDEO_EDITING]: ['artist_id', 'video_type_id'],
  [SERVICE_VOICE_OVER]: ['artist_id', 'language_id'],
  [SERVICE_DUBBING]: ['artist_id', 'source_language_id', 'language_id'],
};

type ServiceLike = { slug: string; fields: string[] | null; active: boolean; comingSoon: boolean; artistRestricted: boolean };

export function serviceStatus(service: Pick<ServiceLike, 'active' | 'comingSoon'>): ServiceStatus {
  return !service.active ? 'inactive' : service.comingSoon ? 'coming_soon' : 'active';
}

export function statusColumns(status: ServiceStatus): { active: boolean; comingSoon: boolean } {
  return { active: status !== 'inactive', comingSoon: status === 'coming_soon' };
}

/** The service's quotation form fields, filtered and ordered */
export function quotationFields(service: Pick<ServiceLike, 'fields' | 'slug'>): ServiceField[] {
  const fields = service.fields?.length ? service.fields : (DEFAULT_SERVICE_FIELDS[service.slug] ?? []);
  return SERVICE_FIELDS.filter((field) => fields.includes(field));
}

/** Quotations can be written for active services (a service with no fields is quoted per unit) */
export function isQuotable(service: Pick<ServiceLike, 'active' | 'comingSoon'>): boolean {
  return serviceStatus(service) === 'active';
}

/** Choosing this service's artist needs artists.assign (video editing) */
export function restrictsArtistSelection(service: Pick<ServiceLike, 'fields' | 'slug' | 'artistRestricted'>): boolean {
  return service.artistRestricted && quotationFields(service).includes('artist_id');
}

/** Lowercase, non-alphanumerics collapsed to single dashes */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
