import { useState, type FormEvent } from 'react';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, errorMessage, when } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { APPLICATION_STATUSES, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { DEFAULT_TIME_ZONE, SCHEDULING_TIME_ZONES, utcToZonedLocal, zoneLabel } from '../../shared/time';
import { adminApi, type Cohort } from '../api';
import { useCan } from '../session';

const ZONES = SCHEDULING_TIME_ZONES.map((zone) => ({ value: zone, label: `${zone} (${zoneLabel(zone)})` }));

type FormValues = { slug: string; name: string; edition: string; opensAt: string; closesAt: string; timeZone: string; acceptingApplications: boolean };

function CohortForm({ cohort, onSaved, onCancel }: { cohort?: Cohort; onSaved: () => void; onCancel?: () => void }) {
  const [values, setValues] = useState<FormValues>({
    slug: cohort?.slug ?? '',
    name: cohort?.name ?? '',
    edition: cohort ? String(cohort.edition) : '',
    opensAt: cohort?.opensAt ? utcToZonedLocal(new Date(cohort.opensAt), DEFAULT_TIME_ZONE) : '',
    closesAt: cohort?.closesAt ? utcToZonedLocal(new Date(cohort.closesAt), DEFAULT_TIME_ZONE) : '',
    timeZone: DEFAULT_TIME_ZONE,
    acceptingApplications: cohort?.acceptingApplications ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = (key: keyof FormValues, value: string | boolean) => setValues({ ...values, [key]: value });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const payload = { ...values, edition: Number(values.edition), opensAt: values.opensAt || null, closesAt: values.closesAt || null };
    try {
      if (cohort) await adminApi.updateCohort(cohort.id, payload);
      else await adminApi.createCohort(payload);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors) setErrors(caught.fieldErrors as Record<string, string>);
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      {problem && <Notice tone="error" className="sm:col-span-2">{problem}</Notice>}
      <Input label="Name" value={values.name} error={errors.name} onChange={(event) => change('name', event.currentTarget.value)} />
      <Input label="Edition" inputMode="numeric" value={values.edition} error={errors.edition} onChange={(event) => change('edition', event.currentTarget.value)} />
      <Input
        label="Short name for links"
        hint="Lowercase letters, numbers and hyphens, e.g. called-generation-2"
        value={values.slug}
        error={errors.slug}
        onChange={(event) => change('slug', event.currentTarget.value)}
      />
      <Select label="Times are in" value={values.timeZone} options={ZONES} onChange={(event) => change('timeZone', event.currentTarget.value)} />
      <Input label="Applications open" type="datetime-local" value={values.opensAt} error={errors.opensAt} hint="Leave empty to open as soon as accepting is on." onChange={(event) => change('opensAt', event.currentTarget.value)} />
      <Input label="Applications close" type="datetime-local" value={values.closesAt} error={errors.closesAt} hint="Leave empty for no closing date." onChange={(event) => change('closesAt', event.currentTarget.value)} />
      <Checkbox
        className="sm:col-span-2"
        label="Accepting applications"
        hint="The form only takes applications while this is on and the time is between the opening and closing times."
        checked={values.acceptingApplications}
        onChange={(event) => change('acceptingApplications', event.currentTarget.checked)}
      />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" busy={busy}>
          {cohort ? 'Save changes' : 'Create cohort'}
        </Button>
        {onCancel && (
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export default function CohortsPage() {
  const canManage = useCan('cohorts.manage');
  const { data, error, reload } = useAsync((signal) => adminApi.cohorts(signal), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Cohorts"
        documentTitle="Cohorts · Admin"
        description="Each intake of applicants. Past cohorts keep their applications and history."
        actions={canManage && !creating ? <Button onClick={() => setCreating(true)}>New cohort</Button> : undefined}
      />
      {creating && (
        <Panel title="New cohort">
          <CohortForm
            onSaved={() => {
              setCreating(false);
              reload();
            }}
            onCancel={() => setCreating(false)}
          />
        </Panel>
      )}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        data.items.map((cohort) => (
          <Panel
            key={cohort.id}
            title={`${cohort.name} (edition ${cohort.edition})`}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={cohort.isOpenNow ? 'success' : 'neutral'}>{cohort.isOpenNow ? 'Open now' : 'Closed'}</Badge>
                Opens {when(cohort.opensAt)} · closes {when(cohort.closesAt)}
              </span>
            }
            actions={canManage && editing !== cohort.id ? <Button tone="secondary" onClick={() => setEditing(cohort.id)}>Edit</Button> : undefined}
          >
            {editing === cohort.id ? (
              <CohortForm
                cohort={cohort}
                onSaved={() => {
                  setEditing(null);
                  reload();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <p className="font-sans text-[14px] text-ink">
                <strong>{cohort.total}</strong> {cohort.total === 1 ? 'application' : 'applications'}
                {cohort.total > 0 &&
                  `: ${APPLICATION_STATUSES.filter((status) => cohort.totals[status])
                    .map((status) => `${cohort.totals[status]} ${REVIEW_STATUS_LABELS[status].toLowerCase()}`)
                    .join(', ')}`}
              </p>
            )}
          </Panel>
        ))
      )}
    </>
  );
}
