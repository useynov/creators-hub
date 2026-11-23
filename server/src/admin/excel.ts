// Excel files for the team: a task report and the courier's list of orders.
// Real .xlsx files (exceljs), in the interface language. Values are written as plain cells,
// never as formulas, so text a creator typed cannot turn into a formula in Excel.

import ExcelJS from 'exceljs';
import type { Context } from 'hono';
import { settings } from '../config.js';
import type { OrderRowView, PublicationKind, PublicationStatus, ReportRow, ReportTotals, ViewsSourceLabel } from './types.js';

export type Lang = 'ru' | 'en';

const WORDS = {
  ru: {
    report: 'Отчет',
    totals: 'Итоги',
    creator: 'Креатор',
    instagram: 'Instagram',
    link: 'Ссылка',
    format: 'Формат',
    published: 'Вышло',
    submit: 'При отправке',
    h24: '24 ч',
    d7: '7 дн',
    d14: 'Итог, 14 дн',
    likes: 'Лайки',
    comments: 'Комм.',
    source: 'Источник цифр',
    status: 'Статус',
    notVisible: 'не видно',
    kinds: { reel: 'Reels', post: 'Пост', story: 'Сторис', tiktok: 'TikTok', unknown: 'Другое' } as Record<PublicationKind, string>,
    statuses: { tracking: 'Идет замер', final: 'Итог', removed: 'Удалена', unreachable: 'Недоступна' } as Record<PublicationStatus, string>,
    sources: {
      auto: 'Авто',
      auto_no_views: 'Авто, без просмотров',
      creator: 'Со слов креатора',
      creator_screenshot: 'Со слов креатора, скрин есть',
      team: 'Исправлено командой',
      none: 'Нет данных',
    } as Record<ViewsSourceLabel, string>,
    totalRows: {
      publications: 'Публикаций',
      creators: 'Креаторов',
      joined: 'Взяли задачу',
      views: 'Просмотры',
      statedViews: 'Из них со слов креаторов',
      likesComments: 'Лайки и комментарии',
      coinsPaid: 'Монет выдано',
      approved: 'Одобрено работ',
      costPer1000: `Цена 1000 просмотров, ${settings.currencySign}`,
      removed: 'Удалено до итога',
    },
    orders: 'Заказы',
    number: '№',
    item: 'Товар',
    size: 'Размер',
    address: 'Адрес',
    phone: 'Телефон',
    coins: 'Монеты',
    date: 'Дата',
    orderStatuses: { new: 'Новый', packed: 'Собран', shipped: 'Отправлен', delivered: 'Доставлен' },
  },
  en: {
    report: 'Report',
    totals: 'Totals',
    creator: 'Creator',
    instagram: 'Instagram',
    link: 'Link',
    format: 'Format',
    published: 'Published',
    submit: 'At submission',
    h24: '24 h',
    d7: '7 days',
    d14: 'Final, 14 days',
    likes: 'Likes',
    comments: 'Comments',
    source: 'Source of numbers',
    status: 'Status',
    notVisible: 'not public',
    kinds: { reel: 'Reel', post: 'Post', story: 'Story', tiktok: 'TikTok', unknown: 'Other' } as Record<PublicationKind, string>,
    statuses: { tracking: 'Measuring', final: 'Final', removed: 'Removed', unreachable: 'Unreachable' } as Record<PublicationStatus, string>,
    sources: {
      auto: 'Automatic',
      auto_no_views: 'Automatic, no views',
      creator: 'Stated by the creator',
      creator_screenshot: 'Stated by the creator, with screenshot',
      team: 'Corrected by the team',
      none: 'No data',
    } as Record<ViewsSourceLabel, string>,
    totalRows: {
      publications: 'Publications',
      creators: 'Creators',
      joined: 'Took the task',
      views: 'Views',
      statedViews: 'Of which stated by creators',
      likesComments: 'Likes and comments',
      coinsPaid: 'Coins paid',
      approved: 'Works approved',
      costPer1000: `Cost per 1000 views, ${settings.currencySign}`,
      removed: 'Removed before the final count',
    },
    orders: 'Orders',
    number: 'No.',
    item: 'Item',
    size: 'Size',
    address: 'Address',
    phone: 'Phone',
    coins: 'Coins',
    date: 'Date',
    orderStatuses: { new: 'New', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered' },
  },
};

/** The calendar day of an instant in the hub's zone, as a date cell (no time, no zone shift). */
function dayCell(iso: string | null): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms))
    .split('-')
    .map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE9E5' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function toBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** The report table, row for row as the site shows it (every page), and the totals on a second sheet. */
