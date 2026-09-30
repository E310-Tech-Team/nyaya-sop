import { describe, expect, it } from 'vitest';
import homeAbout from '../../assets/landing/home-about.webp';
import homeProgramme from '../../assets/landing/home-programme.webp';
import doctrine from '../../assets/landing/doctrine-study-group.webp';
import vision from '../../assets/landing/vision-portrait.webp';
import success from '../../assets/success/student-portrait.webp';
import { JOURNEY_ART } from './JourneySection';
import { PHASE_ART } from './programmePhotos';

/** docs/IMAGERY.md §1: the photos are AI-generated, so they must never read as real people or events. */
const CLAIMS = /\b(participants?|applicants?|cohorts?|alumni|graduates?|rccg|nyaya|redemption|boot ?camp|events?)\b/i;

/** The Journey cards and the Programme cards: the photos whose alt text and focus live in data. */
const CARD_PHOTOS = [...JOURNEY_ART, ...Object.values(PHASE_ART)];

describe('supporting photographs (AI-generated)', () => {
  it('use a distinct photo for every editorial placement across pages', () => {
    const photos = [...CARD_PHOTOS.map((photo) => photo.img), homeAbout, homeProgramme, vision, doctrine, success];
    expect(new Set(photos).size).toBe(photos.length);
  });

  it('describe the scene without presenting it as real participants or events', () => {
    for (const { alt } of CARD_PHOTOS) {
      expect(alt.length, alt).toBeGreaterThan(20);
      expect(alt, alt).not.toMatch(CLAIMS);
    }
  });

  it('set a crop focus so faces stay in the wide card crops', () => {
    for (const { alt, focus } of CARD_PHOTOS) expect(focus, alt).toMatch(/^\d{1,3}% \d{1,3}%$/);
  });
});
