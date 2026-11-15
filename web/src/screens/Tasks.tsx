import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { OfferView, TaskView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TabBar } from '../components/ui';
import { coins, day } from '../format';

type Tab = 'new' | 'progress' | 'done';

const EMPTY: Record<Tab, string> = {
  new: 'No new tasks right now. The bot will message you when one opens.',
  progress: 'Nothing in progress. Take a task from the New tab.',
  done: 'Your approved tasks will show up here.',
};

/** The line under a card: how the task is reviewed, or where the creator's work stands. */
function footer(task: TaskView): { icon: ReactNode; text: string; color?: string; bold?: boolean } {
  const amber = { color: 'var(--amber)', bold: true };
  switch (task.entry?.status) {
    case 'approved':
      return { icon: <Icon name="check" size={16} />, text: `Approved · +${coins(task.entry.reward ?? task.reward)}`, color: 'var(--green)', bold: true };
    case 'in_review':
      return { icon: <Icon name="clock" size={16} />, text: 'In review' };
    case 'draft_review':
      return { icon: <Icon name="clock" size={16} />, text: 'Draft in review' };
    case 'needs_changes':
    case 'draft_changes':
      return { icon: <Icon name="alert" size={16} />, text: 'Needs changes', ...amber };
    case 'draft_approved':
      return { icon: <Icon name="check" size={16} />, text: 'Draft approved: post it and send the link', color: 'var(--green)', bold: true };
    case 'joined':
      return task.reviewMode === 'draft_first'
        ? { icon: <Icon name="eye" size={16} />, text: 'You are in: send a draft first', ...amber }
        : { icon: <Icon name="check" size={16} />, text: 'You are in: post and send the link' };
  }
  if (task.reviewMode === 'draft_first') return { icon: <Icon name="eye" size={16} />, text: 'Send a draft first, then post', ...amber };
  if (task.viewsBonus) return { icon: <Icon name="trophy" size={16} />, text: 'Bonus for the most views' };
  return { icon: <Icon name="check" size={16} />, text: 'Post first, we check after' };
}

function TaskCard({ task }: { task: TaskView }) {
  const line = footer(task);
  return (
    <Link to={`/tasks/${task.id}`} className="card card--col" style={{ gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{task.title}</div>
        <span className="chip chip--pink nums" style={{ padding: '6px 10px' }}>
          +{coins(task.reward)}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {[task.format, `until ${day(task.deadline)}`].filter(Boolean).join(' · ')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: line.bold ? 700 : 600, color: line.color ?? 'var(--ink-2)' }}>
        {line.icon}
        <span>{line.text}</span>
      </div>
    </Link>
  );
}

/** Every task open to this creator, split by where their work stands. */
export function Tasks() {
  const { data: tasks, error, mutate } = useSWR<TaskView[]>('/api/tasks');
  const { data: offer } = useSWR<OfferView | null>('/api/offer');
  const [tab, setTab] = useState<Tab>('new');

  const groups: Record<Tab, TaskView[]> = {
    new: tasks?.filter((task) => !task.entry) ?? [],
    progress: tasks?.filter((task) => task.entry && task.entry.status !== 'approved') ?? [],
    done: tasks?.filter((task) => task.entry?.status === 'approved') ?? [],
  };
  const tabs: Array<[Tab, string]> = [
    ['new', 'New'],
    ['progress', 'In progress'],
    ['done', 'Done'],
  ];

  return (
    <Screen>
      <main className="body body--tabs" style={{ paddingTop: 28 }}>
        <h1 className="display" style={{ fontSize: 32 }}>
          Tasks
        </h1>
        <div role="tablist" aria-label="Task status" className="segmented" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
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
            {tab === 'new' && offer && (
              <Link to="/offer" className="card card--col card--dark" style={{ gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Paid offer, only for you
                  </div>
                  <span className="chip chip--white chip--sm" style={{ fontWeight: 800 }}>
                    Partner
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{offer.campaign}</div>
              </Link>
            )}
            {groups[tab].map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
            {!groups[tab].length && !(tab === 'new' && offer) && <div className="empty">{EMPTY[tab]}</div>}
          </div>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}
