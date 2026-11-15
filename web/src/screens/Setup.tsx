import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../../../server/src/types';
import { api } from '../api';
import { Screen } from '../components/ui';
import { useAction, useHub } from '../hub';
import { buzz } from '../telegram';

const OTHER = 'Another city';

/** Two things only: social handle and city. Everything else waits until it is needed. */
export function Setup() {
  const { me, settings, refresh } = useHub();
  const navigate = useNavigate();
  const [instagram, setInstagram] = useState(me.instagram ? `@${me.instagram}` : '');
  const [tiktok, setTiktok] = useState(me.tiktok ? `@${me.tiktok}` : '');
  const known = me.city && settings.cities.includes(me.city);
  const [city, setCity] = useState(me.city ? (known ? me.city : OTHER) : (settings.cities[0] ?? OTHER));
  const [otherCity, setOtherCity] = useState(known ? '' : (me.city ?? ''));

  const [save, saving] = useAction(async () => {
    await api.post<Me>('/api/me/setup', { instagram, tiktok, city: city === OTHER ? otherCity : city });
    await refresh();
    buzz('success');
    navigate('/', { replace: true });
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  return (
    <Screen>
      <form className="body" style={{ gap: 24, padding: '40px 20px 24px' }} onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="display" style={{ fontSize: 32 }}>
            Two things and you are in
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.4 }}>
            We use your handle to count the views on your posts.
          </p>
        </div>

        <div className="form">
          <div className="field" style={{ fontSize: 14 }}>
            <label htmlFor="ig" style={{ fontSize: 14 }}>
              Instagram handle
            </label>
            <input
              id="ig"
              className="input input--lg"
              placeholder="@yourhandle"
              autoCapitalize="none"
              autoCorrect="off"
              value={instagram}
              onChange={(event) => setInstagram(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tt" style={{ fontSize: 14 }}>
              TikTok handle <small>(if you have one)</small>
            </label>
            <input
              id="tt"
              className="input input--lg"
              placeholder="@yourhandle"
              autoCapitalize="none"
              autoCorrect="off"
              value={tiktok}
              onChange={(event) => setTiktok(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="city" style={{ fontSize: 14 }}>
              City
            </label>
            <select id="city" className="input input--lg" value={city} onChange={(event) => setCity(event.target.value)}>
              {settings.cities.map((name) => (
                <option key={name}>{name}</option>
              ))}
              <option>{OTHER}</option>
            </select>
            {city === OTHER && (
              <input
                className="input input--lg"
                aria-label="Your city"
                placeholder="Your city"
                  value={otherCity}
                onChange={(event) => setOtherCity(event.target.value)}
              />
            )}
          </div>
        </div>

        <div className="card muted" style={{ borderRadius: 16, padding: '14px 16px', fontSize: 14, lineHeight: 1.45 }}>
          <strong style={{ color: 'var(--ink)' }}>That is all for now.</strong> Clothing size, delivery address and payout
          details can wait. You can add them later in your profile.
        </div>

        <div className="spacer" />
        <div className="actions actions--gap">
          <button type="submit" className="btn" disabled={saving}>
            Enter the Hub
          </button>
          <div className="muted" style={{ fontSize: 13 }}>
            Step 2 of 2
          </div>
        </div>
      </form>
    </Screen>
  );
}
