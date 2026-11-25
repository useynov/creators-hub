import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TaskView } from '../../../server/src/types';
import { coins, day, dayParts, daysUntil, timeLeft } from '../format';
import { Cover, keepBrand } from './ui';

type ChipTone = 'amber' | 'green' | 'grey';

/** Where the creator's own work on a task stands: the chip, the line under the title, the next step. */
function standing(task: TaskView): { chip: string; tone: ChipTone; note?: string; action?: string; primary?: boolean } | null {
  switch (task.entry?.status) {
    case 'needs_changes':
    case 'draft_changes':
      return { chip: 'Needs a fix', tone: 'amber', action: 'Fix and send again', primary: true };
    case 'in_review':
      return { chip: 'In review', tone: 'grey', note: 'The team is looking at your post.' };
    case 'draft_review':
      return { chip: 'Draft in review', tone: 'grey', note: 'The team is looking at your draft.' };
    case 'draft_approved':
      return { chip: 'Draft approved', tone: 'green', note: 'Post it, then send the link.', action: 'Send the link' };
    case 'joined':
      return { chip: 'You are in', tone: 'green', action: task.reviewMode === 'draft_first' ? 'Send a draft' : 'Send the link' };
    default:
      return null;
  }
}

/** The line that says how much time is left, with the thin bar under it. */
function TimeLine({ task }: { task: TaskView }) {
  if (task.closed) return <span className="tcard__time"><b>Ended</b><span>{day(task.deadline)}</span></span>;
  // A task tied to a day (an event to shoot): count down to the day itself.
  const toDay = task.date ? daysUntil(task.date) : null;
  const left = timeLeft(task.deadline, task.openedAt);
  const words = toDay === null || toDay < 0 ? left.text : toDay === 0 ? 'Today' : toDay === 1 ? 'Tomorrow' : `${toDay} days to go`;
  return (
    <span className="stack" style={{ gap: 6 }}>
      <span className="tcard__time nums">
        <b>{words}</b>
        <span>{task.date && toDay !== null && toDay >= 0 ? `on ${day(task.date)}` : `until ${day(task.deadline)}`}</span>
      </span>
      <span className="tcard__bar" aria-hidden="true">
        <i style={{ width: `${Math.round(left.share * 100)}%` }} />
      </span>
    </span>
  );
}

/** The picture on the left: the cover, or the day when the task is tied to one or has not opened yet. */
function Thumb({ task }: { task: TaskView }) {
  const dated = task.opensAt ?? task.date;
  if (dated) {
    const [number, month] = dayParts(dated);
    return (
      <span className={`tcard__thumb tcard__day${task.opensAt ? ' tcard__day--soon' : ''}`} aria-hidden="true">
        <b>{number}</b>
        <span>{month}</span>
      </span>
    );
  }
  return (
    <span className="tcard__thumb">
      <Cover src={task.coverUrl} alt="" fill />
    </span>
  );
}

/**
 * One task as a card: picture or day on the left, then format or status, the reward, the title,
 * one line, and the time left. `children` is the Soon card's own button.
 */
export function TaskCard({ task, children }: { task: TaskView; children?: ReactNode }) {
  const state = standing(task);
  const soon = Boolean(task.opensAt);
  const comment = state?.tone === 'amber' ? task.entry?.comment : null;

  const body = (
    <>
      <Thumb task={task} />
      <span className="tcard__body">
        <span className="tcard__top">
          {soon ? (
            <span className="tcard__chip tcard__chip--grey nums">Opens {day(task.opensAt!)}</span>
          ) : state ? (
            <span className={`tcard__chip tcard__chip--${state.tone}`}>{state.chip}</span>
          ) : (
            <span className="tcard__format">{task.format ?? 'Any format'}</span>
          )}
          <b className="nums" aria-label={`${coins(task.reward)} reward`}>
            +{task.reward}
          </b>
        </span>
        <span className="tcard__title">{keepBrand(task.title)}</span>
        {comment ? (
          <span className="tcard__fix">
            <b>From the team:</b> {comment}
          </span>
        ) : soon ? (
          <span className="tcard__line">{[task.format, 'details come when it opens'].filter(Boolean).join(' · ')}</span>
        ) : (
          (state?.note ?? task.summary) && <span className="tcard__line">{state?.note ?? task.summary}</span>
        )}
        {!soon && <TimeLine task={task} />}
        {!soon && !task.entry && task.full && <span className="tcard__line">All places are taken.</span>}
        {state?.action && !task.closed && <span className={`tcard__btn${state.primary ? ' tcard__btn--red' : ''}`}>{state.action}</span>}
        {children}
      </span>
    </>
  );

  // A task that has not opened has nothing to open yet: only its own button works.
  if (soon) return <div className="tcard">{body}</div>;
  return (
    <Link to={`/tasks/${task.id}`} className="tcard">
      {body}
    </Link>
  );
}
