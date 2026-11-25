import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopItemAdmin, ShopItemInput } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { shrinkPhoto } from '../photo';
import { Crumbs, Head, Loading, Problem, useAction, useToast } from '../ui';
import type { ShopData } from './Shop';

interface Form {
  title: string;
  description: string;
  price: string;
  category: 'merch' | 'gift';
  images: string[];
  sizes: string[];
  /** The item's own choice, one option per line (drinks, colours), and the word for it. */
  choices: string;
  choiceLabel: string;
  delivery: 'courier' | 'message';
  stock: string;
  perCreator: string;
  perMonth: string;
  visible: boolean;
}

const EMPTY: Form = { title: '', description: '', price: '', category: 'merch', images: [], sizes: [], choices: '', choiceLabel: '', delivery: 'courier', stock: '', perCreator: '', perMonth: '', visible: false };

const lines = (value: string): string[] => [...new Set(value.split('\n').map((line) => line.trim()).filter(Boolean))];

const fromItem = (item: ShopItemAdmin): Form => ({
  title: item.title,
  description: item.description ?? '',
  price: String(item.price),
  category: item.category,
  images: item.images,
  sizes: item.choices.length ? [] : item.sizes,
  choices: item.choices.join('\n'),
  choiceLabel: item.choiceLabel ?? '',
  delivery: item.delivery,
  stock: item.stock === null ? '' : String(item.stock),
  perCreator: item.perCreator === null ? '' : String(item.perCreator),
  perMonth: item.perMonth === null ? '' : String(item.perMonth),
  visible: item.visible,
});

const count = (value: string): number | null => (value.trim() === '' ? null : Number(value));

const toInput = (form: Form): ShopItemInput => ({
  title: form.title,
  description: form.description || null,
  price: Number(form.price),
  category: form.category,
  images: form.images,
  sizes: form.sizes,
  choices: lines(form.choices),
  choiceLabel: form.choiceLabel.trim() || null,
  delivery: form.delivery,
  stock: count(form.stock),
  perCreator: count(form.perCreator),
  perMonth: count(form.perMonth),
  visible: form.visible,
});

