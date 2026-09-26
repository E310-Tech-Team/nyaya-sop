import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BackLink, PrimaryButton } from '../components/Buttons';
import { ErrorSummary, focusFirstInvalid } from '../components/ErrorSummary';
import { ChoiceGroup } from '../components/Fields';
import { Divider, FormActions, FormCard, StepHeader } from '../components/FormLayout';
import { usePageTitle } from '../components/RouteEffects';
import { CURRENT_STATUSES, EDUCATION_LEVELS } from '../shared/application';
import { hasErrors, validateEducation } from '../shared/validation';
import { useApplication } from '../state/application';

export default function EducationCareerPage() {
  usePageTitle('Step 2 of 3: Education & Career');
  const navigate = useNavigate();
  const { draft, updateEducation } = useApplication();
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const answers = draft.education;
  const errors = showErrors ? validateEducation(answers) : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    if (hasErrors(validateEducation(answers))) {
      setShowErrors(true);
      focusFirstInvalid(formRef.current);
      return;
    }
    navigate('/apply/purpose');
  }

  return (
    <>
      <StepHeader
        sectionLabel="Section 2"
        heading="Education & Career"
        intro="Share your highest level of education and current status so we can better understand your context."
      />
      <form ref={formRef} noValidate onSubmit={submit} className="flex w-full flex-col items-center gap-[28px]">
        <FormCard className="gap-[24px]">
          <ChoiceGroup
            name="educationLevel"
            number="01"
            legend="What is your highest level of education?"
            options={EDUCATION_LEVELS}
            value={answers.educationLevel}
            onChange={(educationLevel) => updateEducation({ educationLevel })}
            error={errors.educationLevel}
          />
          <Divider />
          <ChoiceGroup
            name="currentStatus"
            number="02"
            legend="What is your current status?"
            options={CURRENT_STATUSES}
            value={answers.currentStatus}
            onChange={(currentStatus) => updateEducation({ currentStatus })}
            error={errors.currentStatus}
          />
        </FormCard>

        <ErrorSummary count={Object.keys(errors).length} />

        <FormActions>
          <div className="flex w-full items-center gap-[10px]">
            <BackLink to="/apply/personal" />
            <PrimaryButton type="submit" className="flex-1">
              Save &amp; Continue
            </PrimaryButton>
          </div>
        </FormActions>
      </form>
    </>
  );
}