export async function reportWorkbook(title: string, rows: ReportRow[], totals: ReportTotals, lang: Lang): Promise<Buffer> {
  const w = WORDS[lang];
  const book = new ExcelJS.Workbook();
  book.creator = settings.brandName;
  const sheet = book.addWorksheet(w.report);
  sheet.columns = [
    { header: w.creator, key: 'creator', width: 22 },
    { header: w.instagram, key: 'instagram', width: 22 },
    { header: w.link, key: 'link', width: 40 },
    { header: w.format, key: 'format', width: 10 },
    { header: w.published, key: 'published', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: w.submit, key: 'submit', width: 14 },
    { header: w.h24, key: 'h24', width: 10 },
    { header: w.d7, key: 'd7', width: 10 },
    { header: w.d14, key: 'd14', width: 14 },
    { header: w.likes, key: 'likes', width: 10 },
    { header: w.comments, key: 'comments', width: 10 },
    { header: w.source, key: 'source', width: 32 },
    { header: w.status, key: 'status', width: 14 },
  ];
  for (const row of rows) {
    // Photo posts have no public view count: the cell says so instead of staying empty.
    const views = (cell: ReportRow['cells']['submit']): number | string | null =>
      cell.views !== null ? cell.views : cell.status === 'done' && row.kind === 'post' ? w.notVisible : null;
    sheet.addRow({
      creator: row.name,
      instagram: row.instagram ? `@${row.instagram}` : '',
      link: row.url,
      format: w.kinds[row.kind],
      published: dayCell(row.publishedAt),
      submit: views(row.cells.submit),
      h24: views(row.cells.h24),
      d7: views(row.cells.d7),
      d14: views(row.cells.d14),
      likes: row.likes,
      comments: row.comments,
      source: w.sources[row.source],
      status: w.statuses[row.status],
    });
  }
  styleHeader(sheet);

  const sum = book.addWorksheet(w.totals);
  sum.columns = [
    { header: title, key: 'label', width: 36 },
    { header: '', key: 'value', width: 16 },
  ];
  const t = w.totalRows;
  for (const [label, value] of [
    [t.publications, totals.publications],
    [t.creators, totals.creators],
    [t.joined, totals.joined],
    [t.views, totals.views],
    [t.statedViews, totals.statedViews],
    [t.likesComments, totals.likesComments],
    [t.coinsPaid, totals.coinsPaid],
    [t.approved, totals.approved],
    [t.costPer1000, totals.costPer1000],
    [t.removed, totals.removed],
  ] as Array<[string, number | null]>) {
    sum.addRow({ label, value });
  }
  sum.getRow(1).font = { bold: true };
  return toBuffer(book);
}

/** The courier's list: who, what, where. Personal data, so only Owner and Manager can download it. */
export async function ordersWorkbook(rows: OrderRowView[], lang: Lang): Promise<Buffer> {
  const w = WORDS[lang];
  const book = new ExcelJS.Workbook();
  book.creator = settings.brandName;
  const sheet = book.addWorksheet(w.orders);
  sheet.columns = [
    { header: w.number, key: 'id', width: 8 },
    { header: w.creator, key: 'creator', width: 22 },
    { header: w.instagram, key: 'instagram', width: 20 },
    { header: w.item, key: 'item', width: 24 },
    { header: w.size, key: 'size', width: 8 },
    { header: w.address, key: 'address', width: 44 },
    { header: w.phone, key: 'phone', width: 18 },
    { header: w.coins, key: 'coins', width: 10 },
    { header: w.date, key: 'date', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: w.status, key: 'status', width: 12 },
  ];
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      creator: row.creator.name,
      instagram: row.creator.instagram ? `@${row.creator.instagram}` : '',
      item: row.title,
      size: row.size ?? '',
      address: row.address,
      phone: row.phone,
      coins: row.coins,
      date: dayCell(row.createdAt),
      status: w.orderStatuses[row.status],
    });
  }
  styleHeader(sheet);
  return toBuffer(book);
}

export function xlsxResponse(c: Context, file: Buffer, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return c.body(new Uint8Array(file), 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${safe}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}
