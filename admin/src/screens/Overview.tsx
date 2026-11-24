import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { Overview as OverviewData, OverviewAlert } from '../../../server/src/admin/types';
import { useI18n } from '../i18n';
import { kindsSummary, taskMeta } from '../labels';
import { Head, Loading, Problem, Stat, Table, useSession } from '../ui';

const DOT: Record<OverviewAlert['kind'], string> = {
  removed: 'var(--red-dark)',
  story_numbers: 'var(--amber)',
  went_private: 'var(--amber)',
  flagged: 'var(--muted)',
};

export function Overview() {
  const { t, f } = useI18n();
  const { me } = useSession();
  const { data, error, mutate } = useSWR<OverviewData>('/overview');
  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const sign = me.settings.currencySign;
  const todo = [
    { count: data.todo.pendingAccounts, label: t.overview.pendingAccounts, hint: t.overview.pendingAccountsHint, to: '/creators?status=pending' },
    { count: data.todo.review, label: t.overview.review, hint: t.overview.reviewHint(data.todo.oldestReviewAt ? f.wait(data.todo.oldestReviewAt) : null), to: '/review' },
    { count: data.todo.newOrders, label: t.overview.newOrders, hint: t.overview.newOrdersHint, to: '/orders' },
    { count: data.todo.payoutRequests, label: t.overview.payouts, hint: t.overview.payoutsHint, to: '/payouts' },
  ];
  const alertText = (alert: OverviewAlert): [string, string] => {
    const who = alert.who.join(', ');
    switch (alert.kind) {
      case 'removed':
        return [t.overview.alertRemoved(alert.count), t.overview.alertRemovedNote(who, alert.task)];
      case 'story_numbers':
        return [t.overview.alertStories(alert.count), t.overview.alertStoriesNote];
      case 'went_private':
        return [t.overview.alertPrivate(alert.count), t.overview.alertPrivateNote(who)];
      case 'flagged':
        return [t.overview.alertFlagged(alert.count), t.overview.alertFlaggedNote(who)];
    }
  };
  const cols = '2.4fr 1fr 0.8fr 0.8fr 0.9fr 1fr';

  return (
    <>
      <Head title={t.overview.title}>
        <span className="badge badge--line" style={{ fontSize: 13, padding: '6px 14px' }}>{f.month(data.month)}</span>
      </Head>

      {data.sampleCreators > 0 && (
        <div className="notice" role="note">
          {t.common.sampleNote(data.sampleCreators)}
        </div>
      )}

      <section className="section">
        <h2 className="label">{t.overview.waiting}</h2>
        <div className="grid" style={{ ['--min' as string]: '220px' }}>
          {todo.map((item) => (
            <Link key={item.label} to={item.to} className={`todo${item.count ? '' : ' todo--calm'}`}>
              <div className="todo__count">{f.num(item.count)}</div>
              <div className="todo__label">{item.label}</div>
              <div className="todo__hint">{item.hint}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="label">{t.overview.month}</h2>
        <div className="card strip">
          <Stat label={t.overview.creators} value={f.num(data.kpi.creators)} note={t.overview.confirmed(data.kpi.confirmed)} />
          <Stat label={t.overview.active} value={f.num(data.kpi.activeThisMonth)} note={t.overview.activeNote} />
          <Stat label={t.overview.publications} value={f.num(data.kpi.publications)} note={kindsSummary(t, f, data.kpi.byKind) || ' '} />
          <Stat label={t.overview.views} value={f.num(data.kpi.views)} note={t.overview.viewsNote} />
          <Stat
            label={t.overview.coins}
            value={f.num(data.kpi.coinsIssued)}
            note={t.overview.costPer1000(data.kpi.costPer1000 !== null ? f.money(data.kpi.costPer1000, sign) : t.common.rateNotSet)}
          />
        </div>
      </section>

      <div className="cols">
        <div style={{ flex: '2 1 520px', minWidth: 0 }}>
          <Table
            cols={cols}
            min={620}
            title={
              <div className="table__title">
                <h2 className="h2">{t.overview.activeTasks}</h2>
                <Link to="/tasks" className="small strong" style={{ textDecoration: 'none' }}>
                  {t.overview.allTasks}
                </Link>
              </div>
            }
            head={[t.overview.task, t.overview.deadline, t.overview.joined, t.overview.sent, t.overview.approved, <div className="num">{t.overview.viewsCol}</div>]}
          >
            {data.tasks.length ? (
              data.tasks.map((task) => (
                <div key={task.id} className="trow">
                  <div className="cell-main">
                    <Link to={`/reports/${task.id}`} className="plain">
                      {task.title}
                    </Link>
                    <span className="tiny muted">{taskMeta(t, task.formats, task.place)}</span>
                  </div>
                  <div>{f.day(task.deadline)}</div>
                  <div>{f.num(task.joined)}</div>
                  <div>{f.num(task.submitted)}</div>
                  <div>{f.num(task.approved)}</div>
                  <div className="num strong">{f.num(task.views)}</div>
                </div>
              ))
            ) : (
              <div className="empty">{t.overview.noTasks}</div>
            )}
          </Table>
        </div>
        <section className="card pad" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <h2 className="h2">{t.overview.attention}</h2>
          {data.alerts.length ? (
            data.alerts.map((alert) => {
              const [title, note] = alertText(alert);
              return (
                <div key={alert.kind} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: DOT[alert.kind] }} />
                  <div className="cell-main">
                    <div style={{ fontWeight: 600 }}>{title}</div>
                    <div className="tiny muted">{note}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="muted">{t.overview.nothing}</div>
          )}
        </section>
      </div>
    </>
  );
}
