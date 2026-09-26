import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, LoadError, Loading, Notice, Panel, errorMessage, when } from '../components/ui';
import { useAccount } from '../lib/account';
import { useAsync } from '../lib/useAsync';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';
import { STATUS_TONE } from './status';

/**
 * The applicant's application(s): only what the Programme team has published (status, label and
 * message). Linking needs the person's explicit confirmation, and only applications sent with this
 * account's verified email address are offered.
 */
export default function AccountApplicationPage() {
  const account = useAccount();
  const email = account.status === 'signed-in' ? account.account.email : '';
  const { data, error, reload } = useAsync((signal) => accountApi.applications(signal), []);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  async function claim(id: string) {
    setClaiming(id);
    setClaimError(null);
    try {
      await accountApi.claim(id);
      setClaimed(true);
      reload();
    } catch (caught) {
      setClaimError(errorMessage(caught));
    } finally {
      setClaiming(null);
    }
  }

  return (
    <AccountFrame title="Your application" description="Updates appear here when the Programme team has news about your application.">
      {claimed && <Notice tone="success">Linked. You’ll find its status below.</Notice>}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-5">
          {data.claimed.map((item) => (
            <Panel
              key={item.id}
              title={`Application ${item.reference}`}
              description={`${item.cohortName} · sent ${when(item.submittedAt)}`}
            >
              <div className="flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-2 font-sans text-[15px] text-ink">
                  <span className="font-semibold">Status:</span>
                  <Badge tone={STATUS_TONE[item.status]}>{item.statusLabel}</Badge>
                </p>
                <p className="font-sans text-[15px] leading-[1.6] text-ink">{item.statusDescription}</p>
                {item.message && (
                  <div className="rounded-[10px] border border-line bg-cream px-4 py-3">
                    <p className="font-sans text-[13px] font-bold uppercase tracking-[0.8px] text-muted">Message from the Programme team</p>
                    <p className="mt-1 whitespace-pre-line font-sans text-[15px] leading-[1.6] text-ink">{item.message}</p>
                  </div>
                )}
                {item.publishedAt && <p className="font-sans text-[13px] text-muted">Last updated {when(item.publishedAt)}</p>}
              </div>
            </Panel>
          ))}

          {data.claimable.length > 0 && (
            <Panel
              title={data.claimed.length ? 'Another application you can link' : 'Is this your application?'}
              description={`These were sent with ${email}. Linking one shows its status here. Nothing else changes.`}
            >
              {claimError && <Notice tone="error">{claimError}</Notice>}
              <ul className="flex flex-col gap-3">
                {data.claimable.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3">
                    <span className="font-sans text-[15px] text-ink">
                      <strong>{item.reference}</strong> · {item.cohortName} · sent {when(item.submittedAt)}
                    </span>
                    <Button busy={claiming === item.id} disabled={claiming !== null} onClick={() => void claim(item.id)}>
                      Yes, link it to my account
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.claimed.length === 0 && data.claimable.length === 0 && (
            <Panel title="No application found">
              <p className="font-sans text-[15px] leading-[1.6] text-ink">
                There’s no application sent with {email}. If you applied with a different email address, sign out and sign in with that one.
                Otherwise,{' '}
                <Link to="/apply" className="font-bold text-brand underline underline-offset-4">
                  apply now
                </Link>
                .
              </p>
            </Panel>
          )}
        </div>
      )}
    </AccountFrame>
  );
}
