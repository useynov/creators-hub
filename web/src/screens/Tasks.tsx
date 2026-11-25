import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { OfferView, TaskView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { TaskCard } from '../components/TaskCard';
import { AccountNote, HubHeader, Loading, Problem, Screen, TabBar, keepBrand } from '../components/ui';
import { coins, compact } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';

type Tab = 'mine' | 'open' | 'soon' | 'done';
const TABS: Array<[Tab, string]> = [
  ['mine', 'Mine'],
  ['open', 'Open'],
  ['soon', 'Soon'],
  ['done', 'Done'],
];

const EMPTY: Record<Tab, string> = {
  mine: 'Nothing in progress. Take a task from the Open tab.',
  open: 'No open tasks right now. The bot will message you when one opens.',
  soon: 'Nothing announced yet. New tasks show up here before they open.',
  done: 'Your approved tasks will show up here.',
};

/** The creator's own work first: what the team sent back, then what is waiting for them, then what the team is looking at. */
const MINE_ORDER = ['needs_changes', 'draft_changes', 'draft_approved', 'joined', 'draft_review', 'in_review'];

function split(tasks: TaskView[]): Record<Tab, TaskView[]> {
  const mine = tasks.filter((task) => task.entry && task.entry.status !== 'approved');
  mine.sort((a, b) => MINE_ORDER.indexOf(a.entry!.status) - MINE_ORDER.indexOf(b.entry!.status));
  const done = tasks.filter((task) => task.entry?.status === 'approved');
  done.sort((a, b) => (b.entry!.approvedAt ?? '').localeCompare(a.entry!.approvedAt ?? ''));
  return {
    mine,
    open: tasks.filter((task) => !task.entry && !task.opensAt),
    soon: tasks.filter((task) => !task.entry && task.opensAt).sort((a, b) => a.opensAt!.localeCompare(b.opensAt!)),
    done,
  };
}

const isTab = (value: string | null): value is Tab => TABS.some(([key]) => key === value);

/**
 * Every task of this creator, by where it stands: their own work (Mine), what they can join
 * today (Open), what is announced but not open yet (Soon), and what is approved (Done).
 */
export function Tasks() {
  const { data: tasks, error, mutate } = useSWR<TaskView[]>('/api/tasks');
  const { data: offer } = useSWR<OfferView | null>('/api/offer');
  const { me, settings } = useHub();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const [picked, setPicked] = useState<Tab | null>(isTab(asked) ? asked : null);

  const groups = useMemo(() => split(tasks ?? []), [tasks]);
  // Opens on the creator's own work; with none, on what they can join.
  const tab: Tab = picked ?? (groups.mine.length || !tasks ? 'mine' : groups.open.length ? 'open' : groups.soon.length ? 'soon' : 'mine');

  // A link from Home (?tab=open) picks the tab once; after that the address is clean again.
  useEffect(() => {
    if (asked) setParams({}, { replace: true });
  }, [asked, setParams]);

  return (
    <Screen>
      <HubHeader brandName={settings.brandName} balance={me.balance} />
      <main className="body body--tabs" style={{ paddingTop: 24, gap: 16 }}>
        <h1 className="display t-display">Tasks</h1>
        <AccountNote status={me.accountStatus} note={me.accountNote} confirmTime={settings.accountConfirmTime} />
        <div role="tablist" aria-label="Tasks by status" className="pilltabs">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setPicked(key)}>
              {label}
              {tasks ? ` · ${groups[key].length}` : ''}
            </button>
          ))}
        </div>

        {!tasks ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <div role="tabpanel" className="stack" style={{ gap: 12 }}>
            {tab === 'open' && offer && (
              <Link to="/offer" className="card card--row card--dark" style={{ gap: 12, padding: '16px 20px' }}>
                <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <div className="t-sm muted">Paid offer, only for you</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{keepBrand(offer.campaign)}</div>
                </div>
                <Icon name="right" size={20} />
              </Link>
            )}

            {tab === 'done' ? (
              <Done tasks={groups.done} />
            ) : tab === 'soon' ? (
              groups.soon.map((task) => <SoonCard key={task.id} task={task} onChange={() => void mutate()} />)
            ) : (
              groups[tab].map((task) => <TaskCard key={task.id} task={task} />)
            )}

            {!groups[tab].length && !(tab === 'open' && offer) && <div className="empty">{EMPTY[tab]}</div>}
          </div>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}

/** A task that has not opened: the bot can tell the creator the moment it does. */
function SoonCard({ task, onChange }: { task: TaskView; onChange: () => void }) {
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const [toggle, busy] = useAction(async () => {
    const next = task.reminded ? await api.del<TaskView>(`/api/tasks/${task.id}/remind`) : await api.post<TaskView>(`/api/tasks/${task.id}/remind`);
    await mutate(`/api/tasks/${task.id}`, next, { revalidate: false });
    onChange();
    buzz('success');
    toast(next.reminded ? 'Done. The bot will message you when it opens.' : 'The reminder is off.');
  });
  return (
    <TaskCard task={task}>
      <button type="button" className={`tcard__btn${task.reminded ? ' tcard__btn--on' : ''}`} aria-pressed={task.reminded} disabled={busy} onClick={() => toggle()}>
        {task.reminded && <Icon name="check" size={16} stroke={2.6} />}
        {task.reminded ? 'Reminder is set' : 'Remind me'}
      </button>
    </TaskCard>
  );
}

/** Approved work, newest first, under one line that sums up the month. */
function Done({ tasks }: { tasks: TaskView[] }) {
  if (!tasks.length) return null;
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = tasks.filter((task) => (task.entry!.approvedAt ?? '').startsWith(month));
  const earned = thisMonth.reduce((sum, task) => sum + (task.entry!.reward ?? task.reward), 0);
  return (
    <>
      <p className="nums" style={{ fontSize: 15, padding: '4px 0 2px' }}>
        <span className="muted">This month: </span>
        <strong style={{ color: 'var(--black)' }}>
          {thisMonth.length} {thisMonth.length === 1 ? 'task' : 'tasks'} · {coins(earned)}
        </strong>
      </p>
      <div className="donelist">
        {tasks.map((task) => (
          <Link key={task.id} to={`/tasks/${task.id}`}>
            <span className="donelist__check" aria-hidden="true">
              <Icon name="check" size={16} stroke={2.6} />
            </span>
            <span className="donelist__what">
              <b>{keepBrand(task.title)}</b>
              <span className="nums">Approved{task.entry!.views ? ` · ${compact(task.entry!.views)} views` : ''}</span>
            </span>
            <b className="donelist__coins nums">+{task.entry!.reward ?? task.reward}</b>
          </Link>
        ))}
      </div>
    </>
  );
}
