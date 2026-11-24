import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Progress, Screen, TopBar } from '../components/ui';
import { coins, num } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz, openTelegram } from '../telegram';

/** Locked for Member, and says exactly what opens it. Pro and Partner can request a payout. */
export function CashOut() {
  const { me, settings, refresh, botLink } = useHub();
  const { rateKzt, minCoins, method } = settings.cashout;
  const navigate = useNavigate();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const locked = me.level === 'member';
  const configured = Boolean(rateKzt && minCoins);

  const [amount, setAmount] = useState(String(me.balance));
  const [details, setDetails] = useState('');
  const coinsOut = Math.floor(Number(amount)) || 0;

  const [request, requesting] = useAction(async () => {
    await api.post('/api/cashout', { coins: coinsOut, details });
    await Promise.all([refresh(), mutate('/api/wallet')]);
    buzz('success');
    toast('Request sent. The team will confirm the payout in the bot.');
    navigate('/wallet', { replace: true });
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    request();
  };

  // Only terms the team has set: an unset one is left out, never shown as a placeholder.
  const known: Array<[string, string]> = [
    ['Rate', rateKzt ? `1 coin = ${num(rateKzt)} ${settings.currencySign}` : ''],
    ['Minimum', minCoins ? coins(minCoins) : ''],
    ['Paid to', method ?? ''],
  ].filter((term): term is [string, string] => Boolean(term[1]));
  const terms = known.length ? (
    <dl className="rows rows--roomy" style={{ margin: 0 }}>
      {known.map(([label, value]) => (
        <div key={label} className="row">
          <dt>{label}</dt>
          <dd style={{ margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;

  if (locked) {
    return (
      <Screen>
        <TopBar back="/wallet" backLabel="Back to wallet" title="Cash out" />
        <main className="body" style={{ gap: 16 }}>
          <section className="panel panel--dark">
            <h1 className="display" style={{ fontSize: 28, lineHeight: 1.15 }}>
              Cash-out opens at Pro level
            </h1>
            <p className="lede">You are a Member now. Keep your coins: they stay with you when you level up.</p>
          </section>

          <div className="card card--col" style={{ gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700 }}>
              <span>Member</span>
              <span className="muted">Pro</span>
            </div>
            <Progress value={me.progress} large />
            <p className="muted nums" style={{ fontSize: 14, lineHeight: 1.45 }}>
              Rating {me.rating} of {settings.levels.pro}. It grows with your publications, your views and our score for your work.
            </p>
          </div>

          {terms}

          <div className="spacer" />
          <div className="actions actions--gap">
            <Link to="/levels" className="btn">
              How to reach Pro
            </Link>
            <Link to="/shop" className="btn btn--outline">
              Spend coins in the shop
            </Link>
          </div>
        </main>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar back="/wallet" backLabel="Back to wallet" title="Cash out" />
      <form className="body" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <section className="panel panel--dark">
          <div style={{ fontSize: 15, fontWeight: 600 }}>You can cash out</div>
          <h1 className="display nums" style={{ fontSize: 44, lineHeight: 1.05 }}>
            {coins(me.balance)}
          </h1>
          {rateKzt ? (
            <p className="lede nums">
              That is {num(me.balance * rateKzt)} {settings.currencySign} at today's rate.
            </p>
          ) : null}
        </section>

        {terms}

        {configured ? (
          <div className="form">
            <div className="field">
              <label htmlFor="amount">How many coins</label>
              <input
                id="amount"
                className="input nums"
                type="number"
                inputMode="numeric"
                min={minCoins ?? 1}
                max={me.balance}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="payout">Where to send the money</label>
              <input
                id="payout"
                className="input"
                placeholder={method ? `${method}: number or account` : 'Card or account number'}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <p className="note" style={{ fontSize: 14 }}>
            Cash-out is open for your level. The team is setting up the rate and the payout method: write to us and we will
            sort it out with you directly.
          </p>
        )}

        <div className="spacer" />
        <div className="actions actions--gap">
          {configured ? (
            <button
              type="submit"
              className="btn"
              disabled={requesting || !details.trim() || coinsOut < (minCoins ?? 1) || coinsOut > me.balance}
            >
              {rateKzt && coinsOut > 0 ? `Request ${num(coinsOut * rateKzt)} ${settings.currencySign}` : 'Request cash-out'}
            </button>
          ) : (
            botLink && (
              <button type="button" className="btn" onClick={() => openTelegram(botLink)}>
                Write to the team
              </button>
            )
          )}
          <Link to="/shop" className="btn btn--outline">
            Spend coins in the shop
          </Link>
        </div>
      </form>
    </Screen>
  );
}
