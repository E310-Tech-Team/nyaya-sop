import { site } from '../../config/site';

/** Main navigation: one dedicated page per destination (desktop nav, mobile menu and footer). */
export const MAIN_NAV = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Programme', to: '/programme' },
  { label: 'Journey', to: '/journey' },
  { label: 'FAQ', to: '/faq' },
] as const;

/** "Contact" jumps to the footer (on every page) once a contact email is configured. */
export const CONTACT_LINK = site.contactEmail ? ({ label: 'Contact', href: '#contact' } as const) : null;
