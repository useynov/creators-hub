import { useState, type UIEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Cover, Loading, Problem, Progress, Screen, TopBar } from '../components/ui';
import { coins } from '../format';
import { ItemFace, itemState, STATE_COLOR } from './Shop';

/** One item of the shop: its photos, what it is, how it reaches you, and the way to order it. */
export function ShopItem() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  // The team opens a hidden item with ?preview=1 to check it before creators see it.
  const key = params.has('preview') ? `/api/shop?preview=${encodeURIComponent(id)}` : '/api/shop';
  const { data, error, mutate } = useSWR<ShopView>(key);
  const item = data?.items.find((candidate) => candidate.id === id);
  const [shown, setShown] = useState(0);

  if (!data || !item) {
    return (
      <Screen>
        <TopBar back="/shop" backLabel="Back to shop" title="Shop" />
        {error ? <Problem error={error} onRetry={() => void mutate()} /> : data ? <p className="empty">This item is no longer in the shop.</p> : <Loading />}
      </Screen>
    );
  }

  const state = itemState(item);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    setShown(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
  };
  const facts: Array<[string, string]> = [];
  if (item.sizes.length) facts.push(['Sizes', item.sizes.join(', ')]);
  facts.push(['Delivery', item.delivery === 'courier' ? 'By courier to your address, free' : 'We send it to you in Telegram']);
  // A short stock is already said next to the price; the row is for the calmer numbers.
  if (item.left !== null && item.left > 5) facts.push(['In stock', `${item.left} left`]);
  if (item.perCreator !== null) facts.push(['Limit', item.perCreator === 1 ? 'One per creator' : `${item.perCreator} per creator`]);

  return (
    <Screen>
      <div className="gallery">
        <TopBar over back="/shop" backLabel="Back to shop" title={item.title} />
        {item.images.length ? (
          <div className="gallery__track" onScroll={onScroll}>
            {item.images.map((src, index) => (
              <Cover key={src} src={src} alt={`${item.title}, photo ${index + 1} of ${item.images.length}`} eager={index === 0} />
            ))}
          </div>
        ) : (
          <div className="gallery__track">
            <ItemFace item={item} place={data.items.indexOf(item)} big />
          </div>
        )}
        {item.images.length > 1 && (
          <span className="chip chip--sm gallery__count" style={{ color: 'var(--white)' }} aria-hidden="true">
            {shown + 1} / {item.images.length}
          </span>
        )}
      </div>

      <main className="body" style={{ gap: 24, paddingTop: 20 }}>
        {item.blocked === 'hidden' && (
          <div className="hint">
            <Icon name="eye" size={20} />
            <span>Hidden from creators. You see it because you are on the team.</span>
          </div>
        )}

        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display" style={{ fontSize: 34 }}>
            {item.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="nums" style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)' }}>
              {coins(item.price)}
            </span>
            <span className="nums t-sm" style={{ fontWeight: 600, color: STATE_COLOR[state.tone] }}>
              {state.text}
            </span>
          </div>
        </div>

        {item.blocked === 'coins' && (
          <Link to="/tasks" className="stack" style={{ gap: 10, color: 'inherit' }}>
            <Progress value={Math.min(100, Math.round((data.balance / item.price) * 100))} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }} className="t-sm">
              <span className="muted nums">
                You have {data.balance} of {coins(item.price)}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--black)', textDecoration: 'underline', textUnderlineOffset: 3 }}>Earn more</span>
            </div>
          </Link>
        )}

        {item.description && (
          <div className="stack" style={{ gap: 10, fontSize: 16, lineHeight: 1.5, maxWidth: '62ch' }}>
            {item.description
              .split(/\n{2,}/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => (
                <p key={part} style={{ whiteSpace: 'pre-line' }}>
                  {part}
                </p>
              ))}
          </div>
        )}

        <dl className="rows" style={{ margin: 0 }}>
          {facts.map(([label, value]) => (
            <div className="row" key={label}>
              <dt>{label}</dt>
              <dd style={{ margin: 0 }}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="dock actions">
          {item.blocked === null ? (
            <Link to={`/shop/${item.id}/order`} className="btn">
              Order for {coins(item.price)}
            </Link>
          ) : item.blocked === 'coins' ? (
            <Link to="/tasks" className="btn btn--outline">
              See tasks to earn {coins(item.missing)}
            </Link>
          ) : (
            <button type="button" className="btn" disabled>
              {state.text}
            </button>
          )}
          {item.mine > 0 && (
            <Link to="/shop/orders" className="textlink">
              You ordered this. See your orders
            </Link>
          )}
        </div>
      </main>
    </Screen>
  );
}
