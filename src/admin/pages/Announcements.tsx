import { useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, TextArea, errorMessage, when } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { adminApi, type AnnouncementRow } from '../api';
import { useAction } from '../parts';

type Values = { audience: 'public' | 'applicants'; cohortId: string; title: string; body: string };

function AnnouncementForm({ item, onSaved, onCancel }: { item?: AnnouncementRow; onSaved: () => void; onCancel: () => void }) {
  const cohorts = useAsync((signal) => adminApi.cohorts(signal), []);
  const [values, setValues] = useState<Values>({ audience: item?.audience ?? 'public', cohortId: item?.cohort?.id ?? '', title: item?.title ?? '', body: item?.body ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const input = { ...values, cohortId: values.audience === 'applicants' && values.cohortId ? values.cohortId : null };
    try {
      if (item) await adminApi.updateAnnouncement(item.id, input);
      else await adminApi.createAnnouncement(input);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors) setErrors(caught.fieldErrors as Record<string, string>);
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Who sees it"
          value={values.audience}
          error={errors.audience}
          onChange={(event) => setValues({ ...values, audience: event.currentTarget.value as Values['audience'] })}
          options={[
            { value: 'public', label: 'Everyone (Programme updates page)' },
            { value: 'applicants', label: 'Applicants with an account (their inbox)' },
          ]}
        />
        {values.audience === 'applicants' && (
          <Select
            label="Cohort"
            value={values.cohortId}
            onChange={(event) => setValues({ ...values, cohortId: event.currentTarget.value })}
            options={[{ value: '', label: 'All cohorts' }, ...(cohorts.data?.items ?? []).map((cohort) => ({ value: cohort.id, label: cohort.name }))]}
          />
        )}
      </div>
      <Input label="Title" maxLength={120} value={values.title} error={errors.title} onChange={(event) => setValues({ ...values, title: event.currentTarget.value })} />
      <TextArea label="Announcement" maxLength={5000} rows={8} value={values.body} error={errors.body} onChange={(event) => setValues({ ...values, body: event.currentTarget.value })} />
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          {item ? 'Save changes' : 'Save as draft'}
        </Button>
        <Button tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Notices that stay published on the site or in applicants' inboxes (separate from push notifications). */
export default function AnnouncementsPage() {
  const { data, error, reload } = useAsync((signal) => adminApi.announcements(signal), []);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { busy, run, notice } = useAction();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Announcements"
        documentTitle="Announcements · Admin"
        description="Public notices appear on the Programme updates page; applicant notices appear in applicants’ inboxes. To alert phones as well, send a notification."
        actions={editing !== 'new' ? <Button onClick={() => setEditing('new')}>New announcement</Button> : undefined}
      />
      {notice}
      {editing === 'new' && (
        <Panel title="New announcement">
          <AnnouncementForm
            onSaved={() => {
              setEditing(null);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </Panel>
      )}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Panel>
          <p className="font-sans text-[15px] text-muted">No announcements yet.</p>
        </Panel>
      ) : (
        data.items.map((item) => (
          <Panel
            key={item.id}
            title={item.title}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={item.status === 'published' ? 'success' : 'neutral'}>{item.status === 'draft' ? 'Draft' : item.status === 'published' ? 'Published' : 'Archived'}</Badge>
                {item.audience === 'public' ? 'Everyone' : `Applicants${item.cohort ? `: ${item.cohort.name}` : ''}`}
                {item.publishedAt && ` · published ${when(item.publishedAt)}`}
              </span>
            }
            actions={
              <>
                {item.status !== 'archived' && editing !== item.id && (
                  <Button tone="secondary" onClick={() => setEditing(item.id)}>
                    Edit
                  </Button>
                )}
                {item.status === 'draft' && (
                  <Button busy={busy === item.id} onClick={() => void run(item.id, () => adminApi.publishAnnouncement(item.id), 'Published.').then(reload)}>
                    Publish
                  </Button>
                )}
                {item.status === 'published' && (
                  <Button tone="secondary" busy={busy === item.id} onClick={() => void run(item.id, () => adminApi.archiveAnnouncement(item.id), 'Archived.').then(reload)}>
                    Archive
                  </Button>
                )}
              </>
            }
          >
            {editing === item.id ? (
              <AnnouncementForm
                item={item}
                onSaved={() => {
                  setEditing(null);
                  reload();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <p className="whitespace-pre-line font-sans text-[15px] leading-[1.6] text-ink">{item.body}</p>
            )}
          </Panel>
        ))
      )}
    </>
  );
}
