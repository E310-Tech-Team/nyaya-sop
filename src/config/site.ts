/** Site-wide wording and settings. Change copy here rather than in individual pages. */
export const site = {
  name: 'School of Purpose',
  monogram: 'SOP',
  organisation: 'RCCG Young Adults & Youth',
  programme: 'Purpose Boot Camp',
  formName: 'Expression of Interest Form',
  /** Shown on the welcome screen and under the form. */
  minutesToComplete: 5,
  /**
   * Public contact address for the Programme team. Set VITE_CONTACT_EMAIL at build time;
   * while it's empty, "Contact" links are hidden rather than pointing nowhere.
   */
  contactEmail: (import.meta.env.VITE_CONTACT_EMAIL ?? '').trim(),
} as const;
