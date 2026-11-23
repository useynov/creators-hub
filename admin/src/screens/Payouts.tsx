import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { PayoutList, PayoutStatus } from '../../../server/src/admin/types';
import { api, query } from '../api';
import { useI18n } from '../i18n';
import { Badge, Empty, handle, Head, Loading, Pager, Problem, Table, Tabs, useAction, useSession, type Tone } from '../ui';

const STATUSES: PayoutStatus[] = ['new', 'paid', 'rejected'];
const TONE: Record<PayoutStatus, Tone> = { new: 'warn', paid: 'ok', rejected: 'bad' };

export function Payouts() {
  const { t, f } = useI18n();
  const { me, refresh } = useSession();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();
  const status = STATUSES.find((s) => s === params.get('status')) ?? 'new';
  const page = Number(params.get('page') ?? 1);
  const { data, error, mutate } = useSWR<PayoutList>(`/payouts${query({ status, page })}`);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const cashout = me.settings.cashout;
  const sign = me.settings.currencySign;

  const decide = async (id: number, action: 'paid' | 'reject') => {
    const done = await run(
      () => api.post(`/payouts/${id}/${action}`, action === 'reject' ? { note } : {}),
      action === 'paid' ? t.payouts.markedPaid : t.payouts.markedRejected,
    );
    void mutate();
    if (done !== null) {
      setRejecting(null);
      setNote('');
      refresh();
    }
  };

  return (
    <>
      <Head title={t.payouts.title} sub={t.payouts.sub} />
      <section className="card dark" style={{ padding: '18px 20px', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
        {[
          [t.payouts.rate, cashout.rateKzt ? t.payouts.rateValue(f.money(cashout.rateKzt, sign)) : t.payouts.notSet],
          [t.payouts.min, cashout.minCoins ? t.payouts.minValue(cashout.minCoins) : t.payouts.notSet],
          [t.payouts.method, cashout.method ?? t.payouts.notSet],
        ].map(([label, value]) => (
          <div key={label} className="stack" style={{ gap: 2 }}>
            <span className="tiny soft">{label}</span>
            <span style={{ fontSize: 20, fontWeight: 800 }}>{value}</span>
          </div>
        ))}
        <div className="small soft" style={{ flex: '1 1 240px' }}>
          {t.payouts.settingsNote}
        </div>
      </section>

      <div className="row-gap" style={{ justifyContent: 'space-between' }}>
        <Tabs
          label={t.payouts.title}
          value={status}
          onChange={(key) => setParams({ status: key }, { replace: true })}
          items={STATUSES.map((key) => ({ key, label: data ? `${t.payouts.tabs[key]}, ${data.counts[key]}` : t.payouts.tabs[key] }))}
        />
        {data && !data.canDecide && <span className="small muted">{t.payouts.readOnly}</span>}
      </div>

      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : (
        <Table
          cols="1.6fr 0.8fr 0.8fr 1fr 2fr 0.8fr 1.1fr 1.9fr"
          min={980}
          head={[t.payouts.colCreator, t.payouts.colLevel, t.payouts.colCoins, t.payouts.colAmount, t.payouts.colDetails, t.payouts.colDate, t.payouts.colStatus, '']}
          footer={data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} shown={data.rows.length} onPage={(next) => setParams({ status, page: String(next) })} /> : undefined}
        >
          {data.rows.length ? (
            data.rows.map((row) => (
              <div key={row.id}>
                <div className="trow">
                  <Link to={`/creators/${row.creator.id}`} className="plain strong">
                    {row.creator.name}
                    {row.creator.instagram ? `, ${handle(row.creator.instagram)}` : ''}
                  </Link>
                  <div>{t.levels[row.level]}</div>
                  <div className="strong">{f.num(row.coins)}</div>
                  <div className="strong">{row.amount !== null ? f.money(row.amount, sign) : <span className="muted" style={{ fontWeight: 400 }}>{t.common.rateNotSet}</span>}</div>
                  <div className="small">{row.details}</div>
                  <div>{f.day(row.createdAt)}</div>
                  <div className="stack" style={{ gap: 2 }}>
                    <span>
                      <Badge tone={TONE[row.status]}>{t.payouts.statuses[row.status]}</Badge>
                    </span>
                    {row.note && <span className="tiny muted">{row.note}</span>}
                  </div>
                  <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
                    {data.canDecide && row.status === 'new' && rejecting !== row.id && (
                      <>
                        <button type="button" className="btn btn--green btn--sm" disabled={busy} onClick={() => void decide(row.id, 'paid')}>
                          {t.payouts.paid}
                        </button>
                        <button type="button" className="btn btn--line btn--sm" disabled={busy} onClick={() => setRejecting(row.id)}>
                          {t.payouts.reject}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {rejecting === row.id && (
                  <form
                    className="row-gap"
                    style={{ padding: '0 18px 14px', justifyContent: 'flex-end' }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void decide(row.id, 'reject');
                    }}
                  >
                    <label htmlFor={`note-${row.id}`} className="sr-only">
                      {t.payouts.rejectNote}
                    </label>
                    <input id={`note-${row.id}`} className="input input--sm" style={{ width: 360 }} maxLength={500} placeholder={t.payouts.rejectNote} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRejecting(null)}>
                      {t.common.cancel}
                    </button>
                    <button type="submit" className="btn btn--danger btn--sm" disabled={busy || !note.trim()}>
                      {t.payouts.rejectSend}
                    </button>
                  </form>
                )}
              </div>
            ))
          ) : (
            <Empty>{t.payouts.empty}</Empty>
          )}
        </Table>
      )}
      <div className="small muted">{t.payouts.footer}</div>
    </>
  );
}
