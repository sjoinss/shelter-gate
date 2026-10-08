// 보급 신청서: 포인트로 식량/의약품/필터/키트를 산다. 모두 채울 수는 없다.
import { el } from '../dom.js';
import { gameData } from '../../data/index.js';
import { RESOURCE_KEYS, RESOURCE_LABEL, nightlyNeed } from '../../core/shelterState.js';
import { orderCost } from '../../core/supply.js';
import { confirmSupplies } from '../gameActions.js';
import { officialSheet, officialSection, paperScreen, wallButton } from '../components/official.js';
import { toast } from '../feedback.js';
import { announce } from '../a11y.js';

const UNIT = { food: '인분', medicine: '개', filters: '개', kits: '개' };
const KIT_NOTE = '하루 방문자 중 증상 응답자 수만큼';

export function renderSupply({ store, navigate }) {
  const { game } = store.get();
  const { balance } = gameData;
  const items = balance.shop.items;
  const shelter = game.shelter;
  const need = nightlyNeed(shelter, balance);
  const order = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0]));

  const tbody = el('tbody');
  const pointsLine = el('p', { className: 'points-line', attrs: { 'aria-live': 'polite' } });

  function render() {
    const cost = orderCost(order, balance);
    const left = shelter.supplyPoints - cost;
    tbody.replaceChildren(
      ...RESOURCE_KEYS.map((key) => {
        const item = items[key];
        const after = shelter[key] + order[key] * item.amount;
        const short = key !== 'kits' && after < need[key];
        return el('tr', {}, [
          el('th', { attrs: { scope: 'row' } }, [
            el('span', { text: RESOURCE_LABEL[key] }),
            el('span', { className: 'choice__note', text: `${item.price}포인트에 ${item.amount}${UNIT[key]}` }),
          ]),
          el('td', { text: `${shelter[key]}` }),
          el('td', { text: key === 'kits' ? KIT_NOTE : `${need[key]}` }),
          el('td', {}, [
            el('div', { className: 'stepper' }, [
              el('button', {
                className: 'stepper__btn',
                text: '−',
                attrs: { type: 'button', disabled: order[key] === 0, 'aria-label': `${RESOURCE_LABEL[key]} 한 묶음 빼기` },
                on: { click: () => change(key, -1) },
              }),
              el('span', { className: 'stepper__value', text: String(order[key]), attrs: { 'aria-label': `${RESOURCE_LABEL[key]} 신청 ${order[key]}묶음` } }),
              el('button', {
                className: 'stepper__btn',
                text: '+',
                attrs: { type: 'button', disabled: left < item.price, 'aria-label': `${RESOURCE_LABEL[key]} 한 묶음 더하기` },
                on: { click: () => change(key, 1) },
              }),
            ]),
          ]),
          el('td', { className: short ? 'is-short' : '', text: short ? `${after} ⚠ 모자람` : `${after}` }),
        ]);
      }),
    );
    pointsLine.replaceChildren(el('span', { text: '남는 보급 포인트' }), el('span', { text: `${left} / ${shelter.supplyPoints}` }));
  }

  function change(key, delta) {
    order[key] = Math.max(0, order[key] + delta);
    render();
    announce(`${RESOURCE_LABEL[key]} ${order[key]}묶음`);
  }

  const table = el('div', { className: 'table-wrap' }, [
    el('table', { className: 'supply-table' }, [
      el('caption', { className: 'sr-only', text: '보급 신청' }),
      el('thead', {}, [
        el('tr', {}, ['품목', '재고', '하룻밤 소모', '신청', '신청 후'].map((h) => el('th', { text: h, attrs: { scope: 'col' } }))),
      ]),
      tbody,
    ]),
  ]);

  const sheet = officialSheet({
    id: 'supply-heading',
    org: '제3 지하 대피소 출입 심사창구',
    title: '보급 신청서',
    meta: [
      ['수신', '임시재난대응본부 보급과'],
      ['일자', `D+${game.day - 1 + balance.calendar.todayOffset} 야간`],
    ],
    sections: [
      officialSection(1, '신청 품목', [
        el('p', { text: '보급 포인트로 내일 쓸 물자를 신청합니다. 포인트로 모든 품목을 채울 수는 없습니다. 남은 포인트는 다음 신청에 이월됩니다.' }),
        table,
        pointsLine,
      ]),
    ],
  });

  const submit = wallButton(
    '신청하고 다음 날로',
    () => {
      const err = confirmSupplies({ ...order });
      if (err) {
        toast(err, 'warning', { duration: 4000 });
        return;
      }
      toast('보급을 신청했습니다.', 'success');
      navigate('briefing');
    },
    { primary: true },
  );

  render();
  const root = paperScreen(sheet, [submit], 'supply-heading');
  return { el: root, title: '보급 신청서' };
}
