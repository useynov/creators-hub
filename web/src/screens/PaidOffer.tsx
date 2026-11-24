import { Link, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { OfferView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Brief, Cover, Loading, Problem, Screen, TopBar } from '../components/ui';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';

/** Partner level only. A personal paid offer per publication. */
export function PaidOffer() {
  const { me, settings } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data: offer, error, isLoading, mutate: reload } = useSWR<OfferView | null>('/api/offer');

  const [answer, answering] = useAction(async (accept: boolean) => {
    await api.post(`/api/offer/${offer!.id}/${accept ? 'accept' : 'decline'}`);
    await Promise.all([reload(), mutate('/api/home')]);
    if (accept) {
      buzz('success');
      toast('Accepted. Your manager will write to you directly.');
    }
    navigate(accept ? '/' : '/tasks', { replace: true });
  });

  const bar = (
    <TopBar
      back="/tasks"
      backLabel="Back to tasks"
      title="Paid offer"
      light
      right={
        <span className="chip chip--white chip--sm">Partner</span>
      }
    />
  );

  if (!offer) {
    return (
      <Screen tone="dark">
        {bar}
        {isLoading ? (
          <Loading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <main className="body">
            <p className="lede" style={{ padding: '24px 0' }}>
              No open offers right now. When we have a paid campaign for you, the bot will message you.
            </p>
            <div className="spacer" />
            <Link to="/tasks" className="btn">
              Back to tasks
            </Link>
          </main>
        )}
      </Screen>
    );
  }

  return (
    <Screen tone="dark">
      <div className="lead lead--square" style={{ minHeight: 360 }}>
        <Cover src="/brand/offer.webp" alt="" fill eager />
        <TopBar over back="/tasks" backLabel="Back to tasks" title="Paid offer" right={<span className="chip glass">Partner</span>} />
        <div className="lead__body" style={{ gap: 12 }}>
          <div className="label">Paid offer · Only for you, {me.firstName}</div>
          <h1 className="lead__title" style={{ fontSize: 34 }}>
            {offer.campaign}
          </h1>
        </div>
      </div>
      <hr className="thread" />
      <main className="body" style={{ gap: 24, paddingTop: 24 }}>
        <section className="stack" style={{ gap: 8 }}>
          <div className="t-sm muted">We pay per publication</div>
          <div className="display nums" style={{ fontSize: 56 }}>
            {offer.fee} {settings.currencySign}
          </div>
        </section>

        <dl className="rows rows--roomy" style={{ margin: 0 }}>
          <div className="row">
            <dt>What we need</dt>
            <dd style={{ margin: 0 }}>{offer.need}</dd>
          </div>
          <div className="row">
            <dt>Post by</dt>
            <dd style={{ margin: 0 }}>{offer.postBy}</dd>
          </div>
          <div className="row">
            <dt>Review</dt>
            <dd style={{ margin: 0 }}>Draft first, then post</dd>
          </div>
          <div className="row">
            <dt>Answer by</dt>
            <dd style={{ margin: 0 }}>{offer.answerBy}</dd>
          </div>
        </dl>

        {offer.brief && <Brief text={offer.brief} dark />}

        <div className="card card--raised" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px' }}>
          <Icon name="chat" size={22} />
          <p style={{ fontSize: 14, lineHeight: 1.45 }}>
            After you accept, your manager writes to you directly to agree the idea and the details.
          </p>
        </div>

        <div className="dock actions" style={{ background: 'var(--black)' }}>
          <button type="button" className="btn" onClick={() => answer(true)} disabled={answering}>
            Accept the offer
          </button>
          <button type="button" className="textlink textlink--light" onClick={() => answer(false)} disabled={answering}>
            Not this time
          </button>
        </div>
      </main>
    </Screen>
  );
}
