import bootcampPhoto from '../../assets/landing/programme-bootcamp.webp';
import communityPhoto from '../../assets/landing/programme-community.webp';
import meritPhoto from '../../assets/landing/programme-merit.webp';
import trainingPhoto from '../../assets/landing/programme-virtual.webp';
import type { ProgrammePhase } from '../../config/programme';

/**
 * The photographs of the /programme phase cards. They are AI-generated (docs/IMAGERY.md) and used
 * nowhere else: one photo per placement, never shared with the Journey or the homepage previews.
 * `focus` is the object-position that keeps heads in view in the widest card crops (about 3.6:1
 * on large phones) and, on the boot camp, clear of the "Selected participants only" badge.
 */
export const PHASE_ART: Record<ProgrammePhase['key'], { img: string; alt: string; focus: string }> = {
  training: { img: trainingPhoto, alt: 'A young woman wearing headphones beside a laptop at her home desk', focus: '50% 22%' },
  selection: { img: meritPhoto, alt: 'A young man with glasses writing in a notebook at a quiet desk', focus: '50% 28%' },
  bootcamp: { img: bootcampPhoto, alt: 'Three young professionals seated together in a training-room discussion', focus: '50% 30%' },
  community: { img: communityPhoto, alt: 'A mentor talking with two young professionals on a garden terrace', focus: '50% 30%' },
};
