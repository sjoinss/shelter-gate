// 창구 너머 어두운 그림자 (16-1). 가슴 위까지만 보이는 흉상, 모두 같은 단색.
// 키 = 창 안에서 머리 위치, 체격 = 어깨 폭, 연령대 = 머리 크기·자세.
// 값은 열거형 → 숫자 매핑으로만 만든다 (자유 문자열을 SVG에 넣지 않음).
import { svg } from '../dom.js';

const HEAD_TOP = { '큰 편': 5, 보통: 10, '작은 편': 15 };
const BUILD = { 마른: 0.84, 보통: 1, 건장한: 1.12, 통통한: 1.2 };
const SLOT_W = 60;
const FRAME_H = 80;

function r1(n) {
  return Math.round(n * 10) / 10;
}

/** 한 사람의 흉상. person: { height, build, ageGroup, coughing } */
function bust(person, index) {
  const cx = SLOT_W * index + SLOT_W / 2;
  const child = person.ageGroup === 'child';
  const elder = person.ageGroup === 'elder';
  const w = BUILD[person.build] ?? 1;

  const top = child ? 30 : (HEAD_TOP[person.height] ?? 10) + (elder ? 3 : 0); // 노인은 고개가 약간 내려감
  const ry = child ? 9.5 : 11;
  const rx = (child ? 8 : 9) * (0.92 + w * 0.08);
  const headCy = top + ry;
  const neckTop = headCy + ry - 3;
  const shoulderY = headCy + ry + (elder ? 2 : 4);
  const sw = Math.min(27, (child ? 14 : 20) * w); // 어깨 반폭
  const neckW = (child ? 3.5 : 4.5) * w; // 목 반폭
  const drop = elder ? 10 : 7; // 목에서 어깨 끝까지 내려가는 정도 (노인은 처진 어깨)

  const motion = person.labored ? ' is-labored' : person.coughing ? ' is-coughing' : '';
  const g = svg('g', { class: `sil-figure${motion}` });
  g.style.setProperty('--sil-delay', `${(index * 0.7) % 3}s`);

  const y0 = shoulderY - 2;
  g.append(
    // 목 + 어깨·가슴을 한 덩어리로 (창 아래로 잘림)
    svg('path', {
      d: [
        `M${r1(cx - sw)} ${FRAME_H}`,
        `L${r1(cx - sw)} ${r1(y0 + drop + 6)}`,
        `C${r1(cx - sw)} ${r1(y0 + drop)} ${r1(cx - sw * 0.55)} ${r1(y0 + 1)} ${r1(cx - neckW - 2)} ${r1(y0)}`,
        `L${r1(cx - neckW)} ${r1(neckTop)}`,
        `L${r1(cx + neckW)} ${r1(neckTop)}`,
        `L${r1(cx + neckW + 2)} ${r1(y0)}`,
        `C${r1(cx + sw * 0.55)} ${r1(y0 + 1)} ${r1(cx + sw)} ${r1(y0 + drop)} ${r1(cx + sw)} ${r1(y0 + drop + 6)}`,
        `L${r1(cx + sw)} ${FRAME_H}`,
        'Z',
      ].join(' '),
    }),
    // 머리
    svg('ellipse', { cx: r1(cx), cy: r1(headCy), rx: r1(rx), ry: r1(ry) }),
  );
  return g;
}

/**
 * @param observed visitor.observed
 * @param opts.labored 호흡 관찰에서 이상 호흡이 확인되었는지 (관찰 후에만 움직임으로 보여 줌)
 * @returns SVGElement
 */
export function renderSilhouettes(observed, { labored = false } = {}) {
  const people = [
    {
      height: observed.appearance.height,
      build: observed.appearance.build,
      ageGroup: observed.ageGroup,
      coughing: (observed.signs ?? []).includes('cough'),
      labored,
    },
    ...observed.companions.map((c) => ({ height: c.height, build: c.build, ageGroup: c.ageGroup })),
  ];
  const n = people.length;
  const root = svg('svg', {
    class: 'silhouettes',
    viewBox: `0 0 ${SLOT_W * n} ${FRAME_H}`,
    preserveAspectRatio: 'xMidYMax meet',
    role: 'img',
    'aria-label': `창구 앞 그림자 ${n}명`,
    focusable: 'false',
  });
  people.forEach((p, i) => root.append(bust(p, i)));
  return root;
}
