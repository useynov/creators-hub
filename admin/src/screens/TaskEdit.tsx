import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type {
  AudienceCount,
  AudienceInput,
  CreatorPick,
  Level,
  Options,
  PublicationKind,
  ReviewMode,
  TaskAction,
  TaskDetail,
  TaskInput,
  TaskSaved,
} from '../../../server/src/admin/types';
import { api, query } from '../api';
import { useI18n } from '../i18n';
import { Badge, Crumbs, Loading, Problem, useAction, useSession, useToast } from '../ui';

const FORMATS: PublicationKind[] = ['reel', 'post', 'story', 'tiktok'];
const LEVELS: Level[] = ['member', 'pro', 'partner'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The editor keeps numbers as typed text, so a field can be empty while someone types. */
interface Form {
  title: string;
  summary: string;
  brief: string;
  steps: string;
  place: string;
  date: string;
  coverUrl: string | null;
  coverTouched: boolean;
  formats: PublicationKind[];
  requiredMention: string;
  requiredHashtag: string;
  reviewMode: ReviewMode;
  reward: string;
  maxPublications: string;
  bonusCoins: string;
  maxParticipants: string;
  startsAt: string;
  deadline: string;
  mode: AudienceInput['mode'];
  cities: string[];
  followersMin: string;
  followersMax: string;
  levels: Level[];
  tags: string[];
  picked: CreatorPick[];
}

/** Wall-clock time in the hub's zone, some days ahead, at 23:59: the usual deadline. */
function wallClockIn(days: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));
  return `${parts}T23:59`;
}

function fromDetail(task: TaskDetail): Form {
  const a = task.audience;
  return {
    title: task.title,
    summary: task.summary ?? '',
    brief: task.brief ?? '',
    steps: task.steps.join('\n'),
    place: task.place ?? '',
    date: task.date ?? '',
    coverUrl: task.coverUrl,
    coverTouched: false,
    formats: task.formats,
    requiredMention: task.requiredMention ? `@${task.requiredMention}` : '',
    requiredHashtag: task.requiredHashtag ? `#${task.requiredHashtag}` : '',
    reviewMode: task.reviewMode,
    reward: String(task.reward),
    maxPublications: String(task.maxPublications),
    bonusCoins: task.bonusCoins === null ? '' : String(task.bonusCoins),
    maxParticipants: task.maxParticipants === null ? '' : String(task.maxParticipants),
    startsAt: task.startsAt ?? '',
    deadline: task.deadline,
    mode: a.mode,
    cities: a.cities ?? [],
    followersMin: a.followersMin == null ? '' : String(a.followersMin),
    followersMax: a.followersMax == null ? '' : String(a.followersMax),
    levels: a.levels ?? [],
    tags: a.tags ?? [],
    picked: task.picked,
  };
}

function blank(timeZone: string): Form {
  return {
    title: '',
    summary: '',
    brief: '',
    steps: '',
    place: '',
    date: '',
    coverUrl: null,
    coverTouched: false,
    formats: ['reel', 'post', 'story'],
    requiredMention: '',
    requiredHashtag: '',
    reviewMode: 'post_first',
    reward: '5',
    maxPublications: '1',
    bonusCoins: '',
    maxParticipants: '',
    startsAt: '',
    deadline: wallClockIn(7, timeZone),
    mode: 'all',
    cities: [],
    followersMin: '',
    followersMax: '',
    levels: [],
    tags: [],
    picked: [],
  };
}

const whole = (value: string): number | null => (value.trim() === '' || !/^\d+$/.test(value.trim()) ? null : Number(value.trim()));

function audienceOf(form: Form): AudienceInput {
  if (form.mode === 'all') return { mode: 'all' };
  if (form.mode === 'list') return { mode: 'list', userIds: form.picked.map((p) => p.id) };
  return { mode: 'segment', cities: form.cities, followersMin: whole(form.followersMin), followersMax: whole(form.followersMax), levels: form.levels, tags: form.tags };
}

