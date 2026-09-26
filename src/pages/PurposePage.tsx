import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BackLink, PrimaryButton } from '../components/Buttons';
import { ErrorSummary, focusFirstInvalid } from '../components/ErrorSummary';
import { ChoiceGroup } from '../components/Fields';
import { FormActions, FormCard, StepHeader } from '../components/FormLayout';
import { usePageTitle } from '../components/RouteEffects';
import { PURPOSE_SCALE } from '../shared/application';
import { hasErrors, validatePurpose } from '../shared/validation';
import { useApplication } from '../state/application';

export default function PurposePage() {
  usePageTitle('Step 3 of 3: Purpose & Self-Discovery');
  const navigate = useNavigate();
  const { draft, updatePurpose } = useApplication();
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = showErrors ? validatePurpose(draft.purpose) : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    if (hasErrors(validatePurpose(draft.purpose))) {
      setShowErrors(true);
      focusFirstInvalid(formRef.current);
      return;
    }
    navigate('/apply/review');
  }

  return (
    <>
      <StepHeader
        sectionLabel="Section 3"
        heading="Purpose & Self-Discovery"
        intro="Reflect on what you know about yourself today—and where you are seeking greater clarity for tomorrow."
      />
      <form ref={formRef} noValidate onSubmit={submit} className="flex w-full flex-col items-center gap-[28px]">
        <FormCard className="gap-[16px]">
          <ChoiceGroup
            name="purposeClarity"
            number="01"
            legend="How clear are you about your purpose at this stage of your life?"
            hint="Choose one on a scale of 1 to 5."
            variant="scale"
            options={PURPOSE_SCALE}
            value={draft.purpose.purposeClarity}
            onChange={(purposeClarity) => updatePurpose({ purposeClarity })}
            error={errors.purposeClarity}
          />
        </FormCard>

        <ErrorSummary count={Object.keys(errors).length} />

        <FormActions>
          <div className="flex w-full items-center gap-[10px]">
            <BackLink to="/apply/education" />
            <PrimaryButton type="submit" className="flex-1">
              Review Answers
            </PrimaryButton>
          </div>
        </FormActions>
      </form>
    </>
  );
}
