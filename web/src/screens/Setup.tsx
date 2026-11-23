import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import type { ConnectView, Me } from '../../../server/src/types';
import { api, ApiError, errorText } from '../api';
import { Icon } from '../components/Icon';
import { Avatar, Screen, TopBar } from '../components/ui';
import { num } from '../format';
import { useHub, useToast } from '../hub';
import { buzz } from '../telegram';

const OTHER = 'Another city';

/** Today in the browser, as YYYY-MM-DD: the latest date the birthday field accepts. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** First open, step 2: date of birth and Instagram handle, then "Is this you?" with the city. */
export function Setup() {
  return <Connect mode="setup" />;
}

/** Profile, My details: connect another Instagram account. The team confirms it again. */
export function ChangeHandle() {
  return <Connect mode="change" />;
}

function Connect({ mode }: { mode: 'setup' | 'change' }) {
  const { me, settings, refresh } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: 'birth' | 'handle' | 'tiktok' | 'city'; text: string } | null>(null);

  const [birthDate, setBirthDate] = useState('');
  const [handle, setHandle] = useState(mode === 'setup' && me.instagram ? `@${me.instagram}` : '');
  const [tiktokOpen, setTiktokOpen] = useState(Boolean(me.tiktok));
  const [tiktok, setTiktok] = useState(me.tiktok ? `@${me.tiktok}` : '');
  const known = me.city && settings.cities.includes(me.city);
  const [city, setCity] = useState(me.city ? (known ? me.city : OTHER) : (settings.cities[0] ?? OTHER));
  const [otherCity, setOtherCity] = useState(known ? '' : (me.city ?? ''));

  // While the provider looks for the profile the app asks again every couple of seconds.
  const { data: view, mutate } = useSWR<ConnectView>('/api/me/connect', {
    refreshInterval: (latest) => (latest?.status === 'searching' ? 1500 : 0),
  });
  useEffect(() => {
    if (view?.handle && !handle) setHandle(`@${view.handle}`);
  }, [view, handle]);

  const status = view?.status ?? 'idle';
  const showForm = editing || status === 'idle';
  const searching = status === 'searching' && !editing;

  /** Runs a server step: field errors under the field, an age refusal ends the flow, the rest as a toast. */
  const run = async (step: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    buzz('tap');
    try {
      await step();
    } catch (error) {
      buzz('error');
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'age_refused') {
        await refresh(); // the shell now shows the refusal and nothing else
        return;
      }
      if (code === 'bad_birth_date') setFieldError({ field: 'birth', text: errorText(error) });
      else if (code === 'bad_handle' && /TikTok/.test(errorText(error))) setFieldError({ field: 'tiktok', text: errorText(error) });
      else if (code === 'bad_handle' || code === 'handle_taken') setFieldError({ field: 'handle', text: errorText(error) });
      else if (code === 'city_required') setFieldError({ field: 'city', text: errorText(error) });
      else toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const find = (again = false) =>
    run(async () => {
      const typed = again && view?.handle ? view.handle : handle;
      const next = await api.post<ConnectView>('/api/me/connect', {
        instagram: typed,
        ...(me.hasBirthDate ? {} : { birthDate }),
      });
      setEditing(false);
      await mutate(next, { revalidate: false });
      if (mode === 'setup' && !me.hasBirthDate) void refresh();
    });

  const confirm = () =>
    run(async () => {
      await api.post<Me>('/api/me/connect/confirm', {
        ...(tiktokOpen ? { tiktok } : {}),
        ...(mode === 'setup' ? { city: city === OTHER ? otherCity : city } : {}),
      });
      await refresh();
      await mutate();
      buzz('success');
      if (mode === 'change') toast('Saved. The team will confirm your account.');
      navigate(mode === 'setup' ? '/' : '/profile', { replace: true });
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void find();
  };

  const top =
    mode === 'change' ? <TopBar back="/profile/details" backLabel="Back to my details" title="Instagram account" /> : null;
  const shell = (children: ReactNode) => (
    <Screen>
      {top}
      {children}
    </Screen>
  );
  const padding = mode === 'setup' ? '40px 20px 24px' : '8px 20px 24px';

  // --- The form: date of birth (first time only) and the handle ---------------------------
  if (showForm || searching || !view) {
    return shell(
      <form className="body" style={{ gap: 22, padding }} onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="display" style={{ fontSize: 32 }}>
            {mode === 'setup' ? 'Almost in' : 'Connect another account'}
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.4 }}>
            {mode === 'setup'
              ? 'We find your Instagram profile to count the views on your posts. We read only what is public.'
              : 'Use the account you post from. The team confirms it again before tasks pay out.'}
          </p>
        </div>

        <div className="form">
          {mode === 'setup' && !me.hasBirthDate && (
            <div className="field">
              <label htmlFor="birth" style={{ fontSize: 14 }}>
                Date of birth <small>({settings.minAge} or older)</small>
              </label>
              <input
                id="birth"
                className={`input input--lg${fieldError?.field === 'birth' ? ' input--bad' : ''}`}
                type="date"
                max={todayIso()}
                min="1900-01-01"
                value={birthDate}
                disabled={searching}
                aria-invalid={fieldError?.field === 'birth'}
                aria-describedby={fieldError?.field === 'birth' ? 'birth-error' : undefined}
                onChange={(event) => setBirthDate(event.target.value)}
              />
              {fieldError?.field === 'birth' && <FieldError id="birth-error">{fieldError.text}</FieldError>}
            </div>
          )}
          <div className="field">
            <label htmlFor="ig" style={{ fontSize: 14 }}>
              Instagram handle
            </label>
            <input
              id="ig"
              className={`input input--lg${fieldError?.field === 'handle' ? ' input--bad' : ''}`}
              placeholder="@yourhandle"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              value={handle}
              disabled={searching}
              aria-invalid={fieldError?.field === 'handle'}
              aria-describedby={fieldError?.field === 'handle' ? 'ig-error' : undefined}
              onChange={(event) => setHandle(event.target.value)}
            />
            {fieldError?.field === 'handle' && <FieldError id="ig-error">{fieldError.text}</FieldError>}
          </div>
        </div>

        {searching ? (
          <div className="card card--row" role="status" style={{ gap: 12, padding: '14px 16px' }}>
            <div className="spinner" style={{ width: 22, height: 22, flexShrink: 0 }} />
            <div style={{ fontSize: 15, lineHeight: 1.4 }}>
              <strong>Looking for @{view?.handle}.</strong> This can take up to a minute.
            </div>
          </div>
        ) : (
          <div className="card muted" style={{ borderRadius: 16, padding: '14px 16px', fontSize: 14, lineHeight: 1.45 }}>
            <strong style={{ color: 'var(--ink)' }}>Your profile must be open.</strong> We never log in to your account and never
            ask for a password.
          </div>
        )}

        <div className="spacer" />
        <div className="actions actions--gap">
          <button
            type="submit"
            className="btn"
            disabled={busy || searching || !handle.trim() || (mode === 'setup' && !me.hasBirthDate && !birthDate)}
          >
            {searching ? 'Looking for your profile' : 'Find my profile'}
          </button>
          {mode === 'setup' && (
            <div className="muted" style={{ fontSize: 13 }}>
              Step 2 of 2
            </div>
          )}
        </div>
      </form>,
    );
  }

  const handleRow = (state: 'ok' | 'warn', icon: ReactNode) => (
    <div className="field">
      <label htmlFor="ig-found" style={{ fontSize: 14 }}>
        Instagram handle
      </label>
      <div className="field-state">
        <input id="ig-found" className={`input input--lg input--${state}`} value={`@${view.handle}`} readOnly style={{ fontWeight: 600, paddingRight: 48 }} />
        <span className="field-state__icon">{icon}</span>
      </div>
    </div>
  );

  // --- Found: is this you? ---------------------------------------------------------------
  if (status === 'found' && view.profile) {
    const profile = view.profile;
    return shell(
      <div className="body" style={{ gap: 18, padding }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="display" style={{ fontSize: 32 }}>
            Is this you?
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.4 }}>
            We found your profile. Check it before you go on.
          </p>
        </div>

        {handleRow('ok', <Icon name="check" size={22} stroke={3} color="var(--green)" />)}

        <section className="card card--col" style={{ borderRadius: 24, padding: 20, gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar src={profile.avatarUrl} name={profile.fullName ?? profile.handle} size={72} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{profile.fullName ?? profile.handle}</div>
              <div className="muted" style={{ fontSize: 15 }}>
                @{profile.handle}
              </div>
            </div>
          </div>
          <div className="grid3 nums">
            {profile.followers !== null && (
              <div className="tile">
                <b>{num(profile.followers)}</b>
                <span>Followers</span>
              </div>
            )}
            {profile.postsCount !== null && (
              <div className="tile">
                <b>{num(profile.postsCount)}</b>
                <span>Posts</span>
              </div>
            )}
            <div className="tile">
              <b>Open</b>
              <span>Profile</span>
            </div>
          </div>
          {mode === 'setup' &&
            (tiktokOpen ? (
              <div className="field">
                <label htmlFor="tt" style={{ fontSize: 14 }}>
                  TikTok handle <small>(if you have one)</small>
                </label>
                <input
                  id="tt"
                  className={`input${fieldError?.field === 'tiktok' ? ' input--bad' : ''}`}
                  placeholder="@yourhandle"
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={80}
                  value={tiktok}
                  aria-invalid={fieldError?.field === 'tiktok'}
                  onChange={(event) => setTiktok(event.target.value)}
                />
                {fieldError?.field === 'tiktok' && <FieldError id="tt-error">{fieldError.text}</FieldError>}
              </div>
            ) : (
              <button type="button" className="dashed" onClick={() => setTiktokOpen(true)}>
                + Add TikTok (if you have one)
              </button>
            ))}
        </section>

        {mode === 'setup' && (
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
                className={`input input--lg${fieldError?.field === 'city' ? ' input--bad' : ''}`}
                aria-label="Your city"
                placeholder="Your city"
                maxLength={80}
                value={otherCity}
                onChange={(event) => setOtherCity(event.target.value)}
              />
            )}
            {fieldError?.field === 'city' && <FieldError id="city-error">{fieldError.text}</FieldError>}
          </div>
        )}

        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          Our team confirms every new account{settings.accountConfirmTime ? `, usually within ${settings.accountConfirmTime}` : ''}. We read
          only what is public on your profile.
        </p>

        <div className="spacer" />
        <div className="actions">
          <button type="button" className="btn" onClick={() => void confirm()} disabled={busy}>
            Yes, this is me
          </button>
          <button type="button" className="textlink" onClick={() => setEditing(true)}>
            Not me, change the handle
          </button>
        </div>
      </div>,
    );
  }

  // --- Private, not found, provider trouble -----------------------------------------------
  const lock = <Icon name="lock" size={22} stroke={2.2} color="var(--amber)" />;
  const panels = {
    private: {
      icon: 'lock' as const,
      title: 'Your profile is private',
      text: 'The Hub works with open profiles only. We need to see your posts to count their views.',
      how: ['Open Instagram, go to Settings.', 'Tap Account privacy.', 'Switch off Private account.', 'Come back here and check again.'],
    },
    not_found: {
      icon: 'alert' as const,
      title: 'We could not find this profile',
      text: 'Instagram has no account with this handle, or it was just renamed.',
      how: ['Open your Instagram profile.', 'Copy the handle under your name.', 'Paste it here, without spaces.'],
    },
    error: {
      icon: 'refresh' as const,
      title: 'Instagram did not answer',
      text: 'This is on our side, not yours. Please try again in a minute.',
      how: [],
    },
  };
  const panel = panels[status === 'private' || status === 'not_found' ? status : 'error'];
  return shell(
    <div className="body" style={{ gap: 20, padding }}>
      {handleRow('warn', lock)}
      <section className="panel panel--amber">
        <div className="panel__icon">
          <Icon name={panel.icon} size={26} stroke={2.2} />
        </div>
        <h1 className="display" style={{ fontSize: 28, lineHeight: 1.15 }}>
          {panel.title}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.45 }}>{panel.text}</p>
      </section>
      {panel.how.length > 0 && (
        <div className="card card--col" style={{ gap: 12, padding: '18px 16px' }}>
          <h2 className="eyebrow">{status === 'private' ? 'How to open it' : 'How to find your handle'}</h2>
          <ol className="stack" style={{ paddingLeft: 22, gap: 6, fontSize: 15, lineHeight: 1.4 }}>
            {panel.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}
      {status === 'private' && (
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          Handle not found at all? Check the spelling, without spaces.
        </p>
      )}
      <div className="spacer" />
      <div className="actions">
        <button type="button" className="btn" onClick={() => void find(true)} disabled={busy}>
          {status === 'error' ? 'Try again' : 'Check again'}
        </button>
        <button type="button" className="textlink" onClick={() => setEditing(true)}>
          Use another account
        </button>
      </div>
    </div>,
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--red-darker)', fontSize: 14, lineHeight: 1.4 }}>
      <Icon name="alert" size={18} />
      <span>{children}</span>
    </div>
  );
}
