// 엔딩: 본부의 운영 평가 공문 + 일차별 기록 + 감염 경로
import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { pickEnding } from '../../core/endings.js';
import { officialSheet, officialSection, paperScreen, wallButton, fieldTable } from '../components/official.js';

export function renderEnding({ store, navigate }) {
  const { game } = store.get();
  const saved = store.get().ending;
  const { ending, stats } = saved?.ending ? saved : pickEnding(game.shelter, game.history, gameData.endings);
  const s = game.shelter;
  const lastDay = game.history.at(-1)?.day ?? game.day;

  const rows = game.history.map((h) =>
    el('tr', {}, [
      el('th', { text: `${h.day}일차`, attrs: { scope: 'row' } }),
      el('td', { text: String(h.processed) }),
      el('td', { text: String(h.mistakes) }),
      el('td', { text: String(h.approvedPeople) }),
      el('td', { text: String(h.infections) }),
    ]),
  );

  // 감염 경로: 격리 대상을 들인 중대 오심, 장비로 못 잡은 잠복기 감염자, 대피소 안에서 번진 감염
  const sum = (k) => game.history.reduce((t, h) => t + (h[k] ?? 0), 0);
  const majors = sum('majors');
  const hidden = sum('hiddenAdmitted');
  const spread = Math.max(0, stats.infections - majors - hidden);

  const sheet = officialSheet({
    id: 'end-heading',
    title: '운영 평가 통보',
    meta: [
      ['수신', '제3 지하 대피소 출입 심사관'],
      ['제목', `${lastDay}일간의 출입 심사 운영 평가`],
      ['평가', ending.title],
    ],
    approval: [{ label: '담당' }, { label: '감사' }, { label: '본부장', stamp: '본부' }],
    sections: [
      officialSection(1, ending.title, ending.body.map((t) => el('p', { text: t }))),
      officialSection(2, '일차별 기록', [
        el('div', { className: 'table-wrap' }, [
          el('table', { className: 'stats-table' }, [
            el('thead', {}, [
              el('tr', {}, ['일차', '처리', '오심', '입장', '감염 발견'].map((h) => el('th', { text: h, attrs: { scope: 'col' } }))),
            ]),
            el('tbody', {}, rows),
          ]),
        ]),
      ]),
      officialSection(
        3,
        '감염 경로',
        fieldTable([
          ['격리 대상 입장', `${majors}건 (중대 오심)`],
          ['잠복기 감염자 입장', `${hidden}명 (장비로 판별 불가)`],
          ['대피소 안 확산', `${spread}명`],
          ['밤에 발견된 감염', `${stats.infections}명`],
        ]),
      ),
      officialSection(
        4,
        '최종 상태',
        fieldTable([
          ['신뢰도', String(s.trust)],
          ['수용', `${s.occupancy}/${s.capacity}명`],
          ['거부 비율', `${Math.round(stats.denyRatio * 100)}%`],
          ['뇌물 수수', `${stats.bribes}회`],
          ['규정을 어긴 입소', `${stats.ruleBreaks}회`],
        ]),
      ),
    ],
  });

  const root = paperScreen(sheet, [wallButton('처음 화면으로', () => navigate('title'), { primary: true })], 'end-heading');
  return { el: root, title: `평가: ${ending.title}` };
}
