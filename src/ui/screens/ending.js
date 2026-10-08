import { el } from '../dom.js';
import { officialSheet, officialSection, paperScreen, wallButton, fieldTable } from '../components/official.js';

const TEXT = {
  gameover: {
    title: '심사관 교체 통보',
    body: '대피소 주민들의 신뢰가 바닥났습니다. 본부는 출입 심사 업무를 다른 심사관에게 넘겼습니다. 창구의 불은 다음 날 아침에도 켜져 있었습니다.',
  },
  buildEnd: {
    title: '10일차 근무 종료',
    body: '현재 빌드에서 진행할 수 있는 마지막 날까지 근무를 마쳤습니다. 정밀 검사가 들어오고 물자가 바닥나기 시작하는 11일차부터는 다음 업데이트에서 이어집니다.',
  },
};

export function renderEnding({ store, navigate }) {
  const { ending, game } = store.get();
  const t = TEXT[ending?.kind] ?? TEXT.buildEnd;
  const s = game.shelter;

  const rows = game.history.map((h) =>
    el('tr', {}, [
      el('th', { text: `${h.day}일차`, attrs: { scope: 'row' } }),
      el('td', { text: String(h.processed) }),
      el('td', { text: String(h.mistakes) }),
      el('td', { text: String(h.unprocessed) }),
      el('td', { text: String(h.approvedPeople) }),
      el('td', { text: String(h.infections) }),
    ]),
  );

  const sheet = officialSheet({
    id: 'end-heading',
    title: t.title,
    meta: [['수신', '제3 지하 대피소 출입 심사관']],
    sections: [
      officialSection(1, '내용', el('p', { text: t.body })),
      officialSection(2, '근무 기록', [
        el('div', { className: 'table-wrap' }, [
          el('table', { className: 'stats-table' }, [
            el('thead', {}, [
              el('tr', {}, ['일차', '처리', '오심', '미처리', '입장', '감염 발견'].map((h) => el('th', { text: h, attrs: { scope: 'col' } }))),
            ]),
            el('tbody', {}, rows),
          ]),
        ]),
      ]),
      officialSection(
        3,
        '최종 상태',
        fieldTable([
          ['신뢰도', String(s.trust)],
          ['수용', `${s.occupancy}/${s.capacity}명`],
          ['뇌물 수수', `${s.flags?.bribes ?? 0}회`],
          ['규정 위반 입소', `${s.flags?.ruleBreaks ?? 0}회`],
        ]),
      ),
    ],
  });

  const root = paperScreen(sheet, [wallButton('처음 화면으로', () => navigate('title'), { primary: true })], 'end-heading');
  return { el: root, title: t.title };
}
