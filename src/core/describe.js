// 외모 메모 · 관찰 기록 · 진술 문장 생성 (16장). UI 비의존.
// 같은 visitor.seed → 같은 문장.
import { createRng } from './rng.js';

const NUM_WORDS = ['', '한', '두', '세', '네', '다섯', '여섯'];

export function numWord(n) {
  return NUM_WORDS[n] ?? String(n);
}

/** 한글 마지막 글자에 받침이 있는지 */
export function hasBatchim(word) {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** '으로/로' 조사 (받침 없음·ㄹ받침 → 로) */
export function withEuro(word) {
  const code = word.charCodeAt(word.length - 1);
  const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

export function ageBand(age, ageGroup) {
  if (ageGroup === 'child') return age < 10 ? '어린' : '10대 초반';
  return `${Math.floor(age / 10) * 10}대`;
}

export function personLabel({ sex, age, ageGroup }) {
  const band = ageBand(age, ageGroup);
  if (ageGroup === 'child') return `${band} ${sex === 'M' ? '남자아이' : '여자아이'}`;
  return `${band} ${sex === 'M' ? '남성' : '여성'}`;
}

const ITEM_TEXT = { bag: '큰 가방을 듦', backpack: '배낭을 멤', cane: '지팡이를 짚음' };
const SIGN_TEXT = { cough: '마른기침을 함', sweat: '이마에 땀이 맺힘', panting: '숨을 몰아쉼 (뛰어온 듯)' };

/**
 * 그림자 옆 외모 메모. key가 있는 항목은 불일치 지적 대상이다.
 * @returns {{ key: string|null, text: string }[]}
 */
export function memoItems(observed) {
  const a = observed.appearance;
  const items = [
    { key: 'observed.appearance.height', text: `키 ${a.height}` },
    { key: 'observed.appearance.build', text: `${a.build} 체격` },
    { key: 'observed.appearance.hair', text: a.hair },
    { key: 'observed.appearance.feature', text: a.feature },
    { key: null, text: `${withEuro(personLabel(observed))} 보임` },
  ];
  if (observed.item && ITEM_TEXT[observed.item]) items.push({ key: null, text: ITEM_TEXT[observed.item] });
  for (const s of observed.signs ?? []) items.push({ key: null, text: SIGN_TEXT[s], sign: true });
  if (observed.groupSize > 1) {
    const others = observed.companions.map(personLabel).join(', ');
    items.push({ key: 'observed.groupSize', text: `일행 포함 ${observed.groupSize}명 (${others})` });
  } else {
    items.push({ key: 'observed.groupSize', text: '혼자 옴' });
  }
  return items;
}

/** 입장 시 관찰 기록 줄 */
export function entryLines(visitor) {
  const rng = createRng(visitor.seed);
  const n = visitor.observed.groupSize;
  const lines = [];
  if (n === 1) {
    lines.push({
      kind: 'action',
      text: rng.pick([
        '문이 열리고 한 사람이 창구 앞에 선다.',
        '다음 사람이 창구 앞으로 걸어온다.',
        '한 사람이 천천히 창구 앞에 선다.',
        '젖은 외투를 입은 사람이 창구 앞에 선다.',
      ]),
    });
  } else {
    lines.push({ kind: 'action', text: `${numWord(n)} 사람이 함께 창구 앞에 선다.` });
  }
  const greeting = rng.pick([
    { kind: 'speech', text: '서류 여기 있습니다.' },
    { kind: 'speech', text: '들어갈 수 있을까요?' },
    { kind: 'speech', text: '대피카드입니다. 확인해 주세요.' },
    { kind: 'speech', text: '오래 기다렸습니다.' },
    { kind: 'action', text: '말없이 서류를 창구 안으로 밀어 넣는다.' },
  ]);
  lines.push(greeting);
  return lines;
}

export const QUESTIONS = {
  name: { label: '이름을 묻는다', prompt: '이름이 어떻게 됩니까?' },
  district: { label: '사는 곳을 묻는다', prompt: '어디에 살았습니까?' },
  group: { label: '일행을 묻는다', prompt: '일행은 모두 몇 명입니까?' },
};

export const TOOLS = {
  temperature: { label: '체온 측정', recheckLabel: '체온 재측정' },
  symptoms: { label: '증상 문답' },
  rapidKit: { label: '신속 키트' },
  spo2: { label: '산소포화도' },
  breathing: { label: '호흡 관찰' },
};

const SYMPTOM_NAMES = { cough: '기침', fever: '발열', vomiting: '구토', breathless: '호흡곤란' };

/** 검사 결과 → 관찰 기록 줄 (key는 불일치 지적 대상) */
export function toolLines(result, threshold, spo2Threshold = 94) {
  switch (result.tool) {
    case 'temperature': {
      const high = result.value >= threshold;
      return [
        {
          kind: 'exam',
          key: result.recheck ? 'exam.temperature.recheck' : 'exam.temperature.first',
          text: `${result.recheck ? '재측정' : '체온'} ${result.value.toFixed(1)}°C${high ? `, 기준(${threshold}°C) 이상` : ''}`,
        },
      ];
    }
    case 'symptoms':
      return [
        { kind: 'question', text: '기침, 발열, 구토, 호흡곤란이 있습니까?' },
        ...Object.entries(result.answers).map(([k, yes]) => ({
          kind: 'exam',
          key: `exam.symptoms.${k}`,
          text: `${SYMPTOM_NAMES[k]}: ${yes ? '있다고 답함' : '없다고 답함'}`,
        })),
      ];
    case 'rapidKit':
      return [
        { kind: 'action', text: '면봉을 건네고 판독을 기다린다. 20초가 지났다.' },
        { kind: 'exam', key: 'exam.rapidKit', text: `신속 키트 ${result.value === 'pos' ? '양성' : '음성'}` },
      ];
    case 'spo2':
      return [
        {
          kind: 'exam',
          key: 'exam.spo2',
          text: `산소포화도 ${result.value}%${result.value < spo2Threshold ? `, 기준(${spo2Threshold}%) 미만` : ''}`,
        },
      ];
    case 'breathing':
      return [
        {
          kind: 'exam',
          key: 'exam.breathing',
          text: result.value === 'labored' ? '호흡: 숨 쉴 때마다 어깨가 크게 들썩임' : '호흡: 고르고 일정함',
        },
      ];
    default:
      return [];
  }
}

/** 질문에 대한 진술 줄. key는 불일치 지적 대상 */
export function answerLine(visitor, question) {
  const s = visitor.statement;
  const rng = createRng(visitor.seed + question.length * 7919);
  switch (question) {
    case 'name':
      return {
        kind: 'speech',
        key: 'statement.name',
        text: rng.pick([`${s.name}입니다.`, `${s.name}${hasBatchim(s.name) ? '이라고' : '라고'} 합니다.`]),
      };
    case 'district':
      return { kind: 'speech', key: 'statement.district', text: `${s.district}에 살았습니다.` };
    case 'group':
      return {
        kind: 'speech',
        key: 'statement.groupSize',
        text: s.groupSize === 1 ? '혼자입니다.' : `저까지 ${numWord(s.groupSize)} 명입니다.`,
      };
    default:
      throw new Error(`알 수 없는 질문: ${question}`);
  }
}
