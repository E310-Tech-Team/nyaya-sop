import { site } from './site';

/**
 * Programme facts used on the landing page, the welcome screen and in the FAQ.
 *
 * Every statement here comes from the approved site copy (the original journey stages,
 * welcome checklist and success-page steps; see docs/01-PRD.md §1). Don't add dates, fees,
 * attendance rules, selection criteria, response times or contact details until the
 * Programme team confirms them (open questions are listed in docs/06-Implementation-Plan.md).
 */

/**
 * Homepage hero, in reading order. The training length lives in "What to expect" and the time
 * to apply on the welcome screen, so the hero stays short.
 */
export const HERO_COPY = {
  eyebrow: 'School of Purpose · First Edition',
  headline: ['Discover your purpose.', 'Prepare to lead.'],
  summary: 'Purpose Boot Camp equips young Christians to influence the Church, marketplace and nation.',
  eligibility: 'For RCCG members aged 18–30',
  /** The edition's name, shown once as a small caption by the photograph. */
  edition: 'The Called Generation',
} as const;

/** Organisation-level wording (About page and the homepage preview), verbatim from the site. */
export const ABOUT_COPY = {
  organisation: 'RCCG National Young Adults & Youth',
  calling:
    "God is calling RCCG's young people to influence the Church, transform the marketplace and impact the nation. Purpose Boot Camp is where that journey begins.",
  statement:
    'We are building a generation of purpose-driven Christians who become voices transforming the Church, marketplace and nation.',
  vision:
    'To raise purpose-driven young Christians with spiritual depth, character and competence, equipped to lead with Kingdom impact.',
  mission:
    'To discover, train and mentor RCCG young adults and youth into influential leaders who serve the Church, marketplace and nation.',
  /** The three spheres named in the calling above. */
  spheres: ['Influence the Church', 'Transform the marketplace', 'Impact the nation'],
} as const;

/** The first edition of Purpose Boot Camp. */
export const EDITION = {
  label: 'First Edition',
  name: 'The Called Generation',
  tagline: 'Move from limited knowledge to influential leadership—with purpose.',
} as const;

/** The Doctrine of Purpose: the three questions behind the curriculum. */
export const DOCTRINE = {
  intro: 'Three questions shape everything taught in the curriculum.',
  questions: [
    { n: 'I', q: 'Why Am I Here?', a: 'Purpose precedes production. You were made for an assignment.' },
    { n: 'II', q: 'What Am I Meant To Do?', a: 'Purpose becomes clearer through burden, gift, grace and enduring desire.' },
    { n: 'III', q: 'What Happens Outside Purpose?', a: 'Busyness without assignment can produce activity without lasting fruit.' },
  ],
} as const;

export type ExpectationItem = {
  /** When this happens, and whether it applies to everyone. */
  when: string;
  title: string;
  /** Duration / format, or the condition that applies. */
  facts: string;
  body: string;
  /** Applies only to selected participants: styled and worded as conditional. */
  conditional?: boolean;
};

/** "What to expect": the practical shape of the programme, in order. */
export const WHAT_TO_EXPECT: readonly ExpectationItem[] = [
  {
    when: 'First',
    title: 'Virtual training',
    facts: '8 weeks · Online',
    body: '16 live sessions and 32 contact hours of worship, teaching, squad discussion and assessment.',
  },
  {
    when: 'Then',
    title: 'Merit-based selection',
    facts: 'Not everyone is selected',
    body: 'Participants are graded on a transparent 100-point system. Only top performers go on to the physical boot camp.',
  },
  {
    when: 'If selected',
    title: 'Physical boot camp',
    facts: '10 fully sponsored days · Redemption City',
    body: 'For selected participants only: accommodation, meals, transport and 24/7 support are covered.',
    conditional: true,
  },
  {
    when: 'Afterwards',
    title: 'Mentorship, then community',
    facts: '12 months, then 2 years',
    body: '12 months of personalised mentorship, followed by two years in a relevant pillar community.',
  },
];

/** The label on everything that applies only to people selected on merit. */
export const SELECTED_ONLY = 'Selected participants only';

export type ProgrammePhase = {
  key: 'training' | 'selection' | 'bootcamp' | 'community';
  when: string;
  title: string;
  facts: readonly string[];
  body: string;
  next?: string;
  conditional?: boolean;
};

/** The Programme page's detailed walk-through of what participants can expect. */
export const PROGRAMME_PHASES: readonly ProgrammePhase[] = [
  {
    key: 'training',
    when: 'First',
    title: 'Virtual training',
    facts: ['8 weeks', 'Online', '16 live sessions', '32 contact hours'],
    body: 'Worship, teaching, squad discussion and assessment.',
    next: 'Leads to merit selection.',
  },
  {
    key: 'selection',
    when: 'Then',
    title: 'Merit-based selection',
    facts: ['Transparent 100-point system'],
    body: 'Participants are graded on merit, and only top performers are selected for the physical boot camp. Applying does not guarantee a place.',
  },
  {
    key: 'bootcamp',
    when: 'If selected',
    title: 'Physical boot camp',
    facts: ['10 days', 'Redemption City', 'Fully sponsored'],
    body: 'For selected participants only. Sponsorship covers accommodation, meals, transport and 24/7 support.',
    next: 'Continues into 12 months of mentorship.',
    conditional: true,
  },
  {
    key: 'community',
    when: 'Afterwards',
    title: 'Mentorship and community',
    facts: ['12 months of mentorship', '2 years in community'],
    body: 'Personalised mentorship in small groups, guided by 200+ vetted senior mentors. Graduates then join a relevant pillar community for two years, to serve, connect and create opportunities across eight communities.',
  },
];

