import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { activeRules, buildContext, getDayDef } from '../../core/ruleEngine.js';
import { remainingCapacity, quarantineUsed, quarantineFree } from '../../core/shelterState.js';
import { formatClock } from '../timer.js';
import { officialSheet, officialSection, paperScreen, wallButton, fieldTable } from '../components/official.js';
import { ruleArticles } from '../ruleArticles.js';

const TOOL_NAMES = { temperature: '체온계', symptoms: '증상 문답', rapidKit: '신속 키트', spo2: '산소포화도 측정기', breathing: '호흡 관찰', pcr: '정밀 검사(PCR)' };

export function renderBriefing({ store, navigate }) {
  const { game, settings } = store.get();
  const { day, shelter } = game;
  const dayDef = getDayDef(gameData, day);
  const ctx = buildContext(gameData, day);
  const rules = activeRules(gameData.rules.rules, day);
  const limit = dayDef.timeLimitSec * (settings.relaxedTimer ? gameData.balance.timer.relaxedMultiplier : 1);
  const closed = gameData.districts.districts.filter((d) => dayDef.closedDistricts.includes(d.code));
  const articles = ruleArticles(rules, gameData.rules.rules, day);
  const changed = articles.filter((a) => a.mark);
  const consuming = day >= gameData.balance.resources.consumeFromDay;

  const sections = [];
  let n = 0;
  sections.push(officialSection(++n, '지시 사항', el('p', { text: dayDef.briefing })));
  if (dayDef.tutorial.length) {
    sections.push(officialSection(++n, '심사 요령', el('ul', { className: 'plain-list' }, dayDef.tutorial.map((t) => el('li', { text: t })))));
  }
  // 오늘 신설·개정된 조항만 전문을 싣고, 나머지는 제목만 (전문은 규정집에 있음)
  const unchanged = articles.filter((a) => !a.mark);
  sections.push(
    officialSection(++n, changed.length ? `오늘 바뀐 규정 ${changed.length}개` : '오늘 바뀐 규정 없음', [
      changed.length
        ? el(
            'ol',
            { className: 'brief-rules' },
            changed.map((a) =>
              el('li', {}, [
                el('span', {}, [
                  el('span', { className: 'mark-new', text: a.mark }),
                  el('span', { className: 'article-no', text: `제${a.no}조 (${a.title})` }),
                ]),
                el('span', { text: a.text }),
              ]),
            ),
          )
        : el('p', { text: '어제와 같은 규정으로 심사합니다.' }),
      unchanged.length
        ? el('p', { text: `그대로인 조항: ${unchanged.map((a) => `제${a.no}조 (${a.title})`).join(', ')}. 전문은 창구의 규정집에 있습니다.` })
        : null,
    ]),
  );
  if (closed.length) {
    sections.push(officialSection(++n, '폐쇄 구역', el('p', { text: closed.map((d) => `${d.name}(${d.code})`).join(', ') })));
  }

  const rows = [
    ['방문 예정', `${dayDef.visitors}명 (일행 별도)`],
    ['근무 시간', `${formatClock(limit)}${settings.relaxedTimer ? ' (시간 여유 모드)' : ''}`],
    ['수용', `${shelter.occupancy}/${shelter.capacity}명 (빈자리 ${remainingCapacity(shelter)})`],
  ];
  if (dayDef.tools.length) {
    rows.push(['검사 장비', dayDef.tools.map((t) => TOOL_NAMES[t]).join(', ')]);
    rows.push(['격리실', `${quarantineUsed(shelter)}/${shelter.quarantineSeats}석 사용 중 (빈자리 ${quarantineFree(shelter)})`]);
  }
  if (dayDef.tools.includes('rapidKit')) rows.push(['키트 재고', `${shelter.kits}개`]);
  if (dayDef.tools.includes('pcr')) rows.push(['PCR 시약', `${shelter.reagents}개`]);
  if (consuming) {
    rows.push(['식량', `${shelter.food}인분`], ['의약품', `${shelter.medicine}개`], ['필터', `${shelter.filters}개`]);
  }
  rows.push(['신뢰도', String(shelter.trust)], ['보급 포인트', String(shelter.supplyPoints)]);
  sections.push(officialSection(++n, '현황', fieldTable(rows, { caption: '대피소 현황' })));

  const sheet = officialSheet({
    id: 'brief-heading',
    title: '근무 지시서',
    meta: [
      ['수신', '제3 지하 대피소 출입 심사관'],
      ['일자', `D+${ctx.today} (${day}일차)`],
      ['제목', `${day}일차 출입 심사 근무 지시`],
    ],
    approval: [{ label: '담당' }, { label: '팀장' }, { label: '본부장', stamp: '본부' }],
    sections,
  });

  const root = paperScreen(sheet, [wallButton('근무 시작', () => navigate('inspection'), { primary: true })], 'brief-heading');
  return { el: root, title: `${day}일차 근무 지시서` };
}
