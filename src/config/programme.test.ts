import { describe, expect, it } from 'vitest';
import { MAIN_NAV } from '../components/marketing/nav';
import { FAQ, FAQ_PREVIEW, FAQ_TOPICS, JOURNEY, PROGRAMME_PHASES, SELECTED_ONLY } from './programme';

describe('marketing pages content', () => {
  it('links the five destinations, in order', () => {
    expect(MAIN_NAV.map((item) => `${item.label} ${item.to}`)).toEqual([
      'Home /',
      'About /about',
      'Programme /programme',
      'Journey /journey',
      'FAQ /faq',
    ]);
  });

  it('previews only questions that exist in the FAQ (the homepage looks them up by text)', () => {
    const questions = FAQ.map((entry) => entry.question);
    for (const question of FAQ_PREVIEW) expect(questions).toContain(question);
  });

  it('shows every FAQ entry on the FAQ page, in a group that is never empty', () => {
    const topics = FAQ_TOPICS.map((group) => group.topic);
    for (const entry of FAQ) expect(topics).toContain(entry.topic);
    for (const topic of topics) expect(FAQ.some((entry) => entry.topic === topic)).toBe(true);
  });

  it('keeps the six journey stages in their order', () => {
    expect(JOURNEY.map((stage) => `${stage.num} ${stage.name}`)).toEqual([
      '01 Apply',
      '02 Virtual Training',
      '03 Merit Selection',
      '04 Physical Boot Camp',
      '05 Mentorship',
      '06 Community',
    ]);
  });

  it('marks the physical boot camp, and only it, as for selected participants', () => {
    expect(JOURNEY.filter((stage) => stage.condition).map((stage) => [stage.name, stage.condition])).toEqual([
      ['Physical Boot Camp', SELECTED_ONLY],
    ]);
    expect(PROGRAMME_PHASES.filter((phase) => phase.conditional).map((phase) => phase.key)).toEqual(['bootcamp']);
  });
});
