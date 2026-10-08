// 공문 서식: 브리핑(근무 지시서), 정산(근무 보고서), 밤(야간 일지), 보급 신청서 등.
// 벽에 붙은 종이 한 장 + 아래쪽에 벽 버튼.
import { el } from '../dom.js';

/**
 * @param {{
 *   id: string,
 *   org?: string,
 *   title: string,
 *   meta?: [string, string][],
 *   approval?: { label: string, stamp?: string }[],
 *   sections: Node[],
 *   variant?: string,
 * }} opts
 */
export function officialSheet({ id, org = '임시재난대응본부', title, meta = [], approval, sections, variant = '' }) {
  const head = el('header', { className: 'official__head' }, [
    el('div', {}, [
      el('p', { className: 'official__org', text: org }),
      el('h1', { className: 'official__title', text: title, attrs: { id } }),
    ]),
    approval ? approvalBox(approval) : null,
  ]);

  const metaTable = meta.length
    ? el('table', { className: 'official__meta' }, [
        el(
          'tbody',
          {},
          meta.map(([k, v]) => el('tr', {}, [el('th', { text: k, attrs: { scope: 'row' } }), el('td', { text: v })])),
        ),
      ])
    : null;

  return el('article', { className: `official ${variant}`, attrs: { 'aria-labelledby': id } }, [
    head,
    metaTable,
    el('div', { className: 'official__body' }, sections),
  ]);
}

/** 결재란: 칸마다 직함, 도장이 찍힌 칸은 빨간 원 도장 */
function approvalBox(cells) {
  return el('table', { className: 'approval', attrs: { 'aria-label': '결재' } }, [
    el('tbody', {}, [
      el('tr', {}, cells.map((c) => el('th', { text: c.label, attrs: { scope: 'col' } }))),
      el(
        'tr',
        {},
        cells.map((c) =>
          el('td', {}, [c.stamp ? el('span', { className: 'approval__stamp', text: c.stamp }) : el('span', { className: 'sr-only', text: '미결' })]),
        ),
      ),
    ]),
  ]);
}

let sectionCounter = 0;

/** 공문 본문의 번호 매긴 항목 (1. 2. 3.) */
export function officialSection(number, heading, children, { id } = {}) {
  const hid = id ?? `sec-${++sectionCounter}`;
  return el('section', { className: 'official__section', attrs: { 'aria-labelledby': hid } }, [
    el('h2', { className: 'official__heading', attrs: { id: hid } }, [
      el('span', { className: 'official__num', text: `${number}.` }),
      el('span', { text: heading }),
    ]),
    ...[].concat(children),
  ]);
}

/** 벽에 붙은 종이 화면 */
export function paperScreen(sheet, actions, labelledBy) {
  return el('main', { className: 'screen paper-screen', attrs: { 'aria-labelledby': labelledBy } }, [
    sheet,
    el('div', { className: 'paper-screen__actions' }, actions),
  ]);
}

export function wallButton(text, onClick, { primary = false, disabled = false } = {}) {
  return el('button', {
    className: `wall-btn${primary ? ' wall-btn--primary' : ''}`,
    text,
    attrs: { type: 'button', disabled },
    on: { click: onClick },
  });
}

/** 항목: 값 표 (서식의 칸) */
export function fieldTable(rows, { caption } = {}) {
  return el('table', { className: 'form-table' }, [
    caption ? el('caption', { className: 'sr-only', text: caption }) : null,
    el(
      'tbody',
      {},
      rows.map(([k, v]) => el('tr', {}, [el('th', { text: k, attrs: { scope: 'row' } }), el('td', {}, [].concat(v))])),
    ),
  ]);
}
