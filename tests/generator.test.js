import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { generateDay } from '../src/core/visitorGenerator.js';

const DAYS = gameData.days.days.map((d) => d.day);

describe('visitorGenerator', () => {
  it('같은 시드 → 같은 방문자 열', () => {
    for (const day of DAYS) {
      const a = generateDay(gameData, 4242, day).visitors;
      const b = generateDay(gameData, 4242, day).visitors;
      expect(a).toEqual(b);
    }
  });

  it('다른 시드 → 다른 방문자 열', () => {
    const a = generateDay(gameData, 1, 1).visitors.map((v) => v.truth.name);
    const b = generateDay(gameData, 2, 1).visitors.map((v) => v.truth.name);
    expect(a).not.toEqual(b);
  });

  it('방문자 수와 정상 비율(40~55%)이 일차 정의를 따른다', () => {
    for (const day of DAYS) {
      const def = gameData.days.days.find((d) => d.day === day);
      for (let seed = 0; seed < 50; seed++) {
        const { visitors } = generateDay(gameData, seed * 97, day);
        expect(visitors).toHaveLength(def.visitors);
        const normal = visitors.filter((v) => v.correctVerdict === 'approve').length / visitors.length;
        expect(normal).toBeGreaterThanOrEqual(0.4);
        expect(normal).toBeLessThanOrEqual(0.55);
      }
    }
  });

  it('오류는 방문자당 0~2개, 서로 다른 규정', () => {
    for (const day of DAYS) {
      for (let seed = 0; seed < 100; seed++) {
        for (const v of generateDay(gameData, seed, day).visitors) {
          expect(v.faults.length).toBeLessThanOrEqual(2);
          expect(new Set(v.faults.map((f) => f.rule)).size).toBe(v.faults.length);
        }
      }
    }
  });

  it('같은 날 이름이 중복되지 않는다 (일행 포함)', () => {
    for (const day of DAYS) {
      for (let seed = 0; seed < 50; seed++) {
        const names = generateDay(gameData, seed, day).visitors.flatMap((v) => [
          v.truth.name,
          ...v.truth.companions.map((c) => c.name),
        ]);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it('해금 전 서류는 생성되지 않는다', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const day of [1, 2]) {
        for (const v of generateDay(gameData, seed, day).visitors) {
          expect(v.documents.permit).toBeUndefined();
          expect(v.documents.companionList).toBeUndefined();
          expect(v.truth.companions).toHaveLength(0);
        }
      }
    }
  });

  it('3일차에는 일행이 있는 방문자와 동행자 명부가 나온다', () => {
    let groups = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const v of generateDay(gameData, seed, 3).visitors) {
        if (v.truth.companions.length > 0) {
          groups++;
          expect(v.documents.companionList).toBeDefined();
        }
      }
    }
    expect(groups).toBeGreaterThan(0);
  });

  it('동행자 나이는 관계에 맞는다 (자녀 18살 이상 어림, 부모 18살 이상 많음, 배우자 ±6살)', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const v of generateDay(gameData, seed, 3).visitors) {
        for (const c of v.truth.companions) {
          if (c.relation === '자녀') expect(v.truth.age - c.age).toBeGreaterThanOrEqual(18);
          if (c.relation === '부모') expect(c.age - v.truth.age).toBeGreaterThanOrEqual(18);
          if (c.relation === '배우자') expect(Math.abs(c.age - v.truth.age)).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('구역 오류 두 가지(위조/폐쇄)는 한 방문자에게 동시에 주입되지 않는다', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const v of generateDay(gameData, seed, 3).visitors) {
        const types = v.faults.map((f) => f.type);
        expect(types.includes('districtInvalid') && types.includes('districtClosed')).toBe(false);
      }
    }
  });
});
