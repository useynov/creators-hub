import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { CreatorList, CreatorSort, Options } from '../../../server/src/admin/types';
import { query } from '../api';
import { useI18n } from '../i18n';
import { accountTone, Avatar, Badge, Empty, handle, Head, Loading, Pager, Problem, SortHead, Table } from '../ui';

const BANDS: Record<string, [number | null, number | null]> = {
  lt1: [null, 999],
  '1to3': [1000, 3000],
  '3to10': [3000, 10000],
  gt10: [10000, null],
};

export function Creators() {
  const { t, f } = useI18n();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const get = (key: string) => params.get(key) ?? '';
  const band = get('band');
  const sort = (get('sort') || 'status') as CreatorSort;
  const dir = (get('dir') || 'asc') as 'asc' | 'desc';
  const page = Number(get('page') || 1);

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) set({ q: search.trim() || null });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [min, max] = BANDS[band] ?? [null, null];
  const { data, error, mutate } = useSWR<CreatorList>(
    `/creators${query({ q: get('q'), status: get('status'), city: get('city'), level: get('level'), tag: get('tag'), followersMin: min, followersMax: max, sort, dir, page })}`,
  );
  const { data: options } = useSWR<Options>('/options');

  const onSort = (key: CreatorSort) => set({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : key === 'name' || key === 'city' || key === 'status' ? 'asc' : 'desc' });
  const filtered = Boolean(get('q') || get('status') || get('city') || get('level') || get('tag') || band);
  const cols = '2.2fr 1fr 1.1fr 0.7fr 0.9fr 0.9fr 0.7fr 1.3fr 1.2fr';
  const head = (label: string, key: CreatorSort, right = false) => (
    <SortHead label={label} sortKey={key} sort={sort} dir={dir} onSort={onSort} align={right ? 'right' : undefined} />
  );

  return (
    <>
      <Head title={t.creators.title} sub={data ? t.creators.summary(data.inHub, data.pending) : undefined}>
        <Link to="/invite" className="btn btn--red">
          {t.creators.invite}
        </Link>
      </Head>

      <div className="row-gap">
        <label htmlFor="q" className="sr-only">
          {t.creators.search}
        </label>
        <input
          id="q"
          type="search"
          className="input input--sm"
          style={{ flex: '1 1 220px', width: 'auto' }}
          placeholder={t.creators.searchPlaceholder}
          value={search}
          maxLength={60}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className={`filter${get('status') === 'pending' ? ' filter--on' : ''}`}
          aria-pressed={get('status') === 'pending'}
          onClick={() => set({ status: get('status') === 'pending' ? null : 'pending' })}
        >
          {t.creators.pendingFilter(data?.pending ?? 0)}
        </button>
        <select aria-label={t.creators.status} className={`filter${get('status') && get('status') !== 'pending' ? ' filter--on' : ''}`} value={get('status') === 'pending' ? '' : get('status')} onChange={(e) => set({ status: e.target.value || null })}>
          <option value="">{t.creators.statusAll}</option>
          <option value="confirmed">{t.account.confirmed}</option>
          <option value="rejected">{t.account.rejected}</option>
          <option value="private">{t.account.private}</option>
        </select>
        <select aria-label={t.creators.city} className={`filter${get('city') ? ' filter--on' : ''}`} value={get('city')} onChange={(e) => set({ city: e.target.value || null })}>
          <option value="">{t.creators.cityAll}</option>
          {options?.cities.map((city) => (
            <option key={city} value={city}>
              {t.city(city)}
            </option>
          ))}
        </select>
        <select aria-label={t.creators.followers} className={`filter${band ? ' filter--on' : ''}`} value={band} onChange={(e) => set({ band: e.target.value || null })}>
          <option value="">{t.creators.followersAny}</option>
          {Object.entries(t.creators.followerBands).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label={t.creators.level} className={`filter${get('level') ? ' filter--on' : ''}`} value={get('level')} onChange={(e) => set({ level: e.target.value || null })}>
          <option value="">{t.creators.levelAll}</option>
          {(['member', 'pro', 'partner'] as const).map((level) => (
            <option key={level} value={level}>
              {t.levels[level]}
            </option>
          ))}
        </select>
        <select aria-label={t.creators.tag} className={`filter${get('tag') ? ' filter--on' : ''}`} value={get('tag')} onChange={(e) => set({ tag: e.target.value || null })}>
          <option value="">{t.creators.tagAll}</option>
          {options?.tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="linkbtn small"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            {t.creators.reset}
          </button>
        )}
      </div>

      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : (
        <Table
          cols={cols}
          min={1040}
          head={[
            head(t.creators.colCreator, 'name'),
            head(t.creators.colFollowers, 'followers', true),
            head(t.creators.colAvgViews, 'avgViews', true),
            head(t.creators.colEr, 'er', true),
            head(t.creators.colCity, 'city'),
            head(t.creators.colLevel, 'level'),
            head(t.creators.colRating, 'rating', true),
            t.creators.colTags,
            head(t.creators.colStatus, 'status'),
          ]}
          footer={
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              shown={data.rows.length}
              onPage={(next) => set({ page: String(next) })}
              note={
                <>
                  {t.common.shown(data.rows.length, data.total)}. {t.creators.footerNote}
                </>
              }
            />
          }
        >
          {data.rows.length ? (
            data.rows.map((row) => (
              <Link key={row.id} to={`/creators/${row.id}`} className="trow">
                <div className="who">
                  <Avatar name={row.name} url={row.avatarUrl} />
                  <div className="cell-main">
                    <span className="ellipsis">{row.name}</span>
                    <span className="tiny muted ellipsis">{handle(row.instagram)}</span>
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 600 }}>
                  {f.num(row.followers)}
                </div>
                <div className="num">{f.num(row.avgReelViews)}</div>
                <div className="num">{f.pct(row.engagementRate)}</div>
                <div>{row.city ? t.city(row.city) : ''}</div>
                <div>{t.levels[row.level]}</div>
                <div className="num" style={{ fontWeight: 600 }}>
                  {f.num(row.rating)}
                </div>
                <div className="small ink2">{row.tags.join(', ')}</div>
                <div>
                  <Badge tone={accountTone(row.accountStatus, row.profileStatus)}>
                    {row.profileStatus === 'private' && row.accountStatus !== 'rejected' ? t.account.private : t.account[row.accountStatus]}
                  </Badge>
                </div>
              </Link>
            ))
          ) : (
            <Empty>{t.creators.empty}</Empty>
          )}
        </Table>
      )}
    </>
  );
}
