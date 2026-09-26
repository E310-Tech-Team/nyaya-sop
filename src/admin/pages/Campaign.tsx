import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, TextArea, errorMessage, when } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import {
  APPLICATION_STATUSES,
  CAMPAIGN_LIMITS,
  NOTIFICATION_LINK_PATHS,
  NOTIFICATION_TOPICS,
  PUBLISHED_STATUS_LABELS,
  TOPIC_DETAILS,
  type NotificationTopic,
} from '../../shared/platform';
import { DEFAULT_TIME_ZONE, SCHEDULING_TIME_ZONES, formatInZone, zoneLabel, zonedLocalToUtc } from '../../shared/time';
import { adminApi, type Audience, type AudienceCount, type Campaign, type CampaignInput, type CampaignStats } from '../api';
import { Stat } from '../parts';
import { useCan } from '../session';
import { CAMPAIGN_STATUS } from './Campaigns';

const DESTINATION_LABELS: Record<string, string> = {
  '/': 'Home page',
  '/about': 'About',
  '/programme': 'Programme',
  '/journey': 'Journey',
  '/faq': 'FAQ',
  '/updates': 'Programme updates',
  '/install': 'Install the app',
  '/notifications': 'Notification settings',
  '/account': 'Account overview (sign-in needed)',
  '/account/application': 'Their application (sign-in needed)',
  '/account/notifications': 'Their messages (sign-in needed)',
};
const TTL_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '6', label: '6 hours' },
  { value: '24', label: '1 day' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
  { value: '672', label: '28 days (the most allowed)' },
];
const ZONES = SCHEDULING_TIME_ZONES.map((zone) => ({ value: zone, label: `${zone} (${zoneLabel(zone)})` }));
const BLANK: CampaignInput = { title: '', body: '', linkPath: '/updates', topic: 'general', audience: { cohortIds: [], publishedStatuses: [] }, alsoInbox: true, ttlHours: 24 };

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Roughly how a notification appears. Every device renders it a little differently. */
function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="rounded-[18px] bg-[#2b2226] p-3">
        <div className="flex items-start gap-3 rounded-[14px] bg-white/95 p-3 shadow-sm">
          <img src="/icons/icon-192.png" alt="" className="size-[36px] shrink-0 rounded-full" />
          <div className="min-w-0 font-sans">
            <p className="text-[12px] text-muted">School of Purpose · now</p>
            <p className="truncate text-[14px] font-bold text-ink">{title || 'Title'}</p>
            <p className="line-clamp-3 text-[14px] leading-[1.4] text-ink">{body || 'Your message'}</p>
          </div>
        </div>
      </div>
      <figcaption className="font-sans text-[12px] leading-[1.45] text-muted">Preview. Phones and browsers each show notifications a little differently, and may cut long text short.</figcaption>
    </figure>
  );
}