/** Add or change one item of the shop. The right-hand side shows it as the creator will see it. */
export function ShopEdit() {
  const { id } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const { busy, run } = useAction();
  const { data, error, mutate } = useSWR<ShopData>('/shop/items');
  const item = id ? data?.items.find((candidate) => candidate.id === id) : undefined;

  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef<string | null>(null);

  // Fill the form once per item; later refreshes of the list must not wipe what is being typed.
  useEffect(() => {
    if (!data) return;
    const key = id ?? 'new';
    if (loaded.current === key) return;
    if (id && !item) return;
    loaded.current = key;
    const start = item ? fromItem(item) : EMPTY;
    setForm(start);
    setSaved(start);
  }, [data, id, item]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const max = data?.maxPhotos ?? 6;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = max - form.images.length;
    const chosen = [...files].slice(0, Math.max(0, room));
    if (files.length > chosen.length) toast(t.shop.tooMany(max), 'bad');
    for (let index = 0; index < chosen.length; index += 1) {
      setProgress([index + 1, chosen.length]);
      const small = await shrinkPhoto(chosen[index]!);
      const answer = await run(() => api.upload<{ url: string }>('/uploads/cover', small));
      if (answer) setForm((current) => ({ ...current, images: [...current.images, answer.url] }));
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const movePhoto = (index: number, to: number) =>
    setForm((current) => {
      if (to < 0 || to >= current.images.length) return current;
      const images = [...current.images];
      const [photo] = images.splice(index, 1);
      images.splice(to, 0, photo!);
      return { ...current, images };
    });

  const save = async () => {
    const body = toInput(form);
    const answer = await run(() => (id ? api.put<ShopItemAdmin>(`/shop/items/${id}`, body) : api.post<ShopItemAdmin>('/shop/items', body)), id ? t.shop.saved : t.shop.created);
    if (!answer) return;
    const next = fromItem(answer);
    setForm(next);
    setSaved(next);
    void mutate();
    if (!id) {
      loaded.current = answer.id;
      navigate(`/shop/${answer.id}`, { replace: true });
    }
  };

  const send = async () => {
    if (!id || dirty) {
      toast(t.shop.saveFirst, 'bad');
      return;
    }
    await run(() => api.post(`/shop/items/${id}/send`), t.shop.sent);
  };

  const remove = async () => {
    if (!id) return;
    if ((await run(() => api.del(`/shop/items/${id}`), t.shop.removed)) !== null) {
      void mutate();
      navigate('/shop', { replace: true });
    }
  };

  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;
  if (id && !item && loaded.current !== id) return <Problem error={new Error('not_found')} onRetry={() => void mutate()} />;

  const price = Number(form.price) || 0;
  const stock = count(form.stock);
  const soldOut = stock !== null && stock <= 0;
  const free = form.price.trim() !== '' && price === 0;
  const options = lines(form.choices);
  const valid = form.title.trim().length >= 2 && form.price.trim() !== '' && options.length !== 1 && !(options.length && form.sizes.length) && !progress;

  return (
    <>
      <Crumbs items={[{ to: '/shop', label: t.shop.back }, { label: item ? item.title : t.shop.newTitle }]} />
      <Head title={item ? item.title : t.shop.newTitle}>
        {id && (
          <button type="button" className="btn btn--line" disabled={busy} onClick={() => void send()}>
            {t.shop.send}
          </button>
        )}
        <button type="button" className="btn btn--red" disabled={busy || !valid || (Boolean(id) && !dirty)} onClick={() => void save()}>
          {id ? t.shop.save : t.shop.saveNew}
        </button>
      </Head>
      {id && <div className="small muted">{dirty ? t.shop.unsaved : t.shop.sendHint}</div>}

      <div className="cols">
        <div className="stack" style={{ flex: '3 1 520px', minWidth: 0, gap: 16 }}>
          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secPhotos}</h2>
            <div className="photos">
              {form.images.map((src, index) => (
                <figure key={src} className="photo">
                  <img src={src} alt="" />
                  {index === 0 && <span className="photo__cover">{t.shop.cover}</span>}
                  <figcaption className="photo__actions">
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" disabled={index === 0} aria-label={t.shop.left} onClick={() => movePhoto(index, index - 1)}>
                      ←
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" disabled={index === form.images.length - 1} aria-label={t.shop.right} onClick={() => movePhoto(index, index + 1)}>
                      →
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => set('images', form.images.filter((photo) => photo !== src))}>
                      {t.shop.remove}
                    </button>
                    {index > 0 && (
                      <button type="button" className="linkbtn small" onClick={() => movePhoto(index, 0)}>
                        {t.shop.makeCover}
                      </button>
                    )}
                  </figcaption>
                </figure>
              ))}
              {form.images.length < max && (
                <button type="button" className="photo photo--add" disabled={Boolean(progress)} onClick={() => fileInput.current?.click()}>
                  {progress ? t.shop.uploadingN(progress[0], progress[1]) : `+ ${t.shop.addPhotos}`}
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event.target.files)} />
            <span className="field__hint">{t.shop.photosHint(max)}</span>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secAbout}</h2>
            <div className="field">
              <label htmlFor="title">{t.shop.name}</label>
              <input id="title" className="input" maxLength={60} placeholder={t.shop.namePlaceholder} value={form.title} onChange={(e) => set('title', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="description">
                {t.shop.description} <span className="opt">{t.common.optional}</span>
              </label>
              <textarea id="description" className="textarea" rows={5} maxLength={1200} value={form.description} onChange={(e) => set('description', e.target.value)} />
              <span className="field__hint">{t.shop.descriptionHint}</span>
            </div>
            <div className="field">
              <span className="field__label">{t.shop.category}</span>
              <div className="row-gap">
                {(['merch', 'gift'] as const).map((key) => (
                  <button key={key} type="button" className={`filter${form.category === key ? ' filter--on' : ''}`} aria-pressed={form.category === key} onClick={() => set('category', key)}>
                    {t.shop[key]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secPrice}</h2>
            <div className="fields">
              <div className="field">
                <label htmlFor="price">{t.shop.price}</label>
                <input id="price" className="input" inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <span className="field__hint">{t.shop.priceHint}</span>
              </div>
              <div className="field">
                <label htmlFor="stock">
                  {t.shop.stock} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="stock" className="input" inputMode="numeric" placeholder={t.shop.stockPlaceholder} value={form.stock} onChange={(e) => set('stock', e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </div>
              <div className="field">
                <label htmlFor="per">
                  {t.shop.perCreator} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="per" className="input" inputMode="numeric" placeholder={t.shop.perCreatorPlaceholder} value={form.perCreator} onChange={(e) => set('perCreator', e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </div>
              <div className="field">
                <label htmlFor="month">
                  {t.shop.perMonth} <span className="opt">{t.common.optional}</span>
                </label>
                <input id="month" className="input" inputMode="numeric" placeholder={t.shop.perCreatorPlaceholder} value={form.perMonth} onChange={(e) => set('perMonth', e.target.value.replace(/\D/g, '').slice(0, 2))} />
              </div>
            </div>
            <span className="field__hint">{t.shop.stockHint}</span>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secSizes}</h2>
            <div className="row-gap">
              {data.sizes.map((size) => {
                const on = form.sizes.includes(size);
                return (
                  <button
                    key={size}
                    type="button"
                    className={`filter${on ? ' filter--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => set('sizes', on ? form.sizes.filter((entry) => entry !== size) : data.sizes.filter((entry) => entry === size || form.sizes.includes(entry)))}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
            <span className="field__hint">{t.shop.sizesHint}</span>
            <div className="fields" style={{ paddingTop: 6 }}>
              <div className="field">
                <label htmlFor="choices">
                  {t.shop.choices} <span className="opt">{t.common.optional}</span>
                </label>
                <textarea id="choices" className="textarea" rows={4} placeholder={t.shop.choicesPlaceholder} value={form.choices} onChange={(e) => set('choices', e.target.value)} />
              </div>
              {options.length > 0 && (
                <div className="field">
                  <label htmlFor="choiceLabel">{t.shop.choiceLabel}</label>
                  <input id="choiceLabel" className="input" maxLength={20} placeholder={t.shop.choiceLabelPlaceholder} value={form.choiceLabel} onChange={(e) => set('choiceLabel', e.target.value)} />
                </div>
              )}
            </div>
            <span className="field__hint">{options.length && form.sizes.length ? t.shop.choicesOrSizes : t.shop.choicesHint}</span>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secDelivery}</h2>
            <div className="stack" style={{ gap: 8 }}>
              {(['courier', 'message'] as const).map((key) => (
                <label key={key} className={`choice${form.delivery === key ? ' choice--on' : ''}`}>
                  <input type="radio" name="delivery" checked={form.delivery === key} onChange={() => set('delivery', key)} />
                  <span>
                    <strong>{t.shop[key]}</strong> {t.shop[`${key}Hint`]}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card pad stack" style={{ gap: 14 }}>
            <h2 className="h2 h2--big">{t.shop.secVisible}</h2>
            <label className={`choice${form.visible ? ' choice--on' : ''}`}>
              <input type="checkbox" checked={form.visible} onChange={(e) => set('visible', e.target.checked)} />
              <span>{form.visible ? t.shop.visibleOn : t.shop.visibleOff}</span>
            </label>
            {id && item && (
              <div className="stack" style={{ gap: 8, paddingTop: 6 }}>
                {confirmRemove ? (
                  <div className="row-gap">
                    <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void remove()}>
                      {t.shop.removeConfirm}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemove(false)}>
                      {t.common.cancel}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmRemove(true)}>
                    {t.shop.removeItem}
                  </button>
                )}
                <span className="field__hint">{t.shop.removeHint}</span>
              </div>
            )}
          </section>
        </div>

        <aside className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 12 }}>
          <div className="label">{t.shop.preview}</div>
          <div className="card pad stack" style={{ gap: 18 }}>
            <div className="small muted">{t.shop.previewList}</div>
            <div className="pv-card">
              <div className="pv-face pv-face--tall">{form.images[0] ? <img src={form.images[0]} alt="" /> : <span>{form.title || t.shop.previewEmpty}</span>}</div>
              <div className="pv-title">{form.title || t.shop.previewEmpty}</div>
              <div className="pv-price">{free ? t.shop.free : t.shop.coins(price)}</div>
              {soldOut && <div className="small muted">{t.shop.previewSoldOut}</div>}
            </div>
            <div className="small muted">{t.shop.previewPage}</div>
            <div className="pv-page">
              <div className="pv-face">{form.images[0] ? <img src={form.images[0]} alt="" /> : <span>{form.title || t.shop.previewEmpty}</span>}</div>
              {form.images.length > 1 && (
                <div className="pv-strip">
                  {form.images.slice(1).map((src) => (
                    <img key={src} src={src} alt="" />
                  ))}
                </div>
              )}
              <div className="pv-h">{form.title || t.shop.previewEmpty}</div>
              <div className="pv-price">{free ? t.shop.free : t.shop.coins(price)}</div>
              {form.description && <p className="pv-text">{form.description}</p>}
              <dl className="pv-rows">
                {form.sizes.length > 0 && (
                  <div>
                    <dt>{t.shop.secSizes}</dt>
                    <dd>{form.sizes.join(', ')}</dd>
                  </div>
                )}
                {options.length > 1 && (
                  <div>
                    <dt>{form.choiceLabel.trim() || t.shop.choiceLabelPlaceholder}</dt>
                    <dd>{options.join(', ')}</dd>
                  </div>
                )}
                <div>
                  <dt>{t.shop.previewDelivery}</dt>
                  <dd>{form.delivery === 'courier' ? t.shop.previewCourier : t.shop.previewMessage}</dd>
                </div>
                {stock !== null && stock > 0 && (
                  <div>
                    <dt>{t.shop.stock}</dt>
                    <dd>{t.shop.stockLeft(stock)}</dd>
                  </div>
                )}
              </dl>
              <div className={`pv-btn${soldOut ? ' pv-btn--off' : ''}`}>{soldOut ? t.shop.previewSoldOut : free ? t.shop.previewFree : t.shop.previewOrder(price)}</div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
