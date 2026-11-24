import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { PublicationKind, PublicationStatus, Report as ReportData, ReportCell, ReportRow, ReportSort, ReportTask } from '../../../server/src/admin/types';
import { query } from '../api';
import { useI18n } from '../i18n';
import { kindsSummary } from '../labels';
import { Badge, Empty, handle, Loading, Out, Pager, Problem, Stat, Table, useSession, type Tone } from '../ui';

const STATUS_TONE: Record<PublicationStatus, Tone> = { tracking: 'mute', final: 'ok', removed: 'bad', unreachable: 'warn' };
const KINDS: PublicationKind[] = ['reel', 'post', 'story', 'tiktok'];

export function Report() {
  const { id } = useParams();
  const { t, f, lang } = useI18n();
  const { me } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: tasks, error: tasksError } = useSWR<ReportTask[]>('/reports');

  const kind = params.get('kind') ?? 'all';
  const status = params.get('status') ?? 'all';
  const sort = (params.get('sort') ?? 'final') as ReportSort;
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Number(params.get('page') ?? 1);
  const filters = { kind, status, sort, dir };
  const { data, error, mutate } = useSWR<ReportData>(id ? `/reports/${id}${query({ ...filters, page, pageSize: 50 })}` : null);

  if (!id) {
    if (tasks?.length) return <Navigate to={`/reports/${tasks[0]!.id}`} replace />;
    if (tasksError) return <Problem error={tasksError} />;
    return tasks ? (
      <>
        <h1 className="h1">{t.report.title}</h1>
        <section className="card">
          <Empty>{t.report.noTasks}</Empty>
        </section>
      </>
    ) : (
      <Loading />
    );
  }
  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  const sign = me.settings.currencySign;
  const totals = data.totals;
  const exportHref = `/api/admin/reports/${data.task.id}/export${query({ kind, status, sort, dir, lang })}`;
  const cell = (row: ReportRow, value: ReportCell, final = false) => {
    if (value.views !== null) return final ? <strong>{f.num(value.views)}</strong> : f.num(value.views);
    if (value.status === 'done' && row.kind === 'post') return <span className="muted">{t.report.notVisible}</span>;
    return '';
  };
  const sourceText = (row: ReportRow) =>
    row.status === 'removed' && row.lastMeasuredAt ? `${t.report.sources[row.source]}, ${t.report.lastMeasured(f.day(row.lastMeasuredAt))}` : t.report.sources[row.source];

  return (
    <>
      <div className="head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="small muted">{t.report.eyebrow}</div>
          <div className="row-gap" style={{ gap: 10 }}>
            <h1 className="h1">{data.task.title}</h1>
            <label htmlFor="other" className="sr-only">
              {t.report.other}
            </label>
            <select id="other" className="filter filter--sm" value="" onChange={(e) => e.target.value && navigate(`/reports/${e.target.value}`)}>
              <option value="">{t.report.other}</option>
              {tasks
                ?.filter((task) => task.id !== data.task.id)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
          </div>
          <div className="small muted">
            {t.report.period(data.task.startsAt ? f.day(data.task.startsAt) : null, f.dayYear(data.task.deadline))}.{data.task.place ? ` ${data.task.place}.` : ''}{' '}
            {data.task.finalAt ? t.report.finalOn(f.day(data.task.finalAt)) : ''}
          </div>
        </div>
        <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
          <a className="btn btn--dark" href={exportHref} download>
            {t.report.excel}
          </a>
          <span className="tiny muted">{t.report.excelNote}</span>
        </div>
      </div>

      <div className="grid" style={{ ['--min' as string]: '170px' }}>
        <Stat label={t.report.totals.publications} value={f.num(totals.publications)} note={kindsSummary(t, f, totals.byKind) || ' '} />
        <Stat label={t.report.totals.creators} value={f.num(totals.creators)} note={t.report.totals.creatorsNote(totals.joined)} />
        <Stat label={t.report.totals.views} value={f.num(totals.views)} note={totals.statedViews ? t.report.totals.viewsNote(f.num(totals.statedViews)) : t.overview.viewsNote} />
        <Stat label={t.report.totals.likes} value={f.num(totals.likesComments)} note={t.report.totals.likesNote} />
        <Stat label={t.report.totals.coins} value={f.num(totals.coinsPaid)} note={t.report.totals.coinsNote(totals.approved)} />
        <Stat
          label={t.report.totals.cost}
          value={totals.costPer1000 !== null ? f.money(totals.costPer1000, sign) : <span className="kpi__value--quiet">—</span>}
          note={totals.costPer1000 !== null ? t.report.totals.costNote : `${t.report.totals.costNote}, ${t.common.rateNotSet}`}
        />
      </div>

      <div className="row-gap">
        <button type="button" className={`filter filter--sm${kind === 'all' ? ' filter--on' : ''}`} aria-pressed={kind === 'all'} onClick={() => set({ kind: null })}>
          {t.report.allFormats}
        </button>
        {KINDS.filter((k) => k !== 'tiktok' || totals.byKind.tiktok).map((k) => (
          <button key={k} type="button" className={`filter filter--sm${kind === k ? ' filter--on' : ''}`} aria-pressed={kind === k} onClick={() => set({ kind: k })}>
            {t.report.formatFilter[k]}
          </button>
        ))}
        <select aria-label={t.report.colStatus} className={`filter filter--sm${status !== 'all' ? ' filter--on' : ''}`} value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="all">{t.report.statusAll}</option>
          {(['tracking', 'final', 'removed', 'unreachable'] as PublicationStatus[]).map((s) => (
            <option key={s} value={s}>
              {t.report.statuses[s]}
            </option>
          ))}
        </select>
        <select
          aria-label={t.report.sort}
          className="filter filter--sm"
          value={sort}
          onChange={(e) => set({ sort: e.target.value, dir: e.target.value === 'creator' ? 'asc' : 'desc' })}
        >
          {(Object.keys(t.report.sorts) as ReportSort[]).map((key) => (
            <option key={key} value={key}>
              {t.report.sort}: {t.report.sorts[key]}
            </option>
          ))}
        </select>
      </div>

      <Table
        cols="1.7fr 0.8fr 0.9fr 0.9fr 0.8fr 0.8fr 1fr 0.7fr 0.7fr 1.3fr 1.1fr"
        min={1080}
        head={[
          t.report.colCreator,
          t.report.colFormat,
          t.report.colDate,
          <div className="num">{t.report.colSubmit}</div>,
          <div className="num">{t.report.colH24}</div>,
          <div className="num">{t.report.colD7}</div>,
          <div className="num">{t.report.colD14}</div>,
          <div className="num">{t.report.colLikes}</div>,
          <div className="num">{t.report.colComments}</div>,
          t.report.colSource,
          t.report.colStatus,
        ]}
        footer={
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            shown={data.rows.length}
            onPage={(next) => set({ page: String(next) })}
            note={t.report.footer(data.rows.length, data.total)}
          />
        }
      >
        {data.rows.length ? (
          data.rows.map((row) => (
            <div key={row.publicationId} className="trow" style={{ gap: 10 }}>
              <div className="cell-main">
                {row.creatorId !== null ? (
                  <Link to={`/creators/${row.creatorId}`} className="plain ellipsis">
                    {row.name}
                    {row.instagram ? `, ${handle(row.instagram)}` : ''}
                  </Link>
                ) : (
                  <span className="ellipsis">
                    {row.name}
                    {row.instagram ? `, ${handle(row.instagram)}` : ''}
                  </span>
                )}
                <Out href={row.url} className="tiny">
                  <span style={{ fontWeight: 400 }}>{t.report.link}</span>
                </Out>
              </div>
              <div>{t.kinds[row.kind]}</div>
              <div>{f.day(row.publishedAt)}</div>
              <div className="num">{cell(row, row.cells.submit)}</div>
              <div className="num">{cell(row, row.cells.h24)}</div>
              <div className="num">{cell(row, row.cells.d7)}</div>
              <div className="num">{cell(row, row.cells.d14, true)}</div>
              <div className="num">{f.num(row.likes)}</div>
              <div className="num">{f.num(row.comments)}</div>
              <div className="small ink2">{sourceText(row)}</div>
              <div>
                <Badge tone={STATUS_TONE[row.status]}>{t.report.statuses[row.status]}</Badge>
              </div>
            </div>
          ))
        ) : (
          <Empty>{t.report.empty}</Empty>
        )}
      </Table>
    </>
  );
}
