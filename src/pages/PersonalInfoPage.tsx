import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BackLink, PrimaryButton } from '../components/Buttons';
import { ErrorSummary, focusFirstInvalid } from '../components/ErrorSummary';
import { Honeypot, SelectField, TextField } from '../components/Fields';
import { Divider, FormActions, FormCard, StepHeader } from '../components/FormLayout';
import { ParishPicker, ParishQuestionPending } from '../components/ParishPicker';
import { usePageTitle } from '../components/RouteEffects';
import { retryPublicConfig } from '../lib/config';
import { AGE_RANGES, GENDERS, STATE_OPTIONS, type AgeRange, type FieldErrors, type Gender } from '../shared/application';
import { LIMITS, hasErrors } from '../shared/validation';
import { personalErrors, useApplication, useParishQuestion } from '../state/application';

/** Why the step can't be completed while the parish question isn't known yet. */
const PARISH_PENDING = {
  loading: 'The parish question is still loading. Wait a moment, then continue.',
  failed: 'Choose “Try again” to load the parish question, then continue.',
} as const;

export default function PersonalInfoPage() {
  usePageTitle('Step 1 of 3: Personal Information');
  const navigate = useNavigate();
  const { draft, updatePersonal, setHoneypot, setParish, parishCheck } = useApplication();
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const answers = draft.personal;
  // The directory's search while it's switched on, otherwise the parish's name (docs/03).
  const question = useParishQuestion();
  // After "Try again" brings the question, focus goes to it (the button it replaced is gone).
  const focusQuestion = useRef(false);
  useEffect(() => {
    if (!focusQuestion.current || question === 'loading' || question === 'failed') return;
    focusQuestion.current = false;
    document.getElementById('parishName')?.focus();
  }, [question]);

  function stepErrors(): FieldErrors {
    const errors = personalErrors(draft);
    if (question === 'loading' || question === 'failed') errors.parishName = PARISH_PENDING[question];
    return errors;
  }
  const errors = showErrors ? stepErrors() : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    if (hasErrors(stepErrors())) {
      setShowErrors(true);
      focusFirstInvalid(formRef.current);
      return;
    }
    navigate('/apply/education');
  }

  return (
    <>
      <StepHeader
        sectionLabel="Section 1"
        heading="Personal Information"
        intro="Let's begin with the essentials. This information helps us identify you and understand your RCCG context."
      />
      <form ref={formRef} noValidate onSubmit={submit} className="flex w-full flex-col items-center gap-[28px]">
        <Honeypot value={draft.website} onChange={setHoneypot} />
        <FormCard className="gap-[24px] md:gap-[30px]">
          <TextField
            id="fullName"
            number="01"
            label="Full Name"
            placeholder="Enter your full name"
            autoComplete="name"
            maxLength={LIMITS.fullName.max}
            value={answers.fullName}
            onChange={(fullName) => updatePersonal({ fullName })}
            error={errors.fullName}
          />
          <Divider />
          <TextField
            id="email"
            number="02"
            label="Email Address"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            hint="The Programme team will use this to contact you about your application."
            maxLength={LIMITS.email.max}
            value={answers.email}
            onChange={(email) => updatePersonal({ email })}
            error={errors.email}
          />
          <Divider />
          <TextField
            id="phone"
            number="03"
            label="Phone Number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 0801 234 5678"
            hint="Include the country code (e.g. +44) if your number isn't Nigerian."
            maxLength={24}
            value={answers.phone}
            onChange={(phone) => updatePersonal({ phone })}
            error={errors.phone}
          />
          <Divider />
          <SelectField
            id="gender"
            number="04"
            label="Gender"
            placeholder="Select gender"
            options={GENDERS}
            value={answers.gender}
            onChange={(gender) => updatePersonal({ gender: gender as Gender })}
            error={errors.gender}
          />
          <Divider />
          <SelectField
            id="ageRange"
            number="05"
            label="Age range"
            placeholder="Select age range"
            hint="The programme is for ages 18–30."
            className="md:max-w-[367px]"
            options={AGE_RANGES}
            value={answers.ageRange}
            onChange={(ageRange) => updatePersonal({ ageRange: ageRange as AgeRange })}
            error={errors.ageRange}
          />
          <Divider />
          <div className="flex w-full flex-col gap-[24px] md:flex-row md:gap-[30px]">
            <SelectField
              id="stateOfResidence"
              number="06"
              label="State of Residence"
              placeholder="Select state"
              className="min-w-0 flex-1"
              options={STATE_OPTIONS}
              value={answers.stateOfResidence}
              onChange={(stateOfResidence) => updatePersonal({ stateOfResidence })}
              error={errors.stateOfResidence}
            />
            <TextField
              id="city"
              number="07"
              label="City/Town of Residence"
              placeholder="Enter your city or town"
              autoComplete="address-level2"
              className="min-w-0 flex-1"
              maxLength={LIMITS.city.max}
              value={answers.city}
              onChange={(city) => updatePersonal({ city })}
              error={errors.city}
            />
          </div>
          <Divider />
          {question === 'directory' ? (
            <ParishPicker
              id="parishName"
              number="08"
              state={answers.stateOfResidence}
              value={draft.parish}
              onChange={setParish}
              check={parishCheck}
              error={errors.parishName}
              initialQuery={answers.parishName}
            />
          ) : question === 'text' ? (
            <TextField
              id="parishName"
              number="08"
              label="Name of your RCCG parish"
              hint="Type your parish’s name as you know it. The Programme team will match it to the RCCG parish list."
              placeholder="Enter parish name"
              maxLength={LIMITS.parishName.max}
              value={answers.parishName}
              onChange={(parishName) => updatePersonal({ parishName })}
              error={errors.parishName}
            />
          ) : (
            <ParishQuestionPending
              id="parishName"
              number="08"
              status={question}
              error={errors.parishName}
              onRetry={() => {
                focusQuestion.current = true;
                retryPublicConfig();
              }}
            />
          )}
        </FormCard>

        <ErrorSummary count={Object.keys(errors).length} />

        <FormActions>
          <div className="flex w-full items-center gap-[10px]">
            <BackLink to="/apply" />
            <PrimaryButton type="submit" className="flex-1">
              Save &amp; Continue
            </PrimaryButton>
          </div>
        </FormActions>
      </form>
    </>
  );
}
