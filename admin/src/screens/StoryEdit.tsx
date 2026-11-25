import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { StoriesList, StoryAdmin, StoryInput, StoryTarget } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { shrinkPhoto } from '../photo';
import { Crumbs, Head, Loading, Problem, useAction, useToast } from '../ui';

interface Form {
  label: string;
  kicker: string;
  headline: string;
  body: string;
  imageUrl: string | null;
  tone: 'dark' | 'red';
  buttonLabel: string;
  buttonPath: string;
  endsOn: string;
}

const EMPTY: Form = { label: '', kicker: '', headline: '', body: '', imageUrl: null, tone: 'dark', buttonLabel: '', buttonPath: '', endsOn: '' };

const fromStory = (story: StoryAdmin): Form => ({
  label: story.label,
  kicker: story.kicker ?? '',
  headline: story.headline,
  body: story.body ?? '',
  imageUrl: story.imageUrl,
  tone: story.tone,
  buttonLabel: story.buttonLabel ?? '',
  buttonPath: story.buttonPath ?? '',
  endsOn: story.endsOn ?? '',
});

const toInput = (form: Form): StoryInput => ({
  label: form.label,
  kicker: form.kicker || null,
  headline: form.headline,
  body: form.body || null,
  imageUrl: form.imageUrl,
  tone: form.tone,
  buttonLabel: form.buttonPath ? form.buttonLabel || null : null,
  buttonPath: form.buttonPath || null,
  endsOn: form.endsOn || null,
});

const GROUPS: Array<StoryTarget['group']> = ['screen', 'task', 'event', 'shop'];