function useAudienceCount(topic: NotificationTopic, audience: Audience, refresh = 0) {
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = JSON.stringify([topic, audience, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      adminApi.previewAudience(topic, audience, controller.signal).then(
        (value) => {
          setCount(value);
          setProblem(null);
        },
        (caught) => !controller.signal.aborted && setProblem(errorMessage(caught)),
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // `key` captures topic, audience and refresh
  return { count, problem };
}

function AudienceSummary({ count, alsoInbox, filtered }: { count: AudienceCount | null; alsoInbox: boolean; filtered: boolean }) {
  if (!count) return <p className="font-sans text-[14px] text-muted">Counting…</p>;
  return (
    <div className="flex flex-col gap-1 font-sans text-[14px] leading-[1.55] text-ink" aria-live="polite">
      <p>
        <strong>{count.devices}</strong> {count.devices === 1 ? 'device' : 'devices'} would get the notification ({count.linkedDevices} linked to{' '}
        {count.accountsWithDevices} {count.accountsWithDevices === 1 ? 'account' : 'accounts'}, {count.anonymousDevices} without an account).
      </p>
      {alsoInbox && (
        <p>
          <strong>{count.inboxAccounts}</strong> applicant {count.inboxAccounts === 1 ? 'account gets' : 'accounts get'} a copy in their inbox.
        </p>
      )}
      {filtered && <p className="text-muted">Cohort and status filters only reach people who have linked an application to an account.</p>}
    </div>
  );
}

function CampaignForm({ campaign, onSaved }: { campaign?: Campaign; onSaved: (id: string) => void }) {
  const [values, setValues] = useState<CampaignInput>(
    campaign
      ? { title: campaign.title, body: campaign.body, linkPath: campaign.linkPath, topic: campaign.topic, audience: campaign.audience, alsoInbox: campaign.alsoInbox, ttlHours: campaign.ttlHours }
      : BLANK,
  );
  const [idempotencyKey] = useState(newKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const cohorts = useAsync((signal) => adminApi.cohorts(signal), []);
  const { count, problem: countProblem } = useAudienceCount(values.topic, values.audience);
  const change = <K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const toggle = <T extends string>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((value) => value !== item));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    try {
      if (campaign) {
        await adminApi.updateCampaign(campaign.id, values);
        setSaved(true);
        onSaved(campaign.id);
      } else {
        onSaved((await adminApi.createCampaign({ ...values, idempotencyKey })).id);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors) setErrors(caught.fieldErrors as Record<string, string>);
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        {problem && <Notice tone="error">{problem}</Notice>}
        {saved && <Notice tone="success">Draft saved.</Notice>}
        <Input
          label="Title"
          hint={`${values.title.length}/${CAMPAIGN_LIMITS.title} characters. Keep it short and neutral: it can show on a lock screen.`}
          maxLength={CAMPAIGN_LIMITS.title}
          value={values.title}
          error={errors.title}
          onChange={(event) => change('title', event.currentTarget.value)}
        />
        <TextArea
          label="Message"
          hint={`${values.body.length}/${CAMPAIGN_LIMITS.body} characters. Never include personal details or decisions about individuals.`}
          maxLength={CAMPAIGN_LIMITS.body}
          value={values.body}
          error={errors.body}
          onChange={(event) => change('body', event.currentTarget.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Opens"
            value={values.linkPath}
            error={errors.linkPath}
            onChange={(event) => change('linkPath', event.currentTarget.value)}
            options={NOTIFICATION_LINK_PATHS.map((path) => ({ value: path, label: DESTINATION_LABELS[path] ?? path }))}
          />
          <Select
            label="Topic"
            hint="Only people who chose this topic are included."
            value={values.topic}
            error={errors.topic}
            onChange={(event) => change('topic', event.currentTarget.value as NotificationTopic)}
            options={NOTIFICATION_TOPICS.map((topic) => ({ value: topic, label: TOPIC_DETAILS[topic].label }))}
          />
        </div>
        <fieldset className="flex flex-col gap-3 rounded-[12px] border border-line p-4">
          <legend className="px-1 font-sans text-[14px] font-bold text-ink">Only people whose application is in these cohorts (optional)</legend>
          {(cohorts.data?.items ?? []).map((cohort) => (
            <Checkbox
              key={cohort.id}
              label={cohort.name}
              checked={values.audience.cohortIds.includes(cohort.id)}
              onChange={(event) => change('audience', { ...values.audience, cohortIds: toggle(values.audience.cohortIds, cohort.id, event.currentTarget.checked) })}
            />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-3 rounded-[12px] border border-line p-4">
          <legend className="px-1 font-sans text-[14px] font-bold text-ink">Only people with these published statuses (optional)</legend>
          {APPLICATION_STATUSES.map((status) => (
            <Checkbox
              key={status}
              label={PUBLISHED_STATUS_LABELS[status].label}
              checked={values.audience.publishedStatuses.includes(status)}
              onChange={(event) =>
                change('audience', { ...values.audience, publishedStatuses: toggle(values.audience.publishedStatuses, status, event.currentTarget.checked) })
              }
            />
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox label="Also put a copy in applicants’ inboxes" hint="Accounts that match, whether or not they have notifications on." checked={values.alsoInbox} onChange={(event) => change('alsoInbox', event.currentTarget.checked)} />
          <Select
            label="Stop trying to deliver after"
            hint="Phones that are off longer than this won’t get it late."
            value={String(values.ttlHours)}
            error={errors.ttlHours}
            onChange={(event) => change('ttlHours', Number(event.currentTarget.value))}
            options={TTL_OPTIONS}
          />
        </div>
        <div>
          <Button type="submit" busy={busy}>
            {campaign ? 'Save draft' : 'Create draft'}
          </Button>
        </div>
      </div>
      <aside className="flex flex-col gap-4">
        <NotificationPreview title={values.title} body={values.body} />
        <div className="rounded-[12px] border border-line bg-white p-4">
          <p className="mb-2 font-sans text-[14px] font-bold text-ink">Audience right now</p>
          {countProblem ? <Notice tone="error">{countProblem}</Notice> : <AudienceSummary count={count} alsoInbox={values.alsoInbox} filtered={values.audience.cohortIds.length + values.audience.publishedStatuses.length > 0} />}
        </div>
      </aside>
    </form>
  );
}

function TestSend({ campaignId }: { campaignId: string }) {
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Send a test" description="Goes only to your own test devices, never to applicants.">
      {result && (
        <Notice tone={result.tone}>
          {result.text}
          {result.tone === 'error' && (
            <>
              {' '}
              <Link to="/admin/campaigns" className="font-bold text-brand underline underline-offset-4">
                Manage test devices
              </Link>
            </>
          )}
        </Notice>
      )}
      <div>
        <Button
          tone="secondary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              const { devices } = await adminApi.testCampaign(campaignId);
              setResult({ tone: 'success', text: `Test queued for ${devices} of your test ${devices === 1 ? 'device' : 'devices'}. It should arrive within a minute.` });
            } catch (caught) {
              setResult({ tone: 'error', text: errorMessage(caught) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Send a test to my devices
        </Button>
      </div>
    </Panel>
  );
}

function SchedulePanel({ campaign, onDone }: { campaign: Campaign; onDone: () => void }) {
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [localTime, setLocalTime] = useState('');
  const [timeZone, setTimeZone] = useState(campaign.timeZone || DEFAULT_TIME_ZONE);
  const [confirmed, setConfirmed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { count } = useAudienceCount(campaign.topic, campaign.audience, refresh);
  const inbox = campaign.alsoInbox ? (count?.inboxAccounts ?? 0) : 0;
  let sendAt: Date | null = null;
  if (mode === 'later' && localTime) {
    try {
      sendAt = zonedLocalToUtc(localTime, timeZone);
    } catch {
      sendAt = null;
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!count) return;
    setBusy(true);
    setProblem(null);
    try {
      // The zone picker only shows for a set time; an immediate send is recorded in Lagos time.
      await adminApi.scheduleCampaign(campaign.id, {
        when: mode,
        localTime: mode === 'later' ? localTime : undefined,
        timeZone: mode === 'later' ? timeZone : DEFAULT_TIME_ZONE,
        confirmDevices: count.devices,
        confirmInbox: inbox,
      });
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setProblem('The audience changed while you were checking. The numbers below are up to date: please check them and confirm again.');
        setConfirmed(false);
        setRefresh((value) => value + 1);
      } else {
        setProblem(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const nobody = count !== null && count.devices === 0 && inbox === 0;
  return (
    <Panel title="Send" description="Sending freezes the message: after this, it can be cancelled but not edited.">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Notice tone="error">{problem}</Notice>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-sans text-[14px] font-bold text-ink">When</legend>
          <label className="flex items-center gap-2 font-sans text-[15px]">
            <input type="radio" name="when" className="size-[18px] accent-brand" checked={mode === 'now'} onChange={() => setMode('now')} /> As soon as I confirm
          </label>
          <label className="flex items-center gap-2 font-sans text-[15px]">
            <input type="radio" name="when" className="size-[18px] accent-brand" checked={mode === 'later'} onChange={() => setMode('later')} /> At a set time
          </label>
        </fieldset>
        {mode === 'later' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Date and time" type="datetime-local" value={localTime} onChange={(event) => setLocalTime(event.currentTarget.value)} />
            <Select label="Time zone" value={timeZone} options={ZONES} onChange={(event) => setTimeZone(event.currentTarget.value)} />
            {sendAt && (
              <p className="font-sans text-[14px] text-muted sm:col-span-2">
                That’s {formatInZone(sendAt, timeZone)}
                {timeZone !== DEFAULT_TIME_ZONE && ` (${formatInZone(sendAt, DEFAULT_TIME_ZONE)} in Lagos)`}.
              </p>
            )}
          </div>
        )}
        <div className="rounded-[12px] border border-brand/40 bg-rose/20 p-4">
          <p className="mb-2 font-sans text-[14px] font-bold text-ink">Final check</p>
          <AudienceSummary count={count} alsoInbox={campaign.alsoInbox} filtered={campaign.audience.cohortIds.length + campaign.audience.publishedStatuses.length > 0} />
          {nobody && <p className="mt-2 font-sans text-[14px] font-bold text-brand">Nobody matches this audience at the moment.</p>}
          <Checkbox className="mt-3" label="I’ve checked the message, the audience and the time" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
        </div>
        <div>
          <Button type="submit" busy={busy} disabled={!confirmed || !count || (mode === 'later' && !sendAt)}>
            {mode === 'later' && !sendAt
              ? 'Choose a time'
              : `${mode === 'now' ? 'Send now' : `Schedule for ${formatInZone(sendAt!, timeZone)}`}: ${count?.devices ?? '…'} ${count?.devices === 1 ? 'device' : 'devices'}${
                  inbox ? `, ${inbox} ${inbox === 1 ? 'inbox' : 'inboxes'}` : ''
                }`}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Results({ stats }: { stats: CampaignStats }) {
  return (
    <Panel title="What happened" description="Accepted by push service means Apple, Google, Mozilla or Microsoft took the message for delivery. It doesn’t tell us whether it was shown or read.">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices targeted" value={stats.devices} />
        <Stat label="Waiting or retrying" value={stats.queued} />
        <Stat label="Attempted" value={stats.attempted} />
        <Stat label="Accepted by push service" value={stats.acceptedByPushService} />
        <Stat label="Failed" value={stats.failed} hint="Includes devices that no longer exist." />
        <Stat label="Expired before delivery" value={stats.expired} />
        <Stat label="Skipped" value={stats.skipped} hint="Turned off, no longer eligible, or cancelled before sending." />
        <Stat label="Inbox copies" value={stats.inboxEntries} />
        <Stat label="Recorded clicks" value={stats.recordedClicks} hint="A lower bound: not every click can be recorded." />
      </dl>
    </Panel>
  );
}

export function NewCampaignPage() {
  const navigate = useNavigate();
  return (
    <>
      <Link to="/admin/campaigns" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← Notifications
      </Link>
      <PageHeader eyebrow="New notification" title="Write a notification" documentTitle="New notification · Admin" description="It’s saved as a draft. Nothing is sent until you confirm." />
      <CampaignForm onSaved={(id) => navigate(`/admin/campaigns/${id}`, { replace: true })} />
    </>
  );
}

export default function CampaignPage() {
  const { id = '' } = useParams();
  const canSend = useCan('campaigns.send');
  const { data, error, reload } = useAsync((signal) => adminApi.campaign(id, signal), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [cancelProblem, setCancelProblem] = useState<string | null>(null);
  const live = data?.campaign.status === 'scheduled' || data?.campaign.status === 'sending';
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(reload, 5000);
    return () => window.clearInterval(timer);
  }, [live, reload]);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { campaign, stats } = data;
  const status = CAMPAIGN_STATUS[campaign.status];

  const cancel = async () => {
    setCancelProblem(null);
    try {
      await adminApi.cancelCampaign(campaign.id);
      setCancelling(false);
      reload();
    } catch (caught) {
      setCancelProblem(errorMessage(caught));
    }
  };

  return (
    <>
      <Link to="/admin/campaigns" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← Notifications
      </Link>
      <PageHeader
        eyebrow="Notification"
        title={campaign.title}
        documentTitle={`${campaign.title} · Admin`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {campaign.status === 'scheduled' && campaign.scheduledFor && `Sends ${when(campaign.scheduledFor, campaign.timeZone)}`}
            {campaign.completedAt && `Finished ${when(campaign.completedAt, campaign.timeZone)}`}
            {campaign.cancelledAt && `Cancelled ${when(campaign.cancelledAt, campaign.timeZone)}`}
          </span>
        }
      />
      {campaign.status === 'draft' ? (
        <>
          <Panel title="Message and audience">
            <CampaignForm campaign={campaign} onSaved={() => reload()} />
          </Panel>
          <TestSend campaignId={campaign.id} />
          {canSend && <SchedulePanel campaign={campaign} onDone={reload} />}
        </>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel title="Message">
              <dl className="grid gap-2 font-sans text-[14px] sm:grid-cols-[160px_1fr]">
                <dt className="text-muted">Topic</dt>
                <dd>{TOPIC_DETAILS[campaign.topic].label}</dd>
                <dt className="text-muted">Opens</dt>
                <dd>{DESTINATION_LABELS[campaign.linkPath] ?? campaign.linkPath}</dd>
                <dt className="text-muted">Inbox copy</dt>
                <dd>{campaign.alsoInbox ? 'Yes' : 'No'}</dd>
                <dt className="text-muted">Filters</dt>
                <dd>
                  {campaign.audience.cohortIds.length || campaign.audience.publishedStatuses.length
                    ? `${campaign.audience.cohortIds.length} cohort(s), ${campaign.audience.publishedStatuses.map((value) => PUBLISHED_STATUS_LABELS[value].label).join(', ') || 'any status'}`
                    : 'Everyone who chose the topic'}
                </dd>
                <dt className="text-muted">Stops trying after</dt>
                <dd>{campaign.ttlHours} hours</dd>
              </dl>
            </Panel>
            <NotificationPreview title={campaign.title} body={campaign.body} />
          </div>
          <Results stats={stats} />
          {live && <p className="font-sans text-[13px] text-muted">Updating every few seconds while this is in progress.</p>}
        </>
      )}
      {canSend && (campaign.status === 'draft' || live) && (
        <Panel title={campaign.status === 'draft' ? 'Discard this draft' : 'Cancel sending'}>
          {cancelProblem && <Notice tone="error">{cancelProblem}</Notice>}
          {!cancelling ? (
            <div>
              <Button tone="secondary" onClick={() => setCancelling(true)}>
                {campaign.status === 'draft' ? 'Discard draft' : 'Cancel this notification'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-sans text-[14px] text-ink">
                {campaign.status === 'sending' ? 'Devices that already got it keep it; nothing more will be sent.' : 'Nothing will be sent.'}
              </p>
              <Button tone="danger" onClick={() => void cancel()}>
                Yes, cancel it
              </Button>
              <Button tone="ghost" onClick={() => setCancelling(false)}>
                Keep it
              </Button>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
