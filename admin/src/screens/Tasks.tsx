import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { TaskList, TaskTab } from '../../../server/src/admin/types';
import { query } from '../api';
import { useI18n } from '../i18n';
import { audienceText, formatsText } from '../labels';
import { Badge, Empty, Head, Loading, Pager, Problem, Table, Tabs } from '../ui';

export function Tasks() {
  const { t, f, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (['active', 'draft', 'closed'] as TaskTab[]).find((key) => key === params.get('tab')) ?? 'active';
  const page = Number(params.get('page') ?? 1);
  const { data, error, mutate } = useSWR<TaskList>(`/tasks${query({ tab, page })}`);

  return (
    <>
      <Head title={t.tasks.title}>
        <Link to="/tasks/new" className="btn btn--red">
          {t.tasks.new}
        </Link>
      </Head>

      <Tabs
        label={t.tasks.title}
        value={tab}
        onChange={(key) => setParams({ tab: key }, { replace: true })}
        items={(['active', 'draft', 'closed'] as TaskTab[]).map((key) => ({
          key,
          label: data ? `${t.tasks.tabs[key]}, ${data.counts[key]}` : t.tasks.tabs[key],
        }))}
      />

      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : (
        <Table
          cols="2.2fr 1.5fr 0.8fr 1.2fr 0.8fr 1.5fr 1fr 1.1fr"
          min={1060}
          head={[t.tasks.colTask, t.tasks.colAudience, t.tasks.colReward, t.tasks.colReview, t.tasks.colDeadline, t.tasks.colFunnel, <div className="num">{t.tasks.colViews}</div>, '']}
          footer={data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} shown={data.rows.length} onPage={(next) => setParams({ tab, page: String(next) })} /> : undefined}
        >
          {data.rows.length ? (
            data.rows.map((row) => {
              const pct = row.joined ? Math.round((row.approved / row.joined) * 100) : 0;
              return (
                <div key={row.id} className="trow" style={{ padding: '14px 18px' }}>
                  <div className="cell-main">
                    <span>{row.title}</span>
                    <span className="tiny muted">{formatsText(t, row.formats)}</span>
                  </div>
                  <div className="cell-main" style={{ fontWeight: 400 }}>
                    <span style={{ fontWeight: 400 }}>{audienceText(t, lang, row.audience)}</span>
                    <span className="tiny muted">{t.tasks.reach(row.reach)}</span>
                  </div>
                  <div className="strong">{f.coins(row.reward)}</div>
                  <div>
                    <Badge tone={row.reviewMode === 'draft_first' ? 'warn' : 'mute'}>{row.reviewMode === 'draft_first' ? t.tasks.draftFirst : t.tasks.postFirst}</Badge>
                  </div>
                  <div>{f.day(row.deadline)}</div>
                  <div className="stack" style={{ gap: 5 }}>
                    <span>
                      {f.num(row.joined)}, {f.num(row.submitted)}, {f.num(row.approved)}
                    </span>
                    <div className="bar" role="img" aria-label={`${pct}%`}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="num strong">{f.num(row.views)}</div>
                  <div className="row-gap" style={{ justifyContent: 'flex-end', gap: 12 }}>
                    {row.status !== 'draft' && (
                      <Link to={`/reports/${row.id}`} className="strong" style={{ textDecoration: 'none' }}>
                        {t.tasks.report}
                      </Link>
                    )}
                    <Link to={`/tasks/${row.id}`} className="strong plain">
                      {t.tasks.edit}
                    </Link>
                  </div>
                </div>
              );
            })
          ) : (
            <Empty>{t.tasks.empty[tab]}</Empty>
          )}
        </Table>
      )}

      <div className="small muted">{t.tasks.footer}</div>
    </>
  );
}
