// 밤 이벤트: "보고 사항" 한 장. 결정 항목 하나를 고르면 결과가 아래에 적힌다.
import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { canChoose, outbreakSize } from '../../core/events.js';
import { RESOURCE_LABEL } from '../../core/shelterState.js';
import { chooseEvent, nextAfterNight } from '../gameActions.js';
import { officialSheet, officialSection, paperScreen, wallButton } from '../components/official.js';
import { announce } from '../a11y.js';

const NEXT_LABEL = { ending: '최종 기록 보기', supply: '보급 신청서 작성', briefing: '다음 날 근무 지시서' };

function requiresText(choice) {
  const req = Object.entries(choice.requires ?? {});
  if (!req.length) return null;
  return `필요: ${req.map(([k, n]) => `${RESOURCE_LABEL[k] ?? k} ${n}`).join(', ')}`;
}

export function renderEvent({ store, navigate }) {
  const { pendingEvent, game } = store.get();
  const { event, day } = pendingEvent;
  const today = day + gameData.balance.calendar.todayOffset;

  const body = event.body.map((t) => el('p', { text: t }));
  if (event.scale === 'outbreak') {
    const size = outbreakSize(game.shelter, game.history);
    body.push(
      el('p', {
        text:
          size > 0
            ? `의무실 추정: 일반 구역에 아직 드러나지 않은 감염자가 ${size}명 안팎 있습니다. 지난 며칠의 판정이 그대로 돌아오고 있습니다.`
            : '의무실 추정: 지금까지 들인 사람 중 감염자는 많지 않아 보입니다. 다만 방심하기엔 이릅니다.',
      }),
    );
  }

  const choiceList = el('ol', { className: 'choices' });
  const resultBox = el('div', { attrs: { role: 'status' } });
  const actions = el('div', { className: 'paper-screen__actions' });

  function render() {
    const outcome = store.get().pendingEvent?.outcome;
    const shelter = store.get().game.shelter;
    choiceList.replaceChildren(
      ...event.choices.map((choice, i) => {
        const chosen = outcome?.index === i;
        const available = canChoose(outcome ? outcome.before : shelter, choice);
        const req = requiresText(choice);
        return el('li', {}, [
          el(
            'button',
            {
              className: `choice${chosen ? ' is-chosen' : ''}`,
              attrs: { type: 'button', disabled: !!outcome || !available, 'aria-pressed': String(chosen) },
              on: {
                click: () => {
                  chooseEvent(i);
                  render();
                  announce(store.get().pendingEvent.outcome?.result.join(' ') ?? '');
                },
              },
            },
            [
              el('span', { className: 'choice__box', text: chosen ? '☑' : '☐', attrs: { 'aria-hidden': 'true' } }),
              el('span', {}, [
                el('span', { text: choice.label }),
                req ? el('span', { className: 'choice__note', text: available ? req : `${req} (모자람)` }) : null,
              ]),
            ],
          ),
        ]);
      }),
    );

    resultBox.replaceChildren();
    actions.replaceChildren();
    if (outcome) {
      resultBox.append(el('div', { className: 'event-result' }, outcome.result.map((t) => el('p', { text: t }))));
      const next = nextAfterNight();
      actions.append(wallButton(NEXT_LABEL[next], () => navigate(next), { primary: true }));
    } else {
      actions.append(el('p', { className: 'hint', text: '결정 항목 하나를 고르세요. 고르면 되돌릴 수 없습니다.' }));
    }
  }

  const sheet = officialSheet({
    id: 'event-heading',
    org: '제3 지하 대피소 야간 근무자',
    title: '보고 사항',
    meta: [
      ['일자', `D+${today} 23:40`],
      ['제목', event.title],
    ],
    sections: [
      officialSection(1, '내용', body),
      officialSection(2, '결정', [choiceList, resultBox]),
    ],
  });

  render();
  const root = paperScreen(sheet, [], 'event-heading');
  root.querySelector('.paper-screen__actions').replaceWith(actions);
  return { el: root, title: event.title };
}
