import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { KIND_LABEL } from '../../core/scoring.js';
import { retrySave } from '../gameActions.js';
import { officialSheet, officialSection, paperScreen, wallButton, fieldTable } from '../components/official.js';

const VERDICT_LABEL = { approve: '승인', deny: '거부', quarantine: '격리' };

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

function mistakeItem(m) {
  const given = m.verdict === 'deny' ? `거부 (${m.reason})` : VERDICT_LABEL[m.verdict];
  return el('li', { className: 'mistake' }, [
    el('p', { className: 'mistake__head', text: `${m.name}: ${KIND_LABEL[m.kind]}` }),
    el('p', { className: 'mistake__given', text: `내린 판정은 ${given}` }),
    el('ul', { className: 'plain-list mistake__explain' }, m.explain.map((t) => el('li', { text: t }))),
  ]);
}

export function renderSummary({ store, navigate }) {
  const { lastSummary, saveStatus } = store.get();
  const { summary, shelterBefore, shelterAfter, undetected = [] } = lastSummary;
  const today = summary.day + gameData.balance.calendar.todayOffset;

  const saveLine = el('div', { className: 'save-status', attrs: { role: 'status' } });
  function renderSave(status) {
    if (!status) {
      saveLine.replaceChildren();
      return;
    }
    saveLine.replaceChildren(
      status.ok
        ? el('p', { className: 'status-ok', text: '✓ 다음 날 시작 상태를 저장했습니다.' })
        : el('div', {}, [
            el('p', { className: 'status-warn', text: `⚠ 저장하지 못했습니다. ${status.message}` }),
            wallButton('다시 저장', () => {
              retrySave();
              renderSave(store.get().saveStatus);
            }),
          ]),
    );
  }
  renderSave(saveStatus);

  const penalty =
    summary.mistakes.length === 0
      ? '없음'
      : [
          `경고 ${summary.warnings}회`,
          summary.penalized ? `벌점 ${summary.penalized}회` : null,
          summary.majors ? `중대 오심 ${summary.majors}건` : null,
        ]
          .filter(Boolean)
          .join(', ') + (summary.penaltyPoints ? ` (보급 포인트 −${summary.penaltyPoints})` : '');

  const sections = [
    officialSection(
      1,
      '처리 결과',
      fieldTable(
        [
          ['처리', `${summary.processed}명 (정확 ${summary.correct}명)`],
          ['오심', `${summary.mistakes.length}건`],
          ['경고와 벌점', penalty],
          ['미처리', `${summary.unprocessed}명`],
          ['입장', `${summary.approvedPeople}명 (수용 ${shelterBefore.occupancy}명에서 ${shelterAfter.occupancy}명으로)`],
          ['신뢰도', `${shelterBefore.trust}에서 ${shelterAfter.trust}로 (${signed(summary.trustDelta)})`],
          ['보급 포인트', `+${summary.supplyEarned} (보유 ${shelterAfter.supplyPoints})`],
        ],
        { caption: '처리 결과' },
      ),
    ),
    officialSection(
      2,
      '오심 해설',
      summary.mistakes.length
        ? el('ol', { className: 'mistakes' }, summary.mistakes.map(mistakeItem))
        : el('p', { className: 'status-ok', text: '✓ 오늘은 오심이 없습니다.' }),
    ),
  ];
  if (undetected.length) {
    sections.push(
      officialSection(
        3,
        '의무실 통보',
        el('p', {
          text: `오늘 승인한 사람 중 ${undetected.join(', ')}은(는) 잠복기 감염자였습니다. 오늘 가진 장비로는 판별할 수 없는 경우라 오심으로 치지 않습니다. 밤사이 일반 구역에서 발열이 시작될 수 있습니다.`,
        }),
      ),
    );
  }

  const sheet = officialSheet({
    id: 'sum-heading',
    org: '제3 지하 대피소 출입 심사창구',
    title: '근무 보고서',
    meta: [
      ['수신', '임시재난대응본부'],
      ['일자', `D+${today} (${summary.day}일차)`],
    ],
    sections,
  });

  const root = paperScreen(sheet, [saveLine, wallButton('야간 일지 보기', () => navigate('night'), { primary: true })], 'sum-heading');
  return { el: root, title: `${summary.day}일차 근무 보고서` };
}
