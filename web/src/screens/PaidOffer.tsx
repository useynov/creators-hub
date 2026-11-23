import { Link, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { OfferView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Brief, Loading, Problem, Screen, TopBar } from '../components/ui';
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
        <span className="chip chip--white chip--sm" style={{ fontWeight: 800, padding: '6px 12px', borderRadius: 12 }}>
          Partner
        </span>
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
            <p className="lede" style={{ color: 'var(--white)', padding: '24px 4px' }}>
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
      {bar}
      <main className="body" style={{ gap: 16 }}>
        <div className="stack" style={{ color: 'var(--white)', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Only for you, {me.firstName}
          </div>
          <h1 className="display" style={{ fontSize: 32 }}>
            {offer.campaign}
          </h1>
        </div>

        <section className="panel panel--red" style={{ padding: 20, gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>We pay per publication</div>
          <div className="display nums" style={{ fontSize: 44, lineHeight: 1.05 }}>
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

        <div className="spacer" />
        <div className="actions">
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
