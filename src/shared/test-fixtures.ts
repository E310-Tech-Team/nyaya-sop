/** Test-only helpers (imported by *.test.ts files, never by the app). */
import { CONSENT_VERSION, type ApplicationPayload } from './application';

/** A complete, valid application with deliberately messy spacing/casing to exercise normalisation. */
export const validPayload = (overrides: Partial<ApplicationPayload> = {}): ApplicationPayload => ({
  fullName: '  Adaeze   Okafor ',
  email: ' Ada.Okafor@Example.COM ',
  phone: '0801 234 5678',
  gender: 'female',
  ageRange: '21_24',
  stateOfResidence: 'Lagos',
  city: 'Ikeja',
  // The parish question while the directory is off (the default in tests): its name is required.
  parishName: '  Grace   Chapel ',
  educationLevel: 'bachelors',
  currentStatus: 'employed',
  purposeClarity: 3,
  consentVersion: CONSENT_VERSION,
  ...overrides,
});
