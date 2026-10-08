import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { quarantineUsed } from '../../core/shelterState.js';
import { nextAfterNight } from '../gameActions.js';
import { officialSheet, officialSection, paperScreen, wallButton, fieldTable } from '../components/official.js';

const MARK = { info: '·', warn: '⚠', ok: '✓' };
const NEXT_LABEL = { ending: '최종 기록 보기', event: '보고 사항 확인', supply: '보급 신청서 작성', briefing: '다음 날 근무 지시서' };

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

export function renderNight({ store, navigate }) {
  const { lastNight } = store.get();
  const { day, report, shelterBefore, shelterAfter } = lastNight;
  const today = day + gameData.balance.calendar.todayOffset;
  const trustDelta = shelterAfter.trust - shelterBefore.trust;
  const consuming = day >= gameData.balance.resources.consumeFromDay;
  const next = nextAfterNight();

  const rows = [
    ['수용', `${shelterAfter.occupancy}/${shelterAfter.capacity}명`],
    ['격리실', `${quarantineUsed(shelterAfter)}/${shelterAfter.quarantineSeats}석`],
    ['신뢰도', `${shelterAfter.trust}${trustDelta ? ` (밤사이 ${signed(trustDelta)})` : ''}`],
  ];
  if (consuming || day + 1 >= gameData.balance.resources.consumeFromDay) {
    rows.push(['식량', `${shelterAfter.food}인분`], ['의약품', `${shelterAfter.medicine}개`], ['필터', `${shelterAfter.filters}개`], ['키트', `${shelterAfter.kits}개`]);
    if (day + 1 >= 11) rows.push(['PCR 시약', `${shelterAfter.reagents}개`]);
  }

  const sheet = officialSheet({
    id: 'night-heading',
    org: '제3 지하 대피소 야간 근무자',
    title: '야간 일지',
    meta: [['일자', `D+${today} 22:00 ~ D+${today + 1} 06:00`]],
    sections: [
      officialSection(
        1,
        '밤사이 있었던 일',
        el(
          'ol',
          { className: 'night-log' },
          report.map((line) =>
            el('li', { className: `night-log__line night-log--${line.kind}` }, [
              el('span', { className: 'night-log__mark', text: MARK[line.kind], attrs: { 'aria-hidden': 'true' } }),
              el('span', { text: line.text }),
            ]),
          ),
        ),
      ),
      officialSection(2, '아침 현황', fieldTable(rows, { caption: '아침 현황' })),
    ],
  });

  const root = paperScreen(sheet, [wallButton(NEXT_LABEL[next], () => navigate(next), { primary: true })], 'night-heading');
  return { el: root, title: `${day}일차 야간 일지` };
}
