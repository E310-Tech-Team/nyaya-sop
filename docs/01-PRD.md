# 01 — Product Requirements Document (PRD)

**Product:** School of Purpose (SOP): Purpose Boot Camp, Expression of Interest site
**Owner organisation:** RCCG National Young Adults & Youth
**Programme edition:** First Edition, "The Called Generation"
**Last updated:** 2026-09-30
**Current stage:** **Built and deployment-ready.** Applications are validated and stored in PostgreSQL. The site is an installable web app with optional notifications and applicant accounts, and the Programme team has an admin platform. Not yet deployed to a live domain; email and push keys are configured at deployment.

> **Status labels used across these docs**
> - **Built**: exists in the code and works as described.
> - **Partial**: part of the behaviour exists.
> - **Planned**: agreed direction, not built.
> - **TBD**: open question; needs a decision.

Related: [02-TRD](02-TRD.md) · [03-App-Flow](03-App-Flow.md) · [04-UI-UX-Design-Brief](04-UI-UX-Design-Brief.md) · [05-Backend-Schema](05-Backend-Schema.md) · [06-Implementation-Plan](06-Implementation-Plan.md) · [DEPLOYMENT](DEPLOYMENT.md)

---

## 1. Overview

This product is a website for the School of Purpose Purpose Boot Camp. It has two jobs:

1. **Inform and inspire:** a concise homepage and four dedicated pages (About, Programme, Journey, FAQ) present the programme's vision, mission, doctrine ("The Doctrine of Purpose"), the five biblical models ("The Biblical Blueprint"), how the programme runs and the multi-year participant journey.
2. **Capture Expressions of Interest (EOIs):** a three-section application with a consent step and a review step. Submissions are stored in PostgreSQL.
3. **Keep applicants informed (optional for them):** an installable app, programme announcements, opt-in push notifications by topic, and an account to follow a published application status and read messages. None of this is needed to browse or apply.
4. **Run the intake:** an admin platform for the Programme team (review, publish decisions, cohorts, notifications, staff roles, audit history).

This app covers **only the "Apply" stage** of the programme:

| # | Stage (from the site copy) | In this app? |
|---|---|---|
| 01 | Apply: open to RCCG young adults and youth aged 18–30 | **Yes** |
| 02 | Virtual Training: 8 weeks, 16 live sessions, 32 contact hours | No |
| 03 | Merit Selection: transparent 100-point system | No |
| 04 | Physical Boot Camp: 10 fully sponsored days at Redemption City | No |
| 05 | Mentorship: 12 months, 200+ vetted senior mentors | No |
| 06 | Community: two years across eight communities | No |

## 2. Goals

| ID | Goal | Status |
|---|---|---|
| G1 | Communicate the programme clearly enough that eligible young people want to apply | **Built** |
| G2 | Let an eligible applicant finish in about 5 minutes on a phone | **Built** (validated fields, answers saved across refresh/Back) |
| G3 | Capture explicit, auditable consent to be contacted | **Built** (consent wording version + timestamp stored with each application) |
| G4 | Set clear expectations for what happens next | **Built** (success page with a reference number) |
| G5 | Give the Programme team a clean, reviewable list of applicants | **Built**: admin platform with search, review, notes, assignment, explicit publication and audited CSV export |
| G6 | Let applicants hear about their application and the programme without chasing | **Built**: optional account (published status + messages), inbox, opt-in notifications by topic with separate consent |
| G7 | Work well on phones and weak connections | **Built**: installable app; public pages available offline once visited; honest offline messages |

### Non-goals (current scope)

Payments · delivering training, grading, mentorship or community management · multi-language support · app-store (native) apps · making accounts, installation or notifications a requirement for anything.

## 3. Target users

| Persona | Needs | How the product serves them |
|---|---|---|
| **Applicant** (primary): RCCG member aged 18–30, mostly in Nigeria, usually on a phone (often on shared Wi-Fi or a mobile network) | Understand the programme fast, apply in minutes, know what happens next | Mobile-first pages, saved progress, plain-language errors, a reference number |
| **Programme team** (owners, programme admins) | A complete, de-duplicated applicant list; decisions communicated consistently | Admin platform: applicants, publication, cohorts, accounts, staff, settings, audit; audited CSV |
| **Reviewer** | Only the applications assigned to them | Admin: assigned applications, notes, review status (no exports or publishing) |
| **Communications volunteer** | Send programme news | Admin: announcements and notification campaigns (preview, test, schedule, truthful results) |
| **Parish / youth leader** | A credible, shareable link | Social preview image and description; UTM tags in links show which announcements work |

## 4. Features

