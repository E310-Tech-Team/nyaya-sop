import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PrimaryButton } from '../components/Buttons';
import { focusFirstInvalid } from '../components/ErrorSummary';
import { ChoiceGroup, Honeypot, SelectField, TextAreaField, TextField } from '../components/Fields';
import { Divider, FormCard, StepHeader } from '../components/FormLayout';
import { NomineeProvinceField } from '../components/NomineeProvinceField';
import { useNoIndex, usePageTitle } from '../components/RouteEffects';
import { SiteHeader } from '../components/SiteHeader';
import { ApiError, apiRequest } from '../lib/api';
import { errorMessage, Notice } from '../components/ui/basic';
import {
  MENTOR_AGE_RANGES,
  PILLAR_FITS,
  RCCG_STATUSES,
  validateMentorNomination,
  type MentorNominationAnswers,
  type MentorNominationField,
  type MentorNominationFieldErrors,
  type MentorNominationPayload,
} from '../shared/mentor-nomination';
import { NIGERIAN_STATES } from '../shared/application';

const EMPTY_ANSWERS: MentorNominationAnswers = {
  nominatorName: '',
  nomineeName: '',
  nomineeState: '',
  regionLocation: '',
  provinceId: '',
  churchDenomination: '',
  nomineePhone: '',
  nomineeEmail: '',
  ageRange: '',
  jobRole: '',
  experience: '',
  pillarFit: '',
  rccgStatus: '',
  whyFit: '',
  testimonial: '',
};

const NOMINATION_FIELDS: readonly MentorNominationField[] = [
  'nominatorName',
  'nomineeName',
  'nomineeState',
  'rccgStatus',
  'regionLocation',
  'provinceId',
  'churchDenomination',
  'nomineePhone',
  'nomineeEmail',
  'ageRange',
  'jobRole',
  'experience',
  'pillarFit',
  'whyFit',
  'testimonial',
];

const DETAILS_FIELDS = [
  'nominatorName',
  'nomineeName',
  'nomineeState',
  'rccgStatus',
  'regionLocation',
  'provinceId',
  'churchDenomination',
  'nomineePhone',
  'nomineeEmail',
  'ageRange',
  'jobRole',
] as const satisfies readonly MentorNominationField[];

function nominationFieldErrors(errors: Partial<Record<string, string>> | undefined): MentorNominationFieldErrors {
  const result: MentorNominationFieldErrors = {};
  for (const field of NOMINATION_FIELDS) {
    const message = errors?.[field];
    if (message) result[field] = message;
  }
  return result;
}

function errorsForFields(
  errors: MentorNominationFieldErrors,
  fields: readonly MentorNominationField[],
): MentorNominationFieldErrors {
  const result: MentorNominationFieldErrors = {};
  for (const field of fields) {
    if (errors[field]) result[field] = errors[field];
  }
  return result;
}

function stepForErrors(errors: MentorNominationFieldErrors): 1 | 2 {
  return DETAILS_FIELDS.some((field) => errors[field]) ? 1 : 2;
}

