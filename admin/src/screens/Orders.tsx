import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { OrderList, OrderStatus } from '../../../server/src/admin/types';
import { api, query } from '../api';
import { useI18n } from '../i18n';
import { Empty, Head, Loading, Pager, Problem, Table, Tabs, useAction, useSession } from '../ui';

const STEPS: OrderStatus[] = ['new', 'packed', 'shipped', 'delivered'];

export function Orders() {
  const { t, f, lang } = useI18n();
  const { refresh } = useSession();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();
  const status = STEPS.find((s) => s === params.get('status')) ?? 'new';
  const page = Number(params.get('page') ?? 1);
  const { data, error, mutate } = useSWR<OrderList>(`/orders${query({ status, page })}`);

  const advance = async (id: number) => {
    const next = STEPS[STEPS.indexOf(status) + 1] as Exclude<OrderStatus, 'new'>;
    const done = await run(() => api.post(`/orders/${id}/advance`, { from: status }), t.orders.moved[next]);
    // A refused step (a colleague was quicker) also refreshes the list.
    void mutate();
    if (done !== null) refresh();
  };

  return (
    <>
      <Head title={t.orders.title} sub={t.orders.sub}>
        <a className="btn btn--dark" href={`/api/admin/orders/export${query({ status, lang })}`} download>
          {t.orders.export}
        </a>
      </Head>
      <Tabs
        label={t.orders.title}
        value={status}
        onChange={(key) => setParams({ status: key }, { replace: true })}
        items={STEPS.map((key) => ({ key, label: data ? `${t.orders.tabs[key]}, ${data.counts[key]}` : t.orders.tabs[key] }))}
      />
      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : (
        <Table
          cols={`0.5fr 1.5fr 1.3fr 0.6fr 2.2fr 1.2fr 0.8fr 0.8fr ${status === 'delivered' ? '0.2fr' : '1.5fr'}`}
          min={1040}
          head={[t.orders.colId, t.orders.colCreator, t.orders.colItem, t.orders.colSize, t.orders.colAddress, t.orders.colPhone, t.orders.colCoins, t.orders.colDate, '']}
          footer={data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} shown={data.rows.length} onPage={(next) => setParams({ status, page: String(next) })} /> : undefined}
        >
          {data.rows.length ? (
            data.rows.map((row) => (
              <div key={row.id} className="trow">
                <div className="muted">{row.id}</div>
                <Link to={`/creators/${row.creator.id}`} className="plain strong">
                  {row.creator.name}
                </Link>
                <div>{row.title}</div>
                <div>{row.size ?? ''}</div>
                <div className="small">{row.address}</div>
                <div className="small">{row.phone}</div>
                <div className="strong">{f.num(row.coins)}</div>
                <div>{f.day(row.createdAt)}</div>
                <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
                  {status !== 'delivered' && (
                    <button type="button" className="btn btn--line btn--sm" disabled={busy} onClick={() => void advance(row.id)}>
                      {t.orders.actions[status as Exclude<OrderStatus, 'delivered'>]}
                    </button>
                  )}
                </div>
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
