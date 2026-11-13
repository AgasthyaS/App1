/**
 * Facts the legal documents depend on, in one place.
 *
 * Values in [square brackets] are placeholders the operator must fill in
 * before public release — the Legal screen flags them in development builds.
 */
export const LEGAL = {
  product: 'Greenr',
  /** the company or person legally responsible for the app */
  operator: '[Operator legal name]',
  address: '[Registered postal address]',
  /** governing law and courts, e.g. "the State of California, USA" */
  jurisdiction: '[Governing jurisdiction]',
  supportEmail: 'support@greenr.app',
  privacyEmail: 'support@greenr.app',
  webUrl: 'https://greenr-app.vercel.app',
  /** limited hardware warranty length for Greenr sensors */
  hardwareWarrantyMonths: 12,
  /** raw usage events are purged after this (see analytics_purge in supabase-analytics.sql) */
  analyticsRetentionMonths: 13,
  minimumAge: 13,
  effective: 'November 12, 2026',
} as const;

export const LEGAL_PLACEHOLDERS_REMAIN = Object.values(LEGAL).some(
  (v) => typeof v === 'string' && v.startsWith('['),
);

export interface LegalDoc {
  route: string;
  title: string;
  blurb: string;
  icon: string;
}

/** Every policy, in the order the Legal hub lists them. */
export const LEGAL_DOCS: LegalDoc[] = [
  { route: '/privacy', title: 'Privacy Policy', blurb: 'What we collect, why, and your rights', icon: 'hand-left' },
  { route: '/terms', title: 'Terms of Service', blurb: 'The agreement for using Greenr', icon: 'document-text' },
  { route: '/cookies', title: 'Cookies & Local Storage', blurb: 'What the app stores on your device', icon: 'server' },
  { route: '/acceptable-use', title: 'Acceptable Use Policy', blurb: 'What you may not do with Greenr', icon: 'shield-checkmark' },
  { route: '/subscription-terms', title: 'Greenr+ Subscription Terms', blurb: 'Billing, renewal, cancellation and refunds', icon: 'card' },
  { route: '/hardware-warranty', title: 'Sensor Warranty & Safety', blurb: 'Using Greenr sensors safely; what’s covered', icon: 'hardware-chip' },
  { route: '/data-deletion', title: 'Delete Your Data', blurb: 'How to erase your account and everything in it', icon: 'trash' },
];
