import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { OrderList, OrderRowView, OrderStatus } from '../../../server/src/admin/types';
import { api, query } from '../api';
import { useI18n } from '../i18n';
import { Empty, Head, Loading, Pager, Problem, Table, Tabs, useAction, useSession } from '../ui';

const STEPS = ['new', 'packed', 'shipped', 'delivered'] as const;
type Step = (typeof STEPS)[number];
const TABS: OrderStatus[] = [...STEPS, 'cancelled'];

/** The item of an order with its photo, so the person packing sees what to pick. */
function Item({ row }: { row: OrderRowView }) {
  return (
    <div>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {row.imageUrl ? <img src={row.imageUrl} alt="" className="thumb thumb--item" /> : <span className="thumb thumb--item thumb--none" aria-hidden="true" />}
        <span>{row.title}</span>
      </span>
    </div>
  );
}

export function Orders() {
  const { t, f, lang } = useI18n();
  const { refresh } = useSession();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();
  const status = TABS.find((s) => s === params.get('status')) ?? 'new';
  const page = Number(params.get('page') ?? 1);
  const { data, error, mutate } = useSWR<OrderList>(`/orders${query({ status, page })}`);
  // The order being cancelled, and the reason typed for it.
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const advance = async (id: number) => {
    const next = STEPS[STEPS.indexOf(status as Step) + 1] as Exclude<Step, 'new'>;
    const done = await run(() => api.post(`/orders/${id}/advance`, { from: status }), t.orders.moved[next]);
    // A refused step (a colleague was quicker) also refreshes the list.
    void mutate();
    if (done !== null) refresh();
  };

  const cancel = async (id: number) => {
    const done = await run(() => api.post(`/orders/${id}/cancel`, { note }), t.orders.cancelled);
    void mutate();
    if (done !== null) {
      setCancelling(null);
      setNote('');
      refresh();
    }
  };

  const open = status !== 'delivered' && status !== 'cancelled';
  const last = status === 'cancelled' ? t.orders.colWhy : '';

  return (
    <>
      <Head title={t.orders.title} sub={t.orders.sub}>
        <Link className="btn btn--line" to="/shop">
          {t.orders.toShop}
        </Link>
        <a className="btn btn--dark" href={`/api/admin/orders/export${query({ status, lang })}`} download>
          {t.orders.export}
        </a>
      </Head>
      <Tabs
        label={t.orders.title}
        value={status}
        onChange={(key) => setParams({ status: key }, { replace: true })}
        items={TABS.map((key) => ({ key, label: data ? `${t.orders.tabs[key]}, ${data.counts[key]}` : t.orders.tabs[key] }))}
      />
      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : (
        <Table
          cols={`0.5fr 1.4fr 1.6fr 0.6fr 2fr 1.1fr 0.7fr 0.8fr ${open ? '2fr' : status === 'cancelled' ? '1.8fr' : '0.2fr'}`}
          min={1100}
          head={[t.orders.colId, t.orders.colCreator, t.orders.colItem, t.orders.colSize, t.orders.colAddress, t.orders.colPhone, t.orders.colCoins, t.orders.colDate, last]}
          footer={data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} shown={data.rows.length} onPage={(next) => setParams({ status, page: String(next) })} /> : undefined}
        >
          {data.rows.length ? (
            data.rows.map((row) => (
              <div key={row.id}>
                <div className="trow">
                  <div className="muted">{row.id}</div>
                  <Link to={`/creators/${row.creator.id}`} className="plain strong">
                    {row.creator.name}
                  </Link>
                  <Item row={row} />
                  <div>{row.size ?? ''}</div>
                  <div className="small">{row.delivery === 'message' ? t.orders.inTelegram : row.address}</div>
                  <div className="small">{row.phone}</div>
                  <div className="strong">{f.num(row.coins)}</div>
                  <div>{f.day(row.createdAt)}</div>
                  {status === 'cancelled' ? (
                    <div className="small">
                      {row.cancelledBy ? t.orders.cancelledBy[row.cancelledBy] : ''}
                      {row.cancelNote ? `: ${row.cancelNote}` : ''}
                    </div>
                  ) : (
                    <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
                      {open && (
                        <>
                          <button type="button" className="btn btn--line btn--sm" disabled={busy} onClick={() => void advance(row.id)}>
                            {t.orders.actions[status as Exclude<Step, 'delivered'>]}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-expanded={cancelling === row.id}
                            onClick={() => {
                              setCancelling(cancelling === row.id ? null : row.id);
                              setNote('');
                            }}
                          >
                            {t.orders.cancel}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {cancelling === row.id && (
                  <div className="pad cancelbox">
                    <div className="field cancelbox__why">
                      <label htmlFor={`why-${row.id}`}>{t.orders.cancelNote}</label>
                      <input id={`why-${row.id}`} className="input" maxLength={300} placeholder={t.orders.cancelPlaceholder} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                    </div>
                    <div className="row-gap">
                      <button type="button" className="btn btn--danger" disabled={busy || !note.trim()} onClick={() => void cancel(row.id)}>
                        {t.orders.cancelConfirm(row.coins)}
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)}>
                        {t.orders.cancelKeep}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <Empty>{t.orders.empty}</Empty>
          )}
        </Table>
      )}
      <div className="small muted">{t.orders.footer}</div>
    </>
  );
}
