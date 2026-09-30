import { ChurchIcon, ClipboardListIcon, LinkIcon, UnlinkIcon } from 'lucide-react';
import { Link } from 'react-router';
import type { ReportSummary } from '../api';
import { useCan, useCanAll } from '../session';
import { countWithShare, formatCount, percent } from './model';
import { ActionLink, applicantsHref, EmptyReport, MetricCard, ReportCard, ReportPage, SectionHeading, useReportFilters } from './parts';
import { CategoryBar } from './visuals';

/** How applicants answered the parish question, and which answers still need a directory parish. */
export default function ParishAnswersReportPage() {
  return (
    <ReportPage
      title="Parish answers"
      description="How applicants answered the parish question, and whether each application has a parish from the RCCG directory, chosen by the applicant or linked by staff in Parish review."
    >
      {({ summary }) => <ParishAnswers summary={summary} />}
    </ReportPage>
  );
}

const LINKED = 'var(--color-brand)';
const UNLINKED = 'var(--color-line-strong)';

function ParishAnswers({ summary }: { summary: ReportSummary }) {
  const { query, carry } = useReportFilters();
  const canApplicants = useCan('applications.view_all');
  const canReview = useCanAll('applications.view_all', 'applications.edit', 'directory.manage');
  if (summary.applications === 0) return <EmptyReport title="No applications match these filters." />;
  const view = (extra: Record<string, string>) => (canApplicants ? applicantsHref(query, extra) : null);
  const waiting = [summary.waiting.notListed, summary.waiting.detailsWrong, summary.waiting.earlierText];
  const waitingTotal = waiting.some((count) => count === null) ? null : waiting.reduce<number>((sum, count) => sum + (count ?? 0), 0);

  const answers = [
    {
      key: 'reported',
      title: "Couldn't find their parish",
      description: 'They chose “I can’t find my parish” and typed its name. Staff link each one in Parish review, or add the parish to the directory.',
      split: summary.answers.reported,
    },
    {
      key: 'legacy_text',
      title: 'Typed on the earlier form',
      description: 'Answered before the parish directory, as free text. Staff match these in Parish review.',
      split: summary.answers.legacyText,
    },
    {
      key: 'not_provided',
      title: 'No parish given',
      description: 'They left the optional parish question blank on the earlier form. Staff can still link a parish from the application.',
      split: summary.answers.notProvided,
    },
  ];

  return (
    <>
      <section aria-labelledby="answers-figures" className="flex flex-col gap-3">
        <SectionHeading id="answers-figures" title="Key figures" />
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={ChurchIcon}
            label="From the directory"
            value={countWithShare(summary.answers.listed, percent(summary.answers.listed, summary.applications))}
            context="The applicant picked their parish from the RCCG list and confirmed its province, region and continent."
          />
          <MetricCard
            icon={LinkIcon}
            label="Linked by staff"
            value={countWithShare(summary.linkedByStaff, percent(summary.linkedByStaff, summary.applications))}
            context="The applicant typed a name or gave none, and staff linked a directory parish."
          />
          <MetricCard
            icon={UnlinkIcon}
            label="No directory parish"
            value={countWithShare(summary.withoutParish, percent(summary.withoutParish, summary.applications))}
            context="Not linked to a parish yet, so not in the regions and parishes report."
          />
          <MetricCard
            icon={ClipboardListIcon}
            label="Waiting in Parish review"
            value={formatCount(waitingTotal)}
            context={`${formatCount(summary.waiting.notListed)} not listed, ${formatCount(summary.waiting.detailsWrong)} with details flagged, ${formatCount(summary.waiting.earlierText)} earlier answers.`}
            extra={
              canReview && waitingTotal !== 0 ? (
                <Link to="/admin/parish-review" className="font-bold text-brand underline underline-offset-4">
                  Open Parish review
                </Link>
              ) : null
            }
          />
        </dl>
      </section>

      <section aria-labelledby="answers-heading" className="flex flex-col gap-3">
        <SectionHeading id="answers-heading" title="Answers that weren't chosen from the directory">
          Each group shows how many staff have linked to a directory parish so far.
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-3">
          {answers.map((answer) => {
            const total = answer.split.linked === null || answer.split.unlinked === null ? null : answer.split.linked + answer.split.unlinked;
            return (
              <ReportCard
                key={answer.key}
                title={answer.title}
                description={answer.description}
                actions={
                  canApplicants && total !== 0 ? (
                    <ActionLink to={applicantsHref(query, { parishStatus: answer.key })} label={`View applications: ${answer.title}`}>
                      View applications
                    </ActionLink>
                  ) : undefined
                }
              >
                <p className="font-sans text-[15px] text-ink">
                  <span className="font-sans text-[28px] leading-none font-bold tabular-nums">{formatCount(total)}</span> {total === 1 ? 'application' : 'applications'}
                </p>
                <CategoryBar
                  label={`${answer.title}: with and without a directory parish`}
                  segments={[
                    { key: 'linked', label: 'Linked by staff', name: `${answer.title}, linked by staff`, value: answer.split.linked, colour: LINKED, href: view({ parishStatus: answer.key, parish: 'any' }) },
                    { key: 'unlinked', label: 'No directory parish', name: `${answer.title}, no directory parish`, value: answer.split.unlinked, colour: UNLINKED, href: view({ parishStatus: answer.key, parish: 'none' }) },
                  ]}
                />
              </ReportCard>
            );
          })}
        </div>
      </section>

      <ReportCard
        headingLevel={2}
        title="Linked parishes outside a region or province"
        description="The RCCG list skips a level when it repeats the one above, so some parishes have no province, and some provinces sit straight under a continent with no region. They're counted, and shown on their own, in the regions and parishes report."
        actions={
          summary.noProvince !== 0 || summary.noRegion !== 0 ? (
            <>
              {summary.noProvince !== 0 && <ActionLink to={`/admin/reports/organisation?${carry({ level: 'parish', without: 'province' })}`}>Parishes with no province</ActionLink>}
              {summary.noRegion !== 0 && <ActionLink to={`/admin/reports/organisation?${carry({ level: 'parish', without: 'region' })}`}>Parishes with no region</ActionLink>}
            </>
          ) : undefined
        }
      >
        <dl className="grid max-w-[560px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 font-sans text-[14px]">
          <dt className="text-muted">Applications whose parish has no province</dt>
          <dd className="text-right font-bold tabular-nums text-ink">{formatCount(summary.noProvince)}</dd>
          <dt className="text-muted">Applications whose parish has no region</dt>
          <dd className="text-right font-bold tabular-nums text-ink">{formatCount(summary.noRegion)}</dd>
        </dl>
      </ReportCard>
    </>
  );
}
