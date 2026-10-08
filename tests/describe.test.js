import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { generateDay } from '../src/core/visitorGenerator.js';
import { memoItems, entryLines, answerLine, hasBatchim, withEuro, numWord } from '../src/core/describe.js';

describe('describe', () => {
  it('같은 시드 → 같은 메모와 문장', () => {
    const a = generateDay(gameData, 99, 3).visitors;
    const b = generateDay(gameData, 99, 3).visitors;
    a.forEach((v, i) => {
      expect(memoItems(v.observed)).toEqual(memoItems(b[i].observed));
      expect(entryLines(v)).toEqual(entryLines(b[i]));
      expect(answerLine(v, 'name')).toEqual(answerLine(b[i], 'name'));
    });
  });

  it('외모 메모는 서류와 같은 어휘를 쓴다 (정상 방문자는 카드 값과 그대로 일치)', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const v of generateDay(gameData, seed, 1).visitors.filter((x) => x.faults.length === 0)) {
        const memo = Object.fromEntries(memoItems(v.observed).filter((m) => m.key).map((m) => [m.key, m.text]));
        const card = v.documents.idCard.appearance;
        expect(memo['observed.appearance.height']).toBe(`키 ${card.height}`);
        expect(memo['observed.appearance.build']).toBe(`${card.build} 체격`);
        expect(memo['observed.appearance.hair']).toBe(card.hair);
        expect(memo['observed.appearance.feature']).toBe(card.feature);
      }
    }
  });

  it('메모의 일행 수 = 그림자 수 = 실제 인원', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const v of generateDay(gameData, seed, 3).visitors) {
        const n = v.truth.companions.length + 1;
        expect(v.observed.groupSize).toBe(n);
        expect(v.observed.companions).toHaveLength(n - 1);
        const groupMemo = memoItems(v.observed).find((m) => m.key === 'observed.groupSize');
        expect(groupMemo.text).toEqual(n === 1 ? '혼자 옴' : expect.stringContaining(`일행 포함 ${n}명`));
      }
    }
  });

  it('진술은 질문 종류별로 해당 키를 가진다', () => {
    const v = generateDay(gameData, 5, 3).visitors[0];
    expect(answerLine(v, 'name').key).toBe('statement.name');
    expect(answerLine(v, 'name').text).toContain(v.statement.name);
    expect(answerLine(v, 'district').key).toBe('statement.district');
    expect(answerLine(v, 'group').key).toBe('statement.groupSize');
  });

  it('조사 처리', () => {
    expect(hasBatchim('김민준')).toBe(true);
    expect(hasBatchim('이서하')).toBe(false);
    expect(withEuro('40대 남성')).toBe('40대 남성으로');
    expect(withEuro('어린 여자아이')).toBe('어린 여자아이로');
    expect(numWord(3)).toBe('세');
  });
});