/** Write or change one story. The right-hand side shows it as the creator will see it. */
export function StoryEdit() {
  const { id } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const { busy, run } = useAction();
  const { data, error, mutate } = useSWR<StoriesList>('/stories');
  const story = id ? data?.stories.find((candidate) => String(candidate.id) === id) : undefined;

  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef<string | null>(null);

  // Fill the form once per story; later refreshes of the list must not wipe what is being typed.
  useEffect(() => {
    if (!data) return;
    const key = id ?? 'new';
    if (loaded.current === key) return;
    if (id && !story) return;
    loaded.current = key;
    const start = story ? fromStory(story) : EMPTY;
    setForm(start);
    setSaved(start);
  }, [data, id, story]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    const small = await shrinkPhoto(file);
    const answer = await run(() => api.upload<{ url: string }>('/uploads/cover', small));
    if (answer) set('imageUrl', answer.url);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const keep = (answer: StoryAdmin) => {
    const next = fromStory(answer);
    setForm(next);
    setSaved(next);
    void mutate();
  };

  /** Saves what is typed. A new story can go straight up. Returns the story's id when it worked. */
  const save = async (publish = false): Promise<number | null> => {
    const body = toInput(form);
    const answer = await run(
      () => (id ? api.put<StoryAdmin>(`/stories/${id}`, body) : api.post<StoryAdmin>('/stories', { ...body, publish })),
      id ? t.stories.saved : publish ? t.stories.wentUp : t.stories.created,
    );
    if (!answer) return null;
    keep(answer);
    if (!id) {
      loaded.current = String(answer.id);
      navigate(`/stories/${answer.id}`, { replace: true });
    }
    return answer.id;
  };

  const setLive = async (live: boolean) => {
    if (!id) return;
    if (dirty && (await save()) === null) return;
    const answer = await run(() => api.post<StoryAdmin>(`/stories/${id}/live`, { live }), live ? t.stories.wentUp : t.stories.wentDown);
    if (answer) keep(answer);
  };

  const send = async () => {
    if (!id || dirty) {
      toast(t.stories.saveFirst, 'bad');
      return;
    }
    await run(() => api.post(`/stories/${id}/send`), t.stories.sent);
  };

  const remove = async () => {
    if (!id) return;
    if ((await run(() => api.del(`/stories/${id}`), t.stories.removed)) !== null) {
      void mutate();
      navigate('/stories', { replace: true });
    }
  };

  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;
  if (id && !story && loaded.current !== id) return <Problem error={new Error('not_found')} onRetry={() => void mutate()} />;

  const valid = form.label.trim().length >= 2 && form.headline.trim().length >= 3 && !uploading && (!form.buttonPath || form.buttonLabel.trim().length > 0);
  const state = story?.state ?? 'draft';
  // A story written a while ago may point at a task or an event that has since closed.
  const known = data.targets.some((target) => target.path === form.buttonPath);

  return (
    <>
      <Crumbs items={[{ to: '/stories', label: t.stories.back }, { label: story ? story.label : t.stories.newTitle }]} />
      <Head title={story ? story.headline : t.stories.newTitle}>
        {id && (
          <button type="button" className="btn btn--line" disabled={busy} onClick={() => void send()}>
            {t.stories.send}
          </button>
        )}
        {id ? (
          <>
            <button type="button" className="btn btn--line" disabled={busy || !valid || !dirty} onClick={() => void save()}>
              {t.stories.save}
            </button>
            {state === 'live' ? (
              <button type="button" className="btn btn--line" disabled={busy} onClick={() => void setLive(false)}>
                {t.stories.takeDown}
              </button>
            ) : (
              <button type="button" className="btn btn--red" disabled={busy || !valid} onClick={() => void setLive(true)}>
                {t.stories.putUp}
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="btn btn--line" disabled={busy || !valid} onClick={() => void save(false)}>
              {t.stories.saveDraft}
            </button>
            <button type="button" className="btn btn--red" disabled={busy || !valid} onClick={() => void save(true)}>
              {t.stories.savePutUp}
            </button>
          </>
        )}
      </Head>
      <div className="small muted">{!valid ? t.stories.required : id ? (dirty ? t.stories.unsaved : t.stories.sendHint) : t.stories.stateLine.draft}</div>

      <div className="cols">
        <div className="stack" style={{ flex: '3 1 520px', minWidth: 0, gap: 16 }}>
          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.stories.secPhoto}</h2>
            <div className="row-gap" style={{ alignItems: 'flex-start', gap: 16 }}>
              {form.imageUrl && <img className="storyphoto" src={form.imageUrl} alt="" />}
              <div className="stack" style={{ gap: 8, alignItems: 'flex-start' }}>
                <button type="button" className="btn btn--line" disabled={uploading || busy} onClick={() => fileInput.current?.click()}>
                  {uploading ? t.stories.uploading : form.imageUrl ? t.stories.replace : t.stories.upload}
                </button>
                {form.imageUrl && (
                  <button type="button" className="linkbtn small" onClick={() => set('imageUrl', null)}>
                    {t.stories.removePhoto}
                  </button>
                )}
              </div>
            </div>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void upload(event.target.files)} />
            <span className="field__hint">{t.stories.photoHint}</span>
            {!form.imageUrl && (
              <div className="field">
                <span className="field__label">{t.stories.tone}</span>
                <div className="row-gap">
                  {(['dark', 'red'] as const).map((key) => (
                    <button key={key} type="button" className={`filter${form.tone === key ? ' filter--on' : ''}`} aria-pressed={form.tone === key} onClick={() => set('tone', key)}>
                      {key === 'dark' ? t.stories.toneDark : t.stories.toneRed}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.stories.secWords}</h2>
            <div className="field">
              <label htmlFor="label">{t.stories.label}</label>
              <input id="label" className="input" maxLength={14} value={form.label} onChange={(e) => set('label', e.target.value)} />
              <span className="field__hint">{t.stories.labelHint}</span>
            </div>
            <div className="field">
              <label htmlFor="kicker">
                {t.stories.kicker} <span className="opt">{t.common.optional}</span>
              </label>
              <input id="kicker" className="input" maxLength={48} placeholder={t.stories.kickerPlaceholder} value={form.kicker} onChange={(e) => set('kicker', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="headline">{t.stories.headline}</label>
              <input id="headline" className="input" maxLength={70} value={form.headline} onChange={(e) => set('headline', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="body">
                {t.stories.body} <span className="opt">{t.common.optional}</span>
              </label>
              <textarea id="body" className="textarea" rows={3} maxLength={220} value={form.body} onChange={(e) => set('body', e.target.value)} />
              <span className="field__hint">{t.stories.bodyHint}</span>
            </div>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.stories.secButton}</h2>
            <div className="fields">
              <div className="field">
                <label htmlFor="path">{t.stories.buttonPath}</label>
                <select id="path" className="input" value={form.buttonPath} onChange={(e) => set('buttonPath', e.target.value)}>
                  <option value="">{t.stories.noButton}</option>
                  {form.buttonPath && !known && <option value={form.buttonPath}>{`${form.buttonPath} (${t.stories.gone})`}</option>}
                  {GROUPS.map((group) => {
                    const options = data.targets.filter((target) => target.group === group);
                    return options.length ? (
                      <optgroup key={group} label={t.stories.groups[group]}>
                        {options.map((target) => (
                          <option key={target.path} value={target.path}>
                            {target.title}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </div>
              {form.buttonPath && (
                <div className="field">
                  <label htmlFor="buttonLabel">{t.stories.buttonLabel}</label>
                  <input id="buttonLabel" className="input" maxLength={28} placeholder={t.stories.buttonLabelPlaceholder} value={form.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} />
                </div>
              )}
            </div>
            <span className="field__hint">{t.stories.buttonHint}</span>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.stories.secUntil}</h2>
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="endsOn">
                {t.stories.endsOn} <span className="opt">{t.common.optional}</span>
              </label>
              <input id="endsOn" type="date" className="input" min={data.today} value={form.endsOn} onChange={(e) => set('endsOn', e.target.value)} />
            </div>
            <span className="field__hint">{t.stories.endsHint}</span>
          </section>

          {id && story && (
            <section className="card pad stack" style={{ gap: 12 }}>
              <h2 className="h2 h2--big">{t.stories.secState}</h2>
              <div>{t.stories.stateLine[state]}</div>
              <div className="small muted">{t.stories.seenBy(story.seenBy)}</div>
              {confirmRemove ? (
                <div className="row-gap">
                  <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void remove()}>
                    {t.stories.removeConfirm}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemove(false)}>
                    {t.common.cancel}
                  </button>
                </div>
              ) : (
                <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmRemove(true)}>
                  {t.stories.remove}
                </button>
              )}
            </section>
          )}
        </div>

        <aside className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 12 }}>
          <div className="label">{t.stories.preview}</div>
          <div className="card pad stack" style={{ gap: 18 }}>
            <div className="small muted">{t.stories.previewCircle}</div>
            <div className="pv-dot">
              <span className={`pv-dot__face pv-dot__face--${form.tone}`}>{form.imageUrl ? <img src={form.imageUrl} alt="" /> : <b>{form.label.trim().charAt(0)}</b>}</span>
              <span>{form.label || '…'}</span>
            </div>
            <div className="small muted">{t.stories.previewFull}</div>
            <div className={`pv-story pv-story--${form.tone}`}>
              {form.imageUrl && <img src={form.imageUrl} alt="" />}
              <div className="pv-story__words">
                {form.kicker && <span className="pv-story__kicker">{form.kicker}</span>}
                <b>{form.headline || t.stories.previewHeadline}</b>
                {form.body && <p>{form.body}</p>}
                {form.buttonPath && <span className="pv-story__btn">{form.buttonLabel || '…'}</span>}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
