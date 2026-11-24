import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import useSWR, { SWRConfig } from 'swr';
import type { AdminMe, TeamRole } from '../../server/src/admin/types';
import { api, ApiError } from './api';
import { I18nProvider, setTimeZone, useI18n } from './i18n';
import { Creator } from './screens/Creator';
import { Creators } from './screens/Creators';
import { Invite } from './screens/Invite';
import { Login } from './screens/Login';
import { Orders } from './screens/Orders';
import { Overview } from './screens/Overview';
import { Payouts } from './screens/Payouts';
import { Report } from './screens/Report';
import { Review } from './screens/Review';
import { TaskEdit } from './screens/TaskEdit';
import { Tasks } from './screens/Tasks';
import { Team } from './screens/Team';
import { BrandLogo, LangSwitch, Loading, Problem, SessionProvider, ToastProvider, useAction, useSession } from './ui';

const STAFF: TeamRole[] = ['owner', 'manager'];

/** The first screen of each role. The Viewer sees reports only. */
const homeOf = (role: TeamRole): string => (role === 'viewer' ? '/reports' : '/');

function Sidebar() {
  const { t } = useI18n();
  const { me } = useSession();
  const { run } = useAction();
  const c = me.counters;
  const items: Array<{ to: string; label: string; badge?: number; roles: TeamRole[] }> = [
    { to: '/', label: t.nav.overview, roles: STAFF },
    { to: '/creators', label: t.nav.creators, badge: c?.pendingAccounts, roles: STAFF },
    { to: '/tasks', label: t.nav.tasks, roles: STAFF },
    { to: '/review', label: t.nav.review, badge: c?.review, roles: STAFF },
    { to: '/reports', label: t.nav.reports, roles: ['owner', 'manager', 'viewer'] },
    { to: '/orders', label: t.nav.orders, badge: c?.newOrders, roles: STAFF },
    { to: '/payouts', label: t.nav.payouts, badge: c?.payoutRequests, roles: STAFF },
    { to: '/team', label: t.nav.team, roles: ['owner'] },
  ];
  const logout = async () => {
    if ((await run(() => api.post('/auth/logout'))) !== null) window.location.replace('/admin/login');
  };
  return (
    <aside className="side">
      <div className="side__inner">
      <div className="brand brand--logo">
        <BrandLogo tone="white" height={30} />
        <div>
          <div className="brand__name">{t.brand.name}</div>
          <div className="brand__place">{t.brand.place}</div>
        </div>
      </div>
      <nav aria-label={t.nav.label} className="nav">
        {items
          .filter((item) => item.roles.includes(me.role))
          .map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <span>{item.label}</span>
              {item.badge ? <span className="nav__badge">{item.badge}</span> : null}
            </NavLink>
          ))}
      </nav>
      <div className="side__foot">
        <LangSwitch />
        <div>
          <div className="who__name">{me.name}</div>
          <div className="who__role">{t.roles[me.role]}</div>
        </div>
        <button type="button" className="logout" onClick={() => void logout()}>
          {t.nav.logout}
        </button>
      </div>
      </div>
    </aside>
  );
}

/** Hides a screen the role cannot use. Only a convenience: the server checks every request. */
function Only({ roles, children }: { roles: TeamRole[]; children: ReactNode }) {
  const { me } = useSession();
  return roles.includes(me.role) ? <>{children}</> : <Navigate to={homeOf(me.role)} replace />;
}

function Shell() {
  const { data: me, error, mutate } = useSWR<AdminMe>('/me', { refreshInterval: 60_000 });
  const { pathname } = useLocation();

  useEffect(() => {
    if (me) setTimeZone(me.settings.timeZone);
  }, [me]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (!me) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  return (
    <SessionProvider value={{ me, refresh: () => void mutate() }}>
      <div className="shell">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Only roles={STAFF}><Overview /></Only>} />
            <Route path="/creators" element={<Only roles={STAFF}><Creators /></Only>} />
            <Route path="/creators/:id" element={<Only roles={STAFF}><Creator /></Only>} />
            <Route path="/invite" element={<Only roles={STAFF}><Invite /></Only>} />
            <Route path="/tasks" element={<Only roles={STAFF}><Tasks /></Only>} />
            <Route path="/tasks/new" element={<Only roles={STAFF}><TaskEdit /></Only>} />
            <Route path="/tasks/:id" element={<Only roles={STAFF}><TaskEdit /></Only>} />
            <Route path="/review" element={<Only roles={STAFF}><Review /></Only>} />
            <Route path="/reports" element={<Report />} />
            <Route path="/reports/:id" element={<Report />} />
            <Route path="/orders" element={<Only roles={STAFF}><Orders /></Only>} />
            <Route path="/payouts" element={<Only roles={STAFF}><Payouts /></Only>} />
            <Route path="/team" element={<Only roles={['owner']}><Team /></Only>} />
            <Route path="*" element={<Navigate to={homeOf(me.role)} replace />} />
          </Routes>
        </main>
      </div>
    </SessionProvider>
  );
}

export function App() {
  return (
    <I18nProvider>
      <SWRConfig value={{ fetcher: (path: string) => api.get(path), shouldRetryOnError: false, revalidateOnFocus: true, keepPreviousData: true }}>
        <ToastProvider>
          <BrowserRouter basename="/admin">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="*" element={<Shell />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </SWRConfig>
    </I18nProvider>
  );
}