function toInput(form: Form): TaskInput & { coverUrl?: string | null } {
  const input: TaskInput = {
    title: form.title,
    summary: form.summary || null,
    brief: form.brief || null,
    steps: form.steps.split('\n').map((s) => s.trim()).filter(Boolean),
    place: form.place || null,
    date: form.date || null,
    coverUrl: form.coverUrl,
    formats: form.formats,
    requiredMention: form.requiredMention || null,
    requiredHashtag: form.requiredHashtag || null,
    reviewMode: form.reviewMode,
    reward: whole(form.reward) ?? 0,
    maxPublications: whole(form.maxPublications) ?? 1,
    bonusCoins: whole(form.bonusCoins),
    maxParticipants: whole(form.maxParticipants),
    startsAt: form.startsAt || null,
    deadline: form.deadline,
    audience: audienceOf(form),
  };
  // An untouched cover is left out, so a cover the editor cannot show (from the content file) stays.
  if (!form.coverTouched) {
    const { coverUrl: _keep, ...rest } = input;
    return rest as TaskInput;
  }
  return input;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card pad pad--20">
      <h2 className="h2 h2--big">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={`filter${on ? ' filter--on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

function CreatorPicker({ picked, onChange }: { picked: CreatorPick[]; onChange: (next: CreatorPick[]) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const { data } = useSWR<CreatorPick[]>(`/creators/pick${query({ q: q.trim() })}`);
  const chosen = new Set(picked.map((p) => p.id));
  return (
    <div className="stack stack--tight">
      <label htmlFor="pick" className="field__label">
        {t.editor.pickSearch}
      </label>
      <input id="pick" className="input" type="search" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row-gap" style={{ gap: 6 }}>
        {(data ?? [])
          .filter((p) => !chosen.has(p.id))
          .slice(0, 10)
          .map((p) => (
            <button key={p.id} type="button" className="tag-add" onClick={() => onChange([...picked, p])}>
              + {p.name}
              {p.instagram ? ` @${p.instagram}` : ''}
            </button>
          ))}
      </div>
      <div className="small strong">{picked.length ? t.editor.picked(picked.length) : t.editor.pickedNone}</div>
      <div className="row-gap" style={{ gap: 6 }}>
        {picked.map((p) => (
          <span key={p.id} className="tag">
            {p.name}
            {p.instagram ? ` @${p.instagram}` : ''}
            <button type="button" aria-label={`${t.common.remove}: ${p.name}`} onClick={() => onChange(picked.filter((x) => x.id !== p.id))}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Editor({ task }: { task: TaskDetail | null }) {
  const { t, f } = useI18n();
  const { me, refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [form, setForm] = useState<Form>(() => (task ? fromDetail(task) : blank(me.settings.timeZone)));
  const [uploading, setUploading] = useState(false);
  const [count, setCount] = useState<AudienceCount | null>(null);
  const { data: options } = useSWR<Options>('/options');
  const fileInput = useRef<HTMLInputElement>(null);
  const { mutate } = useSWRConfig();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  // "N creators will see this", a moment after the last change.
  const countKey = JSON.stringify([audienceOf(form), form.reward, form.maxPublications, form.maxParticipants, form.bonusCoins]);
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .post<AudienceCount>('/tasks/audience', {
          audience: audienceOf(form),
          reward: whole(form.reward),
          maxPublications: whole(form.maxPublications),
          maxParticipants: whole(form.maxParticipants),
          bonusCoins: whole(form.bonusCoins),
        })
        .then(setCount)
        .catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [countKey]);

  const upload = async (file: File) => {
    setUploading(true);
    const saved = await run(() => api.upload<{ url: string }>('/uploads/cover', file));
    setUploading(false);
    if (saved) setForm((current) => ({ ...current, coverUrl: saved.url, coverTouched: true }));
  };

  const save = async (action: TaskAction) => {
    if (!form.title.trim() || !form.deadline) {
      toast(t.editor.required, 'bad');
      return;
    }
    const body = { action, task: toInput(form) };
    const saved = await run(() => (task ? api.put<TaskSaved>(`/tasks/${task.id}`, body) : api.post<TaskSaved>('/tasks', body)));
    if (!saved) return;
    if (action === 'save') toast(saved.task.status === 'draft' ? t.editor.savedDraft : t.common.saved);
    else if (action === 'publish') toast(t.editor.published);
    else toast(saved.announced === null ? t.editor.alreadyAnnounced : t.editor.announced(saved.announced));
    refresh();
    if (!task) navigate(`/tasks/${saved.task.id}`, { replace: true });
    else {
      void mutate(`/tasks/${task.id}`, saved.task, { revalidate: false });
      setForm(fromDetail(saved.task));
    }
    return saved;
  };

  const close = async () => {
    if (!task || !window.confirm(t.editor.closeConfirm)) return;
    const next = await run(() => api.post<TaskDetail>(`/tasks/${task.id}/close`), t.editor.closedDone);
    if (next) navigate('/tasks?tab=closed');
  };

  const status = task?.status ?? 'draft';
  const deadlineLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(form.deadline);
    return m ? `${Number(m[3])} ${EN_MONTHS[Number(m[2]) - 1]}` : '';
  }, [form.deadline]);
  const formatLine = form.formats.length
    ? (() => {
        const words = form.formats.map((k) => ({ reel: 'reel', post: 'post', story: 'story', tiktok: 'TikTok', unknown: 'link' })[k]);
        const line = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
        return line.charAt(0).toUpperCase() + line.slice(1);
      })()
    : 'Any format';
  const sign = me.settings.currencySign;

  return (
    <>
      <Crumbs items={[{ to: '/tasks', label: t.editor.crumbs }, { label: task ? task.title : t.editor.newTitle }]} />
      <div className="head">
        <div className="head__title">
          <h1 className="h1">{task ? task.title : t.editor.newTitle}</h1>
          {task && <Badge tone={status === 'active' ? 'ok' : status === 'closed' ? 'mute' : 'warn'}>{t.editor.statusLine[status]}</Badge>}
        </div>
        <div className="row-gap">
          {status === 'draft' && (
            <>
              <button type="button" className="btn btn--line" disabled={busy} onClick={() => void save('save')}>
                {t.editor.saveDraft}
              </button>
              <button type="button" className="btn btn--line" disabled={busy} onClick={() => void save('publish')}>
                {t.editor.publish}
              </button>
              <button type="button" className="btn btn--red" disabled={busy} onClick={() => void save('announce')}>
                {t.editor.publishAnnounce}
              </button>
            </>
          )}
          {status === 'active' && (
            <>
              <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void close()}>
                {t.editor.close}
              </button>
              {!task?.announcedAt && (
                <button type="button" className="btn btn--line" disabled={busy} onClick={() => void save('announce')}>
                  {t.editor.announce}
                </button>
              )}
              <button type="button" className="btn btn--red" disabled={busy} onClick={() => void save('save')}>
                {t.editor.save}
              </button>
            </>
          )}
          {status === 'closed' && (
            <>
              <button type="button" className="btn btn--line" disabled={busy} onClick={() => void save('save')}>
                {t.editor.save}
              </button>
              <button type="button" className="btn btn--red" disabled={busy} onClick={() => void save('publish')}>
                {t.editor.reopen}
              </button>
            </>
          )}
        </div>
      </div>
      {task?.source === 'seed' && <div className="notice">{t.editor.seedNote}</div>}
      {task?.announcedAt && <div className="small muted">{t.editor.announcedOn(f.dayTime(task.announcedAt))}</div>}

      <div className="cols">
        <form className="col-main stack" style={{ margin: 0 }} onSubmit={(e) => e.preventDefault()}>
          <Section title={t.editor.s1}>
            <div className="field">
              <label htmlFor="title">{t.editor.title}</label>
              <input id="title" className="input" maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="summary">
                {t.editor.summary} <span className="opt">{t.common.optional}</span>
              </label>
              <input id="summary" className="input" maxLength={300} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="steps">{t.editor.steps}</label>
              <textarea id="steps" className="textarea" rows={3} value={form.steps} onChange={(e) => set('steps', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="brief">
                {t.editor.brief} <span className="opt">{t.common.optional}</span>
              </label>
              <textarea id="brief" className="textarea" rows={5} maxLength={6000} value={form.brief} onChange={(e) => set('brief', e.target.value)} />
              <span className="field__hint">{t.editor.briefHint}</span>
            </div>
            <div className="fields">
              <div className="field">
                <label htmlFor="place">
                  {t.editor.place} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="place" className="input" maxLength={120} value={form.place} onChange={(e) => set('place', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="date">
                  {t.editor.date} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="date" type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <span className="field__label">{t.editor.cover}</span>
              {form.coverUrl ? (
                <div className="row-gap" style={{ alignItems: 'flex-end' }}>
                  <img src={form.coverUrl} alt="" className="cover" style={{ width: 240 }} />
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileInput.current?.click()}>
                    {t.editor.replaceCover}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm((c) => ({ ...c, coverUrl: null, coverTouched: true }))}>
                    {t.editor.removeCover}
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="upload" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    {uploading ? t.editor.uploading : t.editor.upload}
                  </button>
                  {task?.remoteCover && !form.coverTouched && <span className="field__hint">{t.editor.remoteCover}</span>}
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = '';
                }}
              />
            </div>
          </Section>

          <Section title={t.editor.s2}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="stack stack--tight">
              <legend className="field__label" style={{ padding: 0, marginBottom: 8 }}>
                {t.editor.formats}
              </legend>
              <div className="toggles">
                {FORMATS.map((kind) => (
                  <Toggle key={kind} on={form.formats.includes(kind)} onClick={() => set('formats', toggle(form.formats, kind))}>
                    {t.kinds[kind]}
                  </Toggle>
                ))}
              </div>
              {!form.formats.length && <span className="field__hint">{t.editor.formatsHint}</span>}
            </fieldset>
            <div className="fields">
              <div className="field">
                <label htmlFor="mention">{t.editor.mention}</label>
                <input id="mention" className="input" maxLength={31} placeholder={t.editor.mentionPlaceholder} value={form.requiredMention} onChange={(e) => set('requiredMention', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="hashtag">{t.editor.hashtag}</label>
                <input id="hashtag" className="input" maxLength={61} placeholder={t.editor.hashtagPlaceholder} value={form.requiredHashtag} onChange={(e) => set('requiredHashtag', e.target.value)} />
              </div>
            </div>
            <div className="small muted">{t.editor.checksNote}</div>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="stack stack--tight">
              <legend className="field__label" style={{ padding: 0, marginBottom: 8 }}>
                {t.editor.reviewWhen}
              </legend>
              {(['post_first', 'draft_first'] as ReviewMode[]).map((mode) => (
                <label key={mode} className={`choice${form.reviewMode === mode ? ' choice--on' : ''}`}>
                  <input type="radio" name="review" checked={form.reviewMode === mode} onChange={() => set('reviewMode', mode)} />
                  <span>
                    <strong>{mode === 'post_first' ? t.editor.postFirstTitle : t.editor.draftFirstTitle}</strong>{' '}
                    {mode === 'post_first' ? t.editor.postFirstText : t.editor.draftFirstText}
                  </span>
                </label>
              ))}
            </fieldset>
          </Section>

          <Section title={t.editor.s3}>
            <div className="grid">
              {(
                [
                  ['reward', t.editor.reward, ''],
                  ['maxPublications', t.editor.maxPublications, ''],
                  ['bonusCoins', t.editor.bonus, t.editor.bonusPlaceholder],
                  ['maxParticipants', t.editor.limit, t.editor.limitPlaceholder],
                ] as const
              ).map(([key, label, placeholder]) => (
                <div key={key} className="field">
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    className="input"
                    inputMode="numeric"
                    type="number"
                    min={key === 'maxPublications' || key === 'maxParticipants' ? 1 : 0}
                    max={key === 'maxPublications' ? 5 : undefined}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor="startsAt">
                  {t.editor.startsAt} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="startsAt" type="datetime-local" className="input" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="deadline">{t.editor.deadline}</label>
                <input id="deadline" type="datetime-local" className="input" required value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
              </div>
            </div>
            <div className="small muted">{t.editor.measureNote(me.settings.metricsHours)}</div>
          </Section>

          <Section title={t.editor.s4}>
            <div className="tabs">
              {(
                [
                  ['all', t.editor.modeAll],
                  ['segment', t.editor.modeSegment],
                  ['list', t.editor.modeList],
                ] as const
              ).map(([mode, label]) => (
                <button key={mode} type="button" className="tab" aria-pressed={form.mode === mode} onClick={() => set('mode', mode)}>
                  {label}
                </button>
              ))}
            </div>
            {form.mode === 'segment' && (
              <>
                <div className="field">
                  <span className="field__label">{t.editor.cities}</span>
                  <div className="toggles">
                    {(options?.cities ?? me.settings.cities).map((city) => (
                      <Toggle key={city} on={form.cities.includes(city)} onClick={() => set('cities', toggle(form.cities, city))}>
                        {t.city(city)}
                      </Toggle>
                    ))}
                  </div>
                </div>
                <div className="fields">
                  <div className="field">
                    <label htmlFor="fmin">{t.editor.followersMin}</label>
                    <input id="fmin" type="number" min={0} className="input" value={form.followersMin} onChange={(e) => set('followersMin', e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="fmax">{t.editor.followersMax}</label>
                    <input id="fmax" type="number" min={0} className="input" value={form.followersMax} onChange={(e) => set('followersMax', e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <span className="field__label">{t.editor.levels}</span>
                  <div className="toggles">
                    {LEVELS.map((level) => (
                      <Toggle key={level} on={form.levels.includes(level)} onClick={() => set('levels', toggle(form.levels, level))}>
                        {t.levels[level]}
                      </Toggle>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field__label">{t.editor.tags}</span>
                  <div className="toggles">
                    {(options?.tags ?? []).map((tag) => (
                      <Toggle key={tag} on={form.tags.includes(tag)} onClick={() => set('tags', toggle(form.tags, tag))}>
                        {tag}
                      </Toggle>
                    ))}
                  </div>
                </div>
                <div className="small muted">{t.editor.segmentNote}</div>
              </>
            )}
            {form.mode === 'list' && <CreatorPicker picked={form.picked} onChange={(next) => set('picked', next)} />}
          </Section>
        </form>

        <div className="col-side stack" style={{ position: 'sticky', top: 28 }}>
          <section className="card pad pad--20 dark" style={{ gap: 10 }}>
            <div className="small soft" style={{ fontWeight: 600 }}>
              {t.editor.willSee}
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{count ? f.creators(count.count) : '…'}</div>
            <div className="small soft">{count ? t.editor.ofTotal(count.total) : ''}</div>
            <div className="rule" />
            <div className="kv">
              <span>{t.editor.budget}</span>
              <span>{count ? f.coins(count.budgetCoins) : '…'}</span>
            </div>
            <div className="kv">
              <span>{t.editor.inMoney}</span>
              <span>{count?.budgetMoney != null ? f.money(count.budgetMoney, sign) : t.common.rateNotSet}</span>
            </div>
          </section>
          <section className="card pad pad--20">
            <h2 className="label">{t.editor.preview}</h2>
            <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} lang="en">
              {form.coverUrl && <img src={form.coverUrl} alt="" className="cover" />}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{form.title || '…'}</div>
                <span className="pill">+{whole(form.reward) ?? 0} coins</span>
              </div>
              <div className="small muted">
                {formatLine}, {t.editor.previewUntil(deadlineLabel)}
              </div>
              <div className="small ink2" style={{ fontWeight: 600 }}>
                {form.reviewMode === 'post_first' ? t.editor.previewPostFirst : t.editor.previewDraftFirst}
              </div>
            </div>
            <div className="small muted">{t.editor.previewNote}</div>
          </section>
        </div>
      </div>
    </>
  );
}

export function TaskEdit() {
  const { id } = useParams();
  const { data, error, mutate } = useSWR<TaskDetail>(id ? `/tasks/${id}` : null, { revalidateOnFocus: false });
  if (!id) return <Editor task={null} />;
  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;
  return <Editor key={`${data.id}`} task={data} />;
}
