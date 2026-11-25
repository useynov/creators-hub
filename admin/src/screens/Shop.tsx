import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopItemAdmin, ShopItemsList } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Badge, Empty, Head, Loading, Problem, useAction } from '../ui';

export type ShopData = ShopItemsList & { sizes: string[]; defaultSizes: string[]; maxPhotos: number };

/** The shelf: every item with its cover, price and stock, in the order creators see them. */
export function Shop() {
  const { t } = useI18n();
  const { busy, run } = useAction();
  const { data, error, mutate } = useSWR<ShopData>('/shop/items');

  const toggle = async (item: ShopItemAdmin) => {
    await run(() => api.post(`/shop/items/${item.id}/visible`, { visible: !item.visible }), item.visible ? t.shop.hiddenDone : t.shop.shown);
    void mutate();
  };
  const move = async (index: number, by: -1 | 1) => {
    if (!data) return;
    const ids = data.items.map((item) => item.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await run(() => api.post('/shop/order', { ids }));
    void mutate();
  };

  const visible = data?.items.filter((item) => item.visible).length ?? 0;

  return (
    <>
      <Head title={t.shop.title} sub={t.shop.sub}>
        <Link className="btn btn--line" to="/orders">
          {t.shop.toOrders}
        </Link>
        <Link className="btn btn--red" to="/shop/new">
          {t.shop.add}
        </Link>
      </Head>
      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : data.items.length ? (
        <>
          <div className="shopgrid">
            {data.items.map((item, index) => (
              <article key={item.id} className={`card shopcard${item.visible ? '' : ' shopcard--hidden'}`}>
                <Link to={`/shop/${item.id}`} className="shopcard__face" aria-label={`${t.shop.edit}: ${item.title}`}>
                  {item.images[0] ? <img src={item.images[0]} alt="" /> : <span className="shopcard__none">{t.shop.noPhoto}</span>}
                  {item.images.length > 1 && <span className="shopcard__count">{t.shop.photos(item.images.length)}</span>}
                  {!item.visible && (
                    <span className="shopcard__flag">
                      <Badge tone="dark">{t.shop.hidden}</Badge>
                    </span>
                  )}
                </Link>
                <div className="shopcard__body">
                  <Link to={`/shop/${item.id}`} className="plain strong" style={{ fontSize: 16 }}>
                    {item.title}
                  </Link>
                  <div className="strong">{item.price === 0 ? t.shop.free : t.shop.coins(item.price)}</div>
                  <div className="small muted">
                    {item.stock === null ? t.shop.stockAny : t.shop.stockLeft(item.stock)}
                    {' · '}
                    {t.shop.ordered(item.ordered)}
                    {item.waiting ? `, ${t.shop.waiting(item.waiting)}` : ''}
                  </div>
                  <div className="row-gap shopcard__actions">
                    <Link className="btn btn--line btn--sm" to={`/shop/${item.id}`}>
                      {t.shop.edit}
                    </Link>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void toggle(item)}>
                      {item.visible ? t.shop.hide : t.shop.show}
                    </button>
                    {item.visible && (
                      <span className="row-gap" style={{ gap: 4, marginLeft: 'auto' }}>
                        <button type="button" className="btn btn--ghost btn--sm btn--icon" disabled={busy || index === 0} aria-label={`${t.shop.moveUp}: ${item.title}`} onClick={() => void move(index, -1)}>
                          ↑
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm btn--icon" disabled={busy || index >= visible - 1} aria-label={`${t.shop.moveDown}: ${item.title}`} onClick={() => void move(index, 1)}>
                          ↓
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="small muted">{t.shop.orderHint}</div>
        </>
      ) : (
        <section className="card">
          <Empty>{t.shop.empty}</Empty>
        </section>
      )}
    </>
  );
}
