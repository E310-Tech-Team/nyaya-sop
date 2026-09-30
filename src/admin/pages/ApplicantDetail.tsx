import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, TextArea, errorMessage, when } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { chainRows } from '../../lib/parish';
import { useAsync } from '../../lib/useAsync';
import { CHURCH_LEVELS, PARISH_ANSWER_LABELS, type ParishChain } from '../../shared/directory';
import { APPLICATION_UPDATE_NOTIFICATION, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { adminApi, type ApplicantDetail, type ParishReport } from '../api';
import { DirectoryStatusBadge, ParishFinder } from '../directory-parts';
import { ConfirmByTyping, PublishedBadge, ReviewBadge, useAction } from '../parts';
import { useCan } from '../session';

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[180px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
          <dd className="break-words font-sans text-[15px] text-ink">{value || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const REPORT_OUTCOMES: Record<ParishReport['status'], string> = {
  pending: 'waiting in Parish review',
  linked: 'linked to a parish',
  added: 'parish added to the directory',
  fixed: 'directory corrected',
  rejected: 'closed without a change',
};

const sameChain = (a: ParishChain, b: ParishChain) => CHURCH_LEVELS.every((level) => (a[level]?.id ?? null) === (b[level]?.id ?? null));

/** The parish answer: what the applicant gave, the parish it links to now, and any reports. */
function ParishPanel({ app, canEdit, onChanged }: { app: ApplicantDetail; canEdit: boolean; onChanged: () => void }) {
  const { parish } = app;
  const { busy, run, notice } = useAction();
  const change = (parishId: string | null, success: string) => run('parish', () => adminApi.changeApplicantParish(app.id, parishId), success).then((ok) => ok && onChanged());
  const current = parish.current;
  const confirmedSame = Boolean(current && parish.submitted && parish.submitted.parish.id === current.id && sameChain(parish.submitted.chain, current.chain));
  return (
    <Panel title="RCCG parish" description={PARISH_ANSWER_LABELS[parish.status]}>
      {notice}
      {parish.status !== 'listed' && parish.answer && (
        <p className="font-sans text-[15px] text-ink">
          {parish.status === 'reported' ? 'They couldn’t find their parish and typed' : 'They typed'}: <strong>{parish.answer}</strong>
        </p>
      )}
      {current ? (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-muted">In the directory now</p>
          <Details
            rows={[
              [
                'Parish',
                <>
                  {current.name} <DirectoryStatusBadge status={current.status} />
                  {current.mergedInto && <span className="text-muted"> (merged into {current.mergedInto.name})</span>}
                </>,
              ],
              ...chainRows(current.chain),
            ]}
          />
          {parish.linkedBy && (
            <p className="font-sans text-[13px] text-muted">
              Linked by {parish.linkedBy.name}, {when(parish.linkedBy.at)}.
            </p>
          )}
        </div>
      ) : (
        <p className="font-sans text-[14px] text-muted">No directory parish is linked.</p>
      )}
      {parish.submitted &&
        (confirmedSame ? (
          <p className="font-sans text-[13px] text-muted">This is what the applicant confirmed.</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-[10px] bg-cream px-3 py-2">
            <p className="font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-muted">As the applicant confirmed it</p>
            <Details rows={[['Parish', parish.submitted.parish.name], ...chainRows(parish.submitted.chain)]} />
          </div>
        ))}
      {parish.reports.length > 0 && (
        <ul className="flex flex-col gap-1 font-sans text-[14px] text-ink">
          {parish.reports.map((report) => (
            <li key={report.id}>
              {report.kind === 'not_listed' ? `Reported as not listed (“${report.reportedName}”)` : 'Flagged: “details look wrong”'} · {REPORT_OUTCOMES[report.status]}
              {report.resolvedParish ? ` (${report.resolvedParish})` : ''}
              {report.resolvedAt ? `, by ${report.resolvedBy}, ${when(report.resolvedAt)}` : ''}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-col gap-2">
          {/* Keyed by the parish, so it closes and clears once the change is made. */}
          <details key={current?.id ?? 'none'} className="rounded-[10px] border border-line px-3 py-2">
            <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">{current ? 'Change the parish' : 'Link a parish'}</summary>
            <div className="pt-3">
              <ParishFinder
                label="Parish"
                hint="What the applicant confirmed or typed stays on the application."
                initialQuery={current?.name ?? parish.answer ?? ''}
                action="Link"
                exclude={current ? [current.id] : []}
                onChoose={(chosen) => change(chosen.id, `Linked to ${chosen.name}.`)}
              />
            </div>
          </details>
          {parish.linkedBy && parish.status !== 'listed' && (
            <div>
              <Button tone="ghost" busy={busy === 'parish'} onClick={() => void change(null, 'Link removed: the answer is back in Parish review.')}>
                Remove the link
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ReviewPanel({ app, onChanged }: { app: ApplicantDetail; onChanged: () => void }) {
  const { busy, run, notice } = useAction();
  return (
    <Panel title="Review status" description="Internal: the applicant doesn’t see this until you publish it.">
      <p className="flex items-center gap-2 font-sans text-[15px]">
        Now: <ReviewBadge status={app.status} />
      </p>
      {notice}
      {app.allowedTransitions.length ? (
        <div className="flex flex-wrap gap-2">
          {app.allowedTransitions.map((status) => (
            <Button key={status} tone="secondary" busy={busy === status} disabled={busy !== null} onClick={() => void run(status, () => adminApi.setStatus(app.id, status)).then((ok) => ok && onChanged())}>
              Move to “{REVIEW_STATUS_LABELS[status]}”
            </Button>
          ))}
        </div>
      ) : (
        <p className="font-sans text-[14px] text-muted">No further changes are possible from this status.</p>
      )}
    </Panel>
  );
}

function PublishPanel({ app, onChanged }: { app: ApplicantDetail; onChanged: () => void }) {
  const [message, setMessage] = useState(app.published.message ?? '');
  const [reviewing, setReviewing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const upToDate = app.published.status === app.status && (app.published.message ?? '') === message.trim();
  const target = PUBLISHED_STATUS_LABELS[app.status];

  const publish = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await adminApi.publish(app.id, app.status, message.trim());
      setResult({
        tone: 'success',
        text: response.notified
          ? 'Published. The applicant has a message in their account, and devices they chose will get a short notification.'
          : 'Published. The applicant hasn’t linked an account, so they’ll see it if they sign in later.',
      });
      setReviewing(false);
      setChecked(false);
      onChanged();
    } catch (caught) {
      setResult({ tone: 'error', text: caught instanceof ApiError && caught.status === 409 ? caught.message : errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="What the applicant sees" description="Publishing is always a separate, deliberate step.">
      <p className="flex flex-wrap items-center gap-2 font-sans text-[15px]">
        Published now: <PublishedBadge status={app.published.status} />
        {app.published.at && <span className="text-[13px] text-muted">since {when(app.published.at)}</span>}
      </p>
      {app.published.message && <p className="whitespace-pre-line rounded-[10px] bg-cream px-3 py-2 font-sans text-[14px] text-ink">{app.published.message}</p>}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <TextArea
        label="Message to the applicant (optional)"
        hint="Up to 1,000 characters. Shown with the status in their account; never on a lock screen."
        maxLength={1000}
        value={message}
        onChange={(event) => {
          setMessage(event.currentTarget.value);
          setReviewing(false);
        }}
      />
      {!reviewing ? (
        <div>
          <Button disabled={upToDate} onClick={() => setReviewing(true)}>
            {upToDate ? 'Already published' : `Review before publishing “${target.label}”`}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-brand/40 bg-rose/20 p-4">
          <p className="font-sans text-[15px] font-bold text-ink">The applicant will see:</p>
          <div className="rounded-[10px] bg-white px-4 py-3 font-sans text-[15px] text-ink">
            <p>
              <strong>{target.label}</strong>. {target.description}
            </p>
            {message.trim() && <p className="mt-2 whitespace-pre-line">{message.trim()}</p>}
          </div>
          {app.account ? (
            <p className="font-sans text-[14px] text-ink">
              They also get an inbox message, and devices set up for application updates get this notification:{' '}
              <em>“{APPLICATION_UPDATE_NOTIFICATION.body}”</em>
            </p>
          ) : (
            <p className="font-sans text-[14px] text-ink">They haven’t linked an account, so nobody is notified now.</p>
          )}
          <Checkbox label="I’ve checked the status and message" checked={checked} onChange={(event) => setChecked(event.currentTarget.checked)} />
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} disabled={!checked} onClick={() => void publish()}>
              Publish to the applicant
            </Button>
            <Button tone="ghost" onClick={() => setReviewing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function AssignPanel({ app, onChanged }: { app: ApplicantDetail; onChanged: () => void }) {
  const reviewers = useAsync((signal) => adminApi.reviewers(signal), []);
  const [choice, setChoice] = useState(app.reviewer?.id ?? '');
  const { busy, run, notice } = useAction();
  return (
    <Panel title="Reviewer">
      {notice}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Assigned to"
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value)}
          options={[{ value: '', label: 'Nobody' }, ...(reviewers.data?.items ?? []).map((reviewer) => ({ value: reviewer.id, label: reviewer.name }))]}
          className="min-w-[220px]"
        />
        <Button busy={busy === 'assign'} disabled={choice === (app.reviewer?.id ?? '')} onClick={() => void run('assign', () => adminApi.assign(app.id, choice || null), 'Saved.').then((ok) => ok && onChanged())}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

function NotesPanel({ app, canWrite, onChanged }: { app: ApplicantDetail; canWrite: boolean; onChanged: () => void }) {
  const [body, setBody] = useState('');
  const { busy, run, notice } = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run('note', () => adminApi.addNote(app.id, body.trim()))) {
      setBody('');
      onChanged();
    }
  };
  return (
    <Panel title="Internal notes" description="Only staff can read these. They are never shown to the applicant.">
      {app.notes.length ? (
        <ol className="flex flex-col gap-3">
          {app.notes.map((note) => (
            <li key={note.id} className="rounded-[10px] border border-line px-4 py-3">
              <p className="whitespace-pre-line font-sans text-[15px] text-ink">{note.body}</p>
              <p className="mt-1 font-sans text-[12px] text-muted">
                {note.author} · {when(note.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="font-sans text-[14px] text-muted">No notes yet.</p>
      )}
      {canWrite && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {notice}
          <TextArea label="Add a note" maxLength={4000} value={body} onChange={(event) => setBody(event.currentTarget.value)} />
          <div>
            <Button type="submit" busy={busy === 'note'} disabled={!body.trim()}>
              Add note
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function CorrectionPanel({ app, onChanged }: { app: ApplicantDetail; onChanged: () => void }) {
  const initial = {
    fullName: app.personal.fullName,
    email: app.personal.email,
    phone: app.personal.phone,
    stateOfResidence: app.personal.stateOfResidence,
    city: app.personal.city,
    parishName: app.personal.parishName ?? '',
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof initial, label: string, type = 'text') => (
    <Input label={label} type={type} value={values[key]} error={errors[key]} onChange={(event) => setValues({ ...values, [key]: event.currentTarget.value })} />
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setResult(null);
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== initial[key as keyof typeof initial]));
    try {
      const response = await adminApi.correct(app.id, changes);
      setResult({ tone: 'success', text: response.changed.length ? `Corrected: ${response.changed.join(', ')}.` : 'Nothing changed.' });
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors) setErrors(caught.fieldErrors as Record<string, string>);
      setResult({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Correct contact details" description="For corrections the applicant asked for. The same checks as the form apply, and changes are recorded (field names only).">
      <form noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {result && <Notice tone={result.tone} className="sm:col-span-2">{result.text}</Notice>}
        {field('fullName', 'Full name')}
        {field('email', 'Email address', 'email')}
        {field('phone', 'Phone number', 'tel')}
        {field('stateOfResidence', 'State of residence')}
        {field('city', 'City or town')}
        {/* A parish from the directory, or reported as not listed, changes in the parish panel. */}
        {(app.parish.status === 'legacy_text' || app.parish.status === 'not_provided') && field('parishName', 'RCCG parish as typed (optional)')}
        <div className="sm:col-span-2">
          <Button type="submit" busy={busy}>
            Save corrections
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export default function ApplicantDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: app, error, reload } = useAsync((signal) => adminApi.applicant(id, signal), [id]);
  const canReview = useCan('applications.review');
  const canPublish = useCan('applications.publish');
  const canAssign = useCan('applications.assign');
  const canNote = useCan('applications.note');
  const canEdit = useCan('applications.edit');

  if (error) {
    return (
      <>
        <PageHeader title="Application" documentTitle="Application · Admin" />
        <LoadError error={error} onRetry={reload} />
        <Link to="/admin/applicants" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
          Back to applicants
        </Link>
      </>
    );
  }
  if (!app) return <Loading />;

  return (
    <>
      <Link to="/admin/applicants" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← Applicants
      </Link>
      <PageHeader
        eyebrow={`${app.reference} · ${app.cohort.name}`}
        title={app.personal.fullName}
        documentTitle={`${app.reference} · Admin`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ReviewBadge status={app.status} /> Published: <PublishedBadge status={app.published.status} />
            {app.account && <Badge>Account linked {when(app.account.claimedAt)}</Badge>}
          </span>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Personal details">
            <Details
              rows={[
                ['Email', app.personal.email],
                ['Phone', app.personal.phone],
                ['Gender', app.personal.gender],
                ['Age range', app.personal.ageRange],
                ['State of residence', app.personal.stateOfResidence],
                ['City or town', app.personal.city],
              ]}
            />
          </Panel>
          <ParishPanel app={app} canEdit={canEdit} onChanged={reload} />
          <Panel title="Education and purpose">
            <Details
              rows={[
                ['Highest education', app.education.educationLevel],
                ['Current status', app.education.currentStatus],
                ['Purpose clarity', app.purposeClarity],
              ]}
            />
          </Panel>
          <Panel title="Submission">
            <Details
              rows={[
                ['Submitted', when(app.submittedAt)],
                ['Consent', `${app.consent.version}, ${when(app.consent.at)}`],
                ['Came from', [app.attribution.utmSource, app.attribution.utmMedium, app.attribution.utmCampaign].filter(Boolean).join(' / ') || app.attribution.referrer],
              ]}
            />
          </Panel>
          <NotesPanel app={app} canWrite={canNote} onChanged={reload} />
          <Panel title="History">
            {app.history.length ? (
              <ol className="flex flex-col gap-1.5 font-sans text-[14px] text-ink">
                {app.history.map((event, index) => (
                  <li key={index}>
                    <span className="text-muted">{when(event.created_at)}</span> ·{' '}
                    {event.kind === 'publication'
                      ? `Published “${PUBLISHED_STATUS_LABELS[event.to_status].label}” to the applicant`
                      : `Review status ${event.from_status ? `${REVIEW_STATUS_LABELS[event.from_status]} → ` : ''}${REVIEW_STATUS_LABELS[event.to_status]}`}{' '}
                    · {event.actor ?? 'Former staff member'}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="font-sans text-[14px] text-muted">No changes yet.</p>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {canReview && <ReviewPanel app={app} onChanged={reload} />}
          {/* Keyed by review status only, so a publish confirmation stays on screen after the reload. */}
          {canPublish && <PublishPanel key={app.status} app={app} onChanged={reload} />}
          {canAssign && <AssignPanel app={app} onChanged={reload} />}
          {canEdit && <CorrectionPanel app={app} onChanged={reload} />}
          {canEdit && (
            <Panel title="Delete this application">
              <ConfirmByTyping
                expected={app.reference}
                label={`Type ${app.reference} to confirm`}
                action="Delete application"
                explanation="Only for a request to erase the application. Its notes and history are deleted with it; the deletion itself is recorded."
                onConfirm={async (typed) => {
                  await adminApi.deleteApplicant(app.id, typed);
                  navigate('/admin/applicants', { replace: true });
                }}
              />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

