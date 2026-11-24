import { useEffect, useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import useSWR, { SWRConfig } from 'swr';
import type { Bootstrap } from '../../server/src/types';
import { api, ApiError } from './api';
import { Icon } from './components/Icon';
import { Loading, Problem, Screen } from './components/ui';
import { setTimeZone } from './format';
import { HubProvider, ToastProvider } from './hub';
import { Benefits } from './screens/Benefits';
import { CashOut } from './screens/CashOut';
import { Details } from './screens/Details';
import { Event } from './screens/Event';
import { EventPass } from './screens/EventPass';
import { Events } from './screens/Events';
import { Home } from './screens/Home';
import { Leaderboard } from './screens/Leaderboard';
import { Levels } from './screens/Levels';
import { PaidOffer } from './screens/PaidOffer';
import { Profile } from './screens/Profile';
import { Redeem } from './screens/Redeem';
import { ChangeHandle, Setup } from './screens/Setup';
import { StoryViews } from './screens/StoryViews';
import { Shop } from './screens/Shop';
import { Submit } from './screens/Submit';
import { Task } from './screens/Task';
import { Tasks } from './screens/Tasks';
import { Wallet } from './screens/Wallet';
import { start } from './telegram';

/** Shown when the API says this Telegram account is not on the invite list. */
function NotInvited() {
  return (
    <Screen>
      <div className="center">
        <div className="panel__icon">
          <Icon name="lock" size={26} stroke={2.2} />
        </div>
        <h1 className="display" style={{ fontSize: 26 }}>
          Sorry, you are not on the invite list
        </h1>
        <p className="lede">The Creators Hub is open by invitation only.</p>
        <p className="lede muted">
          Were you invited by our team? Check that you opened the bot from the same Telegram account you gave us.
        </p>
      </div>
    </Screen>
  );
}

/** Shown, and nothing else, to someone the age question turned away. */
function AgeRefused() {
  return (
    <Screen>
      <div className="center">
        <div className="panel__icon" style={{ background: 'var(--pink)', color: 'var(--red-dark)' }}>
          <Icon name="lock" size={26} stroke={2.2} />
        </div>
        <h1 className="display" style={{ fontSize: 26 }}>
          The Hub is for adults
        </h1>
        <p className="lede">Our community is open to people aged 18 and over, so we cannot let you in.</p>
        <p className="lede muted">Thank you for your interest. We have not kept your date of birth. All the best!</p>
      </div>
    </Screen>
  );
}

function OutsideTelegram() {
  return (
    <Screen>
      <div className="center">
        <h1 className="display" style={{ fontSize: 26 }}>
          Open the Hub from Telegram
        </h1>
        <p className="lede muted">This app works inside Telegram. Open our bot and press “Open app”.</p>
      </div>
    </Screen>
  );
}

function Shell() {
  const { data, error, mutate } = useSWR<Bootstrap>('/api/bootstrap');
  const { pathname } = useLocation();

  useEffect(() => {
    if (data) setTimeZone(data.settings.timeZone);
  }, [data]);

  const hub = useMemo(
    () =>
      data && {
        ...data,
        refresh: () => mutate(),
        botLink: data.settings.botUsername ? `https://t.me/${data.settings.botUsername}` : null,
      },
    [data, mutate],
  );

  if (error instanceof ApiError && error.code === 'age_refused') return <AgeRefused />;
  if (error instanceof ApiError && error.status === 403) return <NotInvited />;
  if (error instanceof ApiError && error.status === 401) return <OutsideTelegram />;
  if (!hub) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  // First open: benefits, then the setup. A member from before the age question and the
  // profile check (they already have a handle) goes straight to the setup. Nothing else until it is done.
  const onboarding = pathname === '/welcome' || pathname === '/setup';
  if (!hub.me.onboarded && !onboarding) return <Navigate to={hub.me.instagram ? '/setup' : '/welcome'} replace />;

  return (
    <HubProvider value={hub}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/welcome" element={<Benefits />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<Task />} />
        <Route path="/tasks/:id/submit" element={<Submit />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/:id" element={<Redeem />} />
        <Route path="/cashout" element={<CashOut />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:id" element={<Event />} />
        <Route path="/events/:id/pass" element={<EventPass />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/details" element={<Details />} />
        <Route path="/profile/instagram" element={<ChangeHandle />} />
        <Route path="/stories/:id" element={<StoryViews />} />
        <Route path="/levels" element={<Levels />} />
        <Route path="/offer" element={<PaidOffer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HubProvider>
  );
}

export function App() {
  useEffect(start, []);
  return (
    <SWRConfig
      value={{
        fetcher: (path: string) => api.get(path),
        shouldRetryOnError: false,
        revalidateOnFocus: true,
        keepPreviousData: true,
      }}
    >
      <ToastProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </ToastProvider>
    </SWRConfig>
  );
}