export type JourneyStage = {
  num: string;
  name: string;
  /** Duration and format, where confirmed. */
  meta: readonly string[];
  /** What happens at this stage. */
  body: string;
  /** Who the stage is for, when it isn't everyone. Always shown. */
  condition?: string;
  /** How participants move on, where confirmed. */
  next?: string;
};

/** The six stages of the participant journey (landing page, both layouts). */
export const JOURNEY: readonly JourneyStage[] = [
  {
    num: '01',
    name: 'Apply',
    meta: [`About ${site.minutesToComplete} minutes`, 'Online form'],
    body: 'Open to RCCG young adults and youth aged 18–30.',
    next: 'The Programme team reviews every application.',
  },
  {
    num: '02',
    name: 'Virtual Training',
    meta: ['8 weeks', 'Online', '16 live sessions', '32 contact hours'],
    body: 'Worship, teaching, squad discussion and assessment.',
    next: 'Leads to merit selection.',
  },
  {
    num: '03',
    name: 'Merit Selection',
    meta: ['Transparent 100-point system'],
    body: 'Participants are graded on merit.',
    next: 'Only top performers are selected for the boot camp.',
  },
  {
    num: '04',
    name: 'Physical Boot Camp',
    meta: ['10 days', 'Redemption City', 'Fully sponsored'],
    body: 'Accommodation, meals, transport and 24/7 support are covered.',
    condition: SELECTED_ONLY,
    next: 'Continues into 12 months of mentorship.',
  },
  {
    num: '05',
    name: 'Mentorship',
    meta: ['12 months', 'Small groups'],
    body: 'Personalised mentorship guided by 200+ vetted senior mentors.',
    next: 'Followed by two years in community.',
  },
  {
    num: '06',
    name: 'Community',
    meta: ['2 years', 'Eight communities'],
    body: 'Serve, connect and create opportunities in a relevant pillar community.',
  },
];

export type FaqTopic = 'applying' | 'programme' | 'selection';
export type FaqEntry = { question: string; answer: string; topic: FaqTopic };

export const FAQ: readonly FaqEntry[] = [
  {
    question: 'Who can apply?',
    topic: 'applying',
    answer:
      'RCCG members aged 18–30: young adults and youth. You confirm this at the start of the application, before the first question.',
  },
  {
    question: 'How does virtual training work?',
    topic: 'programme',
    answer:
      'It is the first stage of the programme: 8 weeks online, with 16 live sessions and 32 contact hours of worship, teaching, squad discussion and assessment. If you are selected, the email from the Programme team includes the virtual training details.',
  },
  {
    question: 'Is everyone selected for the physical boot camp?',
    topic: 'selection',
    answer:
      'No. Selection is merit-based: participants are graded on a transparent 100-point system and only top performers are selected. Applying does not guarantee a place.',
  },
  {
    question: 'What does sponsorship cover?',
    topic: 'selection',
    answer:
      'Participants selected for the physical boot camp receive 10 fully sponsored days, covering accommodation, meals, transport and 24/7 support. Sponsorship applies only to selected participants.',
  },
  {
    question: 'Where is the physical boot camp?',
    topic: 'selection',
    answer: 'At Redemption City. It lasts 10 days and is only for participants selected on merit.',
  },
  {
    question: 'What happens after the boot camp?',
    topic: 'programme',
    answer:
      '12 months of personalised mentorship in small groups, guided by 200+ vetted senior mentors. Graduates then spend two years in a relevant pillar community, serving, connecting and creating opportunities.',
  },
  {
    question: 'What happens after submitting an application?',
    topic: 'applying',
    answer:
      'You will see a reference number straight away. Keep a note of it: no confirmation email is sent. The Programme team then reviews your responses and emails you an update. If you are selected, that email includes the virtual training details.',
  },
];

/** FAQ page groups, in reading order, each with a link to the page that says more. */
export const FAQ_TOPICS: readonly { topic: FaqTopic; title: string; link: { to: string; label: string } }[] = [
  { topic: 'applying', title: 'Applying', link: { to: '/apply', label: 'Start my application' } },
  { topic: 'programme', title: 'The programme', link: { to: '/programme', label: 'Explore the programme' } },
  { topic: 'selection', title: 'Selection and the boot camp', link: { to: '/journey', label: 'See the full journey' } },
];

/** The homepage FAQ preview: the three questions people ask first. */
export const FAQ_PREVIEW = [
  'Who can apply?',
  'Is everyone selected for the physical boot camp?',
  'What happens after submitting an application?',
] as const;

/** Matches the sessionStorage behaviour in src/lib/storage.ts (per tab, survives refresh). */
export const SAVED_PROGRESS_NOTE = 'Your answers are saved while this tab stays open.';

/** The welcome screen's checklist, grouped. "About N minutes" sits beside the Get Started button. */
export const WELCOME_GROUPS = [
  {
    title: 'Eligibility',
    items: ['Applications are open to RCCG members aged 18–30.'],
  },
  {
    title: 'Your commitment',
    items: [
      'The programme begins with 8 weeks of virtual training.',
      'Selection for the physical boot camp is merit-based. Only selected participants receive the 10 fully sponsored days at Redemption City.',
      'Participants continue with 12 months of mentorship, and graduates join a relevant pillar community for two years.',
    ],
  },
  {
    title: 'How applying works',
    items: [
      'Three short sections, then a review of your answers before you submit.',
      'Please give complete and honest responses.',
      SAVED_PROGRESS_NOTE,
    ],
  },
] as const;