| ID | Feature | Status |
|---|---|---|
| F1 | Homepage (hero: eyebrow, headline, one sentence, eligibility line, two CTAs; What to expect; short previews of About, Programme, Journey and FAQ; closing invitation; footer), responsive 320–1920 px, with a choreographed motion system | **Built** |
| F2 | Site navigation: Home `/` · About `/about` · Programme `/programme` · Journey `/journey` · FAQ `/faq`, with the current page marked (`aria-current`); "Start my application" → `/apply` on every page; "Explore the programme" → `/programme`; accessible mobile menu; footer links; old `/#about`, `/#programme`, `/#journey`, `/#faq` links land on the homepage previews | **Built** ("Contact" appears once `VITE_CONTACT_EMAIL` is set) |
| F2a | Dedicated pages: **About** (calling, vision & mission, who the programme serves, Biblical Blueprint); **Programme** (Purpose Boot Camp, Doctrine of Purpose, how the programme runs: virtual training, merit-based selection, the physical boot camp and its sponsorship for selected participants, mentorship and community); **Journey** (applying vs being selected, the six stages in order); **FAQ** (the approved questions in three topic groups) | **Built** (verified copy only; gaps listed in [06 "Content needed"](06-Implementation-Plan.md#content-needed-from-the-programme-team)) |
| F3 | Welcome & consent gate (facts grouped as Eligibility / Your commitment / How applying works); shows "applications closed" when no cohort is open | **Built** |
| F4 | Section 1: Personal Information (8 fields) with validation | **Built** |
| F5 | Section 2: Education & Career | **Built** |
| F6 | Section 3: Purpose & Self-Discovery (1–5) | **Built** |
| F7 | Review screen with per-section Edit | **Built** |
| F8 | Submission stored in PostgreSQL | **Built** |
| F9 | Success page with reference (only after a confirmed save), Copy reference button, "not an offer of a place" wording | **Built** |
| F10 | Confirmation email to applicant | **TBD** (the email transport exists for sign-in links; needs a provider and wording) |
| F11 | Reviewer tools | **Built**: admin platform ([03 §9](03-App-Flow.md#9-admin-platform)) |
| F12 | One application per email per cohort | **Built** |
| F13 | Spam / abuse protection | **Partial**: honeypot + per-visitor rate limits + validation built; CAPTCHA not built |
| F14 | Save progress across refresh/Back | **Built** (browser session only; cleared on submit or when the tab closes; each step says "Your answers are saved while this tab stays open.") |
| F17 | Motion system (entrances, scroll reveals, feedback) with full reduced-motion support | **Built** ([04 §6](04-UI-UX-Design-Brief.md#6-motion)) |
| F15 | Outreach attribution (UTM tags + referring site) | **Built** (included in the CSV) |
| F16 | Cohort management (open/close, dates) | **Built**: Admin → Cohorts (dates in Lagos time by default) |
| F18 | Installable web app (manifest, icons, service worker, update prompt) | **Built** · real-device checks pending |
| F19 | Install guidance per device (one-tap where the browser allows; steps for iPhone, iPad, Android, desktop; in-app browser advice) | **Built** |
| F20 | Offline: visited public pages work; account/admin pages explain they need a connection; nothing private cached | **Built** |
| F21 | Notifications: topics (announcements for anyone; application updates and training reminders with an account), separate consent, device settings, neutral lock-screen text | **Built** · needs VAPID keys at deployment |
| F22 | Applicant accounts (email link sign-in, claim by verified email, published status, inbox, devices, sessions, delete) | **Built** · on since 2026-09-30 (email through Resend) |
| F23 | Admin platform with individual staff accounts, two-step verification, five roles, audit history | **Built** |
| F24 | Announcements (public `/updates`, applicant inbox notices) and notification campaigns | **Built** |
| F25 | Proportionate anonymous analytics (installs observed, app launches, opt-ins/outs, clicks) | **Built** ([05 §8](05-Backend-Schema.md#8-analytics-retention-and-deletion)) |
| F26 | Parish directory: applicants choose their parish from the RCCG list; staff review parishes applicants couldn't find and earlier typed answers, and see applications by continent, region, province and parish. The list comes from the official RCCG directory API, kept current automatically (D-53); same-named parishes in one province are offered as one choice, and staff settle which one (D-55); where the API isn't configured, from an imported spreadsheet that staff can correct | **Built** (Phase 16): the RCCG directory API is live on the server (release 2026.1). The question stays off in Settings until the look-alike choice (16.10) ships |

## 5. Form content

The rules are enforced in the browser and on the server ([05 §4](05-Backend-Schema.md#4-validation-rules)). Everything is required except the parish. **Parish directory (Phase 16, D-28/D-31):** built; once an owner switches it on, the parish becomes required and is chosen from the RCCG parish list, with "I can't find my parish" as the way through ([03, Personal step](03-App-Flow.md#the-parish-question-question-08-while-the-parish-directory-is-on)).

### Welcome: consent

"I confirm that I am an RCCG member aged 18-30 and consent to being contacted about this programme." (version `2026-09-v1`)

### Section 1: Personal Information

| # | Field | Input | Options / notes |
|---|---|---|---|
| 01 | Full Name | text | 2–120 characters; any script (e.g. Yoruba diacritics) |
| 02 | Email Address | email | Duplicate emails per cohort are rejected |
| 03 | Phone Number | tel | Nigerian formats (`0801 234 5678`, `8012345678`, `+234…`) or international with country code; stored as E.164 |
| 04 | Gender | select | Male · Female · Prefer not to say |
| 05 | Age range | select | 18-20 · 21-24 · 25-27 · 28-30 |
| 06 | State of Residence | select | All 36 states + FCT (Abuja) + Outside Nigeria |
| 07 | City/Town of Residence | text | 2–80 characters |
| 08 | Your RCCG parish | required | While the parish directory is on: a search of the RCCG list; province, region and continent come from the chosen parish (read-only) and are confirmed, or "I can't find my parish" with its name. While it's off: "Name of your RCCG parish", typed (hint: "Type your parish's name as you know it. The Programme team will match it to the RCCG parish list.") |

### Section 2: Education & Career

| # | Question | Options |
|---|---|---|
| 01 | Highest level of education | Secondary School · OND/NCE · HND · Bachelor's Degree · Master's Degree |
| 02 | Current status | Student · NYSC · Employed · Entrepreneur/Business Owner · Freelancer · Job seeker · Recent graduate · Other |

### Section 3: Purpose & Self-Discovery

| # | Question | Options |
|---|---|---|
| 01 | How clear are you about your purpose at this stage of your life? | 1 Not clear at all · 2 Slightly clear · 3 Somewhat clear · 4 Very clear · 5 Extremely clear |

## 6. User stories

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US1 | As an applicant I understand what the Boot Camp is and who it's for | Eligibility, journey and an Apply CTA visible on mobile and desktop | **Built** |
| US2 | I see the commitments before I start | Welcome groups eligibility, commitment and how applying works; consent required, never pre-ticked | **Built** |
| US3 | I'm told which required field I missed | Continue is blocked; inline errors; focus on the first problem | **Built** |
| US4 | I can go back without losing answers | Back on every step keeps all values, including after a refresh | **Built** |
| US5 | I can review everything before submitting | Review screen with Edit links | **Built** |
| US6 | I know my application was actually received | Success only after the server confirms; reference number; clear retry message on failure | **Built** |
| US7 | I get a confirmation email | Email sent to the address entered | **TBD** |
| US8 | As the Programme team, I see all EOIs for a cohort in one place | Admin list with search/filters/pages; CSV download | **Built** |
| US9 | Duplicate applications are prevented | Same email + cohort → "You've already applied" | **Built** |
| US10 | I can apply with a keyboard or screen reader | WCAG 2.2 AA; 0 axe violations on every screen | **Built** (real-device screen-reader pass pending) |
| US11 | I can tell quickly whether the programme suits me | Hero summary, What to expect (with what depends on selection) and an FAQ, all from confirmed copy | **Built** |
| US13 | I can read about one topic without scrolling past everything else | Each nav item opens its own page (About, Programme, Journey, FAQ) with a compact intro, its detail and a way to apply; the homepage stays a short overview | **Built** |
| US12 | I can keep my reference number | Selectable reference + Copy button with announced result and manual fallback | **Built** |
| US14 | I can put the site on my phone like an app | Install page with the right steps for my device; one tap where the browser allows | **Built** (real-device checks pending) |
| US15 | I can choose to hear about the programme, and stop at any time | Notification card after applying and a settings page; permission asked only after "Enable"; topics; turn off | **Built** |
| US16 | I can see where my application stands without emailing anyone | Sign in by email link, link my application, see its published status and messages | **Built** (needs email at deployment) |
| US17 | As a reviewer, I only see the applications assigned to me | Enforced by the server | **Built** |
| US18 | As the Programme team, nobody sees a decision until we publish it | Internal status separate; explicit, previewed publication; neutral lock-screen text | **Built** |
| US19 | As communications, I can send a notification without surprises | Preview, live counts (devices and people), test to my own device, time zone, final confirmation, truthful results | **Built** |
| US20 | As an owner, I can control who has access and see what they did | Invitations, roles, suspension, two-step verification, audit history | **Built** |
| US21 | As the Programme team, I can see how many applications come from each part of the church | Reports open on one card per continent and drill down continent → region → province → parish → that parish's applications, with status views and a trend; applications with no directory parish counted as "Unassigned"; each level adds up to the one above; each count opens those applicants; small counts hidden from roles without applicant details | **Built** |
| US22 | As the Programme team, every application ends up with the right parish | Parish review for parishes applicants couldn't find, flagged details and earlier typed answers; link, add or correct; the applicant's own answer is kept | **Built** |

## 7. Success metrics

There is no third-party analytics tool. The admin dashboard shows anonymous first-party counts (applications submitted, observed installs, launches from the installed app, install prompt accepted/dismissed, notification opt-ins/outs, recorded notification clicks); EOI volume and source mix come from the applicant list and CSV. The proposed targets:

| Metric | Proposed target | Measurable now? |
|---|---|---|
| Confirmed EOIs per cohort | Set by the Programme team | ✅ CSV |
| Share of EOIs by source (utm_source) | — | ✅ CSV |
| Valid contact rate | ≥ 95% (enforced by validation) | ✅ CSV |
| Apply click-through / form start / completion rate | ≥ 15% / ≥ 70% / ≥ 60% | ❌ deliberately not tracked (would need page-level analytics; privacy decision first) |
| Notification opt-in rate after applying; installs | Set by the Programme team | ✅ dashboard (opt-ins; *observed* installs only: iPhone installs can't be observed) |
| Median completion time | ≤ 5 min | ❌ needs analytics |

## 8. Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Where should submissions be stored? | ✅ **Decided:** self-hosted PostgreSQL on the VPS (2026-09-26) |
| Q2 | Was a "RCCG member? Yes/No" question removed? | ✅ Resolved by rewording the parish hint; the parish stays optional. Reopen if the question should come back. **Superseded while the parish directory is on:** the parish is required and chosen from the RCCG list (D-31). **Superseded everywhere (2026-09-30, D-52):** the parish is compulsory whether or not the directory is on |
| Q3 | Time estimate: 5 or 12 minutes? | ✅ "About 5 minutes" (11 questions). Change in `src/config/site.ts` |
| Q4 | Full state list / diaspora? | ✅ 36 states + FCT + "Outside Nigeria". **Confirm** |
| Q5 | How is eligibility (18–30, RCCG) enforced? | Open: currently self-declared via the consent statement and age ranges |
| Q6 | Application window dates? | Open: set them in Admin → Cohorts when known |
| Q7 | What should the nav items do? | ✅ Each opens its own page (`/about`, `/programme`, `/journey`, `/faq`; 2026-09-26, previously in-page anchors); "Experience" and "Speakers" removed (no content) |
| Q8 | "SOC" or "SOP"? Canonical organisation name? | ✅ The brand guideline settles the logo: the official lockup "RCCG NYAYA School of Purpose" is in every header (2026-09-28); "SOP" stays the short name. **Confirm** the written org-name variants (see [04 §9](04-UI-UX-Design-Brief.md#9-design-inconsistencies-from-the-prototype)) |
| Q9 | Privacy notice at the consent step? | **Open, launch blocker:** the Programme team needs to provide wording (what's collected, who sees it, how long it's kept, how to request deletion) |
| Q10 | Should search engines index the site? | ✅ Yes (`robots.txt` allows everything except `/api/`, `/admin` and `/account`; those pages also send `X-Robots-Tag: noindex`) |
| Q11 | How long are applications kept? | Open: needed for the privacy notice and backup policy |
| Q12 | Public contact email for the Programme team? | Open: set `VITE_CONTACT_EMAIL` when known ("Contact" links appear automatically) |
| Q13 | Domain name for the site? | ✅ **Decided:** https://nyayasop.org, live since 2026-09-30; `www.nyayasop.org` redirects to it |
| Q14 | Who are the owners and staff, and in which roles? | Open: needed before launch (the shared CSV password is gone; every person has their own account) |
| Q17 | Which email provider and sender address? | ✅ **Decided:** Resend over SMTP (port 2465: DigitalOcean blocks 465 and 587), sender `School of Purpose <no-reply@nyayasop.org>`; on since 2026-09-30 ([DEPLOYMENT](DEPLOYMENT.md#email)) |
| Q18 | Which contact goes in `VAPID_SUBJECT` for push services? | Open: the installer used the first owner's address; switch to a team mailbox when there is one |
| Q19 | How long are notes, audit history and consent records kept? | Open: see Q11 and [05 §8](05-Backend-Schema.md#8-analytics-retention-and-deletion) |
| Q15 | Content still needed for the UX pass: response time, whether virtual-training admission is selective, training schedule/platform, boot camp dates/location details, sponsorship exclusions | Open: see [06 "Content needed"](06-Implementation-Plan.md#content-needed-from-the-programme-team) |
| Q16 | May the site use NYAYA's own event photography (e.g. from RISE), and with what credit? | No longer blocking (2026-09-29): the supporting photos are AI-generated and disclosed as such ([IMAGERY.md](IMAGERY.md)). NYAYA photos could still replace them, with written permission and the required credit |
