import { describe, expect, it } from 'vitest';
import { entranceLength, HERO_DESKTOP, HERO_PHONE_COPY, HERO_PHONE_PHOTO, PHONE_PHOTO_DELAY, type Beat } from './heroMotion';

/** The moves that carry the entrance (rises, blooms, sweeps); short fades and draws ride along. */
const MAIN_MOVES = ['panel', 'glow', 'photo', 'ring', 'eyebrow', 'lines', 'header', 'summary', 'eligibility', 'actions', 'caption', 'dots'];

const mainMoves = (beats: Record<string, Beat>) => Object.entries(beats).filter(([name]) => MAIN_MOVES.includes(name));

describe('hero entrance timing (docs/04 §6)', () => {
  it('takes about 2.5 s on desktop and about 2 s on phones', () => {
    expect(entranceLength(HERO_DESKTOP)).toBeGreaterThanOrEqual(2.2);
    expect(entranceLength(HERO_DESKTOP)).toBeLessThanOrEqual(2.6);
    expect(entranceLength(HERO_PHONE_COPY)).toBeGreaterThanOrEqual(1.7);
    expect(entranceLength(HERO_PHONE_COPY)).toBeLessThanOrEqual(2.1);
    expect(entranceLength(HERO_PHONE_PHOTO)).toBeLessThanOrEqual(2.1);
  });

  it('puts the message first: the headline starts within 0.5 s and its last line lands within 1.8 s', () => {
    for (const beats of [HERO_DESKTOP, HERO_PHONE_COPY]) {
      const { lines } = beats;
      expect(lines.at).toBeLessThanOrEqual(0.5);
      expect(lines.at + lines.step * (lines.count - 1) + lines.for).toBeLessThanOrEqual(1.8);
      expect(beats.lines.at).toBeLessThanOrEqual(beats.summary.at);
      expect(beats.summary.at).toBeLessThanOrEqual(beats.actions.at);
    }
  });

  it('keeps every main move between 0.9 and 1.4 s, with long soft landings rather than quick cuts', () => {
    for (const beats of [HERO_DESKTOP, HERO_PHONE_COPY, HERO_PHONE_PHOTO]) {
      for (const [name, beat] of mainMoves(beats)) {
        expect(beat.for, name).toBeGreaterThanOrEqual(0.9);
        expect(beat.for, name).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('shows the phone photograph soon after the copy when it is already in view', () => {
    expect(PHONE_PHOTO_DELAY).toBeGreaterThan(0);
    expect(PHONE_PHOTO_DELAY).toBeLessThanOrEqual(0.3);
  });
});