function NominationProgress({ step }: { step: 1 | 2 }) {
  const steps = ['Nominee details', 'Mentoring fit'] as const;
  return (
    <nav aria-label="Mentor nomination progress" className="w-full max-w-[840px]">
      <ol className="flex w-full items-center">
        {steps.map((label, index) => {
          const number = (index + 1) as 1 | 2;
          const state = number === step ? 'current' : number < step ? 'completed' : 'upcoming';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 font-sans text-[12px] font-semibold sm:gap-3 sm:text-[14px]"
            >
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                  state === 'upcoming'
                    ? 'border-line-strong bg-white text-muted'
                    : 'border-brand bg-brand text-white'
                }`}
              >
                {state === 'completed' ? '✓' : number}
              </span>
              <span className={state === 'upcoming' ? 'text-muted' : 'text-ink'}>{label}</span>
              {index === 0 && <span aria-hidden="true" className="mx-1 h-px min-w-3 flex-1 bg-line-strong sm:mx-3" />}
              <span className="sr-only"> ({state})</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function MentorNominationPage() {
  const [step, setStep] = useState<1 | 2>(1);
  usePageTitle(`Step ${step} of 2: Mentor nominations`);
  useNoIndex();
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<MentorNominationFieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    document.querySelector<HTMLElement>('[data-page-heading]')?.focus();
  }, [step]);

  function update<K extends keyof MentorNominationAnswers>(field: K, value: MentorNominationAnswers[K]) {
    setAnswers((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setServerError('');
  }

  function updateRccgStatus(value: string) {
    setAnswers((current) => ({ ...current, rccgStatus: value, regionLocation: '', provinceId: '', churchDenomination: '' }));
    setErrors((current) => {
      const next = { ...current };
      delete next.rccgStatus;
      delete next.regionLocation;
      delete next.provinceId;
      delete next.churchDenomination;
      return next;
    });
    setServerError('');
  }

  function updateNomineeState(value: string) {
    setAnswers((current) => ({ ...current, nomineeState: value, provinceId: '' }));
    setErrors((current) => {
      const next = { ...current };
      delete next.nomineeState;
      delete next.provinceId;
      return next;
    });
    setServerError('');
  }

  function continueToFit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateMentorNomination(answers);
    const detailsErrors = validation.ok ? {} : errorsForFields(validation.fieldErrors, DETAILS_FIELDS);
    setErrors(detailsErrors);
    setServerError('');
    if (Object.keys(detailsErrors).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setStep(2);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || step !== 2) return;
    const validation = validateMentorNomination(answers);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setServerError('');
      setStep(stepForErrors(validation.fieldErrors));
      focusFirstInvalid(formRef.current);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setServerError('');
    try {
      await apiRequest('/mentor-nominations', {
        method: 'POST',
        json: { ...answers, website } satisfies MentorNominationPayload,
      });
      setSubmitted(true);
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? nominationFieldErrors(error.fieldErrors) : {};
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        setStep(stepForErrors(fieldErrors));
      }
      setServerError(errorMessage(error));
      setTimeout(() => {
        if (Object.keys(fieldErrors).length > 0) focusFirstInvalid(formRef.current);
        else document.getElementById('nomination-server-error')?.focus();
      }, 0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader badge="Mentor nominations" />
      <div className="on-dark bg-brand px-5 py-7 sm:px-10">
        <div className="mx-auto flex max-w-[840px] flex-col gap-2">
          <p className="font-sans text-[12px] font-bold uppercase tracking-[2px] text-gold-light">Mentor mobilisation</p>
          <p className="font-display text-[30px] leading-none text-white sm:text-[38px]">IT’S TIME TO BUILD</p>
          <p className="max-w-[680px] font-sans text-[14px] leading-[1.55] text-rose">
            Our goal is to raise 500 mentors across the regions to guide, support and build the next generation.
          </p>
        </div>
      </div>

      <main id="main" className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-6 px-5 pb-12 pt-8 sm:px-10 sm:pt-12">
        {!submitted && <NominationProgress step={step} />}
        <StepHeader
          sectionLabel={`Step ${step} of 2`}
          heading={step === 1 ? 'Nominee details' : 'Mentoring fit'}
          intro={
            step === 1
              ? 'Share who is making this nomination and the nominee’s contact and professional details. A strong nominee is born again, of good conduct and character, resourceful and experienced, willing to mentor young people, a high achiever, an RCCG member and a good fit for at least one pillar. RCCG status is collected for review; a Non-RCCG answer is not an automatic rejection.'
              : 'Describe the nominee’s experience, pillar fit and the reasons you recommend them to guide, support and build the next generation.'
          }
          showRequiredNote={false}
        />

        {submitted ? (
          <section className="w-full max-w-[840px] rounded-[16px] border border-line bg-white p-6 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] sm:p-9" aria-live="polite">
            <h2 className="font-display text-[28px] text-ink">Nomination received</h2>
            <p className="mt-3 font-sans text-[15px] leading-[1.6] text-muted">
              Thank you for taking the time to recommend a mentor. The nomination has been submitted for review.
            </p>
            <p className="mt-4 font-sans text-[13px] font-semibold text-brand">Nomination does not guarantee selection.</p>
          </section>
        ) : (
          <>
            <p className="w-full max-w-[840px] rounded-[10px] border border-gold/70 bg-white px-4 py-3 font-sans text-[13px] leading-[1.5] text-ink">
              Nomination does not guarantee selection.
            </p>
            {serverError && (
              <div id="nomination-server-error" tabIndex={-1} className="w-full max-w-[840px] outline-none">
                <Notice tone="error" title="We couldn’t submit this nomination.">
                  <p>{serverError}</p>
                  <p className="mt-1">Your answers are still here. Please review any marked fields and try again.</p>
                </Notice>
              </div>
            )}
            <form ref={formRef} noValidate onSubmit={step === 1 ? continueToFit : submit} className="flex w-full flex-col items-center gap-6">
              <Honeypot value={website} onChange={setWebsite} />
              <FormCard className="gap-6 md:gap-7">
                {step === 1 ? (
                  <>
                    <TextField
                      id="nominatorName"
                      number="01"
                      label="Nominator’s name"
                      autoComplete="name"
                      maxLength={120}
                      value={answers.nominatorName}
                      onChange={(value) => update('nominatorName', value)}
                      error={errors.nominatorName}
                    />
                    <Divider />
                    <TextField
                      id="nomineeName"
                      number="02"
                      label="Nominee’s name"
                      maxLength={120}
                      value={answers.nomineeName}
                      onChange={(value) => update('nomineeName', value)}
                      error={errors.nomineeName}
                    />
                    <Divider />
                    <SelectField
                      id="nomineeState"
                      number="03"
                      label="Nominee’s state of residence"
                      placeholder="Select a Nigerian state"
                      options={NIGERIAN_STATES}
                      value={answers.nomineeState}
                      onChange={updateNomineeState}
                      error={errors.nomineeState}
                    />
                    <Divider />
                    <ChoiceGroup
                      name="rccgStatus"
                      number="04"
                      legend="Is the nominee an RCCG member?"
                      hint="This is collected for the review team. A Non-RCCG answer does not automatically rule out a nomination."
                      options={RCCG_STATUSES}
                      value={answers.rccgStatus || null}
                      onChange={updateRccgStatus}
                      error={errors.rccgStatus}
                    />
                    <Divider />
                    {answers.rccgStatus === 'rccg_member' ? (
                      <NomineeProvinceField
                        key={answers.nomineeState}
                        id="provinceId"
                        number="05"
                        state={answers.nomineeState}
                        value={answers.provinceId}
                        onChange={(value) => update('provinceId', value)}
                        error={errors.provinceId}
                      />
                    ) : answers.rccgStatus === 'non_rccg' ? (
                      <TextAreaField
                        id="regionLocation"
                        number="05"
                        label="Nominee’s full address"
                        hint="Enter the nominee’s complete address, including the street and area."
                        autoComplete="street-address"
                        maxLength={500}
                        value={answers.regionLocation}
                        onChange={(value) => update('regionLocation', value)}
                        error={errors.regionLocation}
                      />
                    ) : null}
                    {answers.rccgStatus === 'non_rccg' && (
                      <>
                        <Divider />
                        <TextField
                          id="churchDenomination"
                          number="06"
                          label="Nominee’s church denomination (full name)"
                          hint="Write the denomination’s full name, not an abbreviation."
                          maxLength={200}
                          value={answers.churchDenomination}
                          onChange={(value) => update('churchDenomination', value)}
                          error={errors.churchDenomination}
                        />
                      </>
                    )}
                    {answers.rccgStatus && <Divider />}
                    <div className="flex w-full flex-col gap-6 md:flex-row">
                      <TextField
                        id="nomineePhone"
                        number="07"
                        label="Nominee’s phone number"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="e.g. 0801 234 5678"
                        maxLength={24}
                        value={answers.nomineePhone}
                        onChange={(value) => update('nomineePhone', value)}
                        error={errors.nomineePhone}
                        className="min-w-0 flex-1"
                      />
                      <TextField
                        id="nomineeEmail"
                        number="08"
                        label="Nominee’s email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="name@example.com"
                        maxLength={254}
                        value={answers.nomineeEmail}
                        onChange={(value) => update('nomineeEmail', value)}
                        error={errors.nomineeEmail}
                        className="min-w-0 flex-1"
                      />
                    </div>
                    <Divider />
                    <div className="flex w-full flex-col gap-6 md:flex-row">
                      <SelectField
                        id="ageRange"
                        number="09"
                        label="Nominee’s age range"
                        placeholder="Select age range"
                        options={MENTOR_AGE_RANGES}
                        value={answers.ageRange}
                        onChange={(value) => update('ageRange', value)}
                        error={errors.ageRange}
                        className="min-w-0 flex-1"
                      />
                      <TextField
                        id="jobRole"
                        number="10"
                        label="Nominee’s job role / profession"
                        maxLength={120}
                        value={answers.jobRole}
                        onChange={(value) => update('jobRole', value)}
                        error={errors.jobRole}
                        className="min-w-0 flex-1"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <TextAreaField
                      id="experience"
                      number="11"
                      label="Nominee’s experience"
                      hint="Briefly describe relevant experience, achievements or resources."
                      maxLength={1200}
                      value={answers.experience}
                      onChange={(value) => update('experience', value)}
                      error={errors.experience}
                    />
                    <Divider />
                    <SelectField
                      id="pillarFit"
                      number="12"
                      label="Which pillar best fits the nominee?"
                      hint="Open the list to see all eight official pillars. Selecting one closes the list."
                      placeholder="Select one pillar"
                      options={PILLAR_FITS}
                      value={answers.pillarFit}
                      onChange={(value) => update('pillarFit', value)}
                      error={errors.pillarFit}
                    />
                    <Divider />
                    <TextAreaField
                      id="whyFit"
                      number="13"
                      label="Why is this nominee a good fit?"
                      maxLength={1500}
                      value={answers.whyFit}
                      onChange={(value) => update('whyFit', value)}
                      error={errors.whyFit}
                    />
                    <Divider />
                    <TextAreaField
                      id="testimonial"
                      number="14"
                      label="Short testimonial about the nominee"
                      hint="Share a brief example of the nominee’s character or impact."
                      maxLength={1500}
                      value={answers.testimonial}
                      onChange={(value) => update('testimonial', value)}
                      error={errors.testimonial}
                    />
                  </>
                )}
              </FormCard>
              <div className="flex w-full max-w-[840px] flex-col gap-4">
                {step === 1 ? (
                  <PrimaryButton type="submit" className="w-full justify-center sm:w-auto sm:self-end">
                    Continue
                  </PrimaryButton>
                ) : (
                  <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="motion-button inline-flex h-[50px] shrink-0 items-center justify-center gap-[8px] rounded-full border border-line-strong bg-white px-[16px] text-brand hover:border-brand sm:w-[108px] sm:gap-[9px] sm:px-[18px]"
                    >
                      <span aria-hidden="true">←</span>
                      <span className="font-sans text-[14px] font-bold">Back</span>
                    </button>
                    <PrimaryButton type="submit" busy={submitting} disabled={submitting} className="w-full justify-center sm:w-auto">
                      Submit nomination
                    </PrimaryButton>
                  </div>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
