// 18장 공정성: 모든 방문자는 보이는 정보 + 활성 규정 + 해금된 장비만으로 판정 가능해야 한다.
import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { generateDay } from '../src/core/visitorGenerator.js';
import { findFault } from '../src/core/dayFlow.js';

const DAYS = gameData.days.days.map((d) => d.day);
const SEEDS = 300;

// 플레이어가 고를 수 있는 항목 키인지 (서류/메모/진술/검사 결과/규정집/오늘 날짜)
function isPickableKey(v, key, tools) {
  if (key.startsWith('rule:')) return true;
  if (['ref.today', 'ref.districts', 'ref.shelter', 'ref.hospitals'].includes(key)) return true;
  const [root, sub] = key.split('.');
  if (root === 'observed' || root === 'statement') return true;
  if (root === 'exam') return sub === 'symptoms' ? tools.includes('symptoms') : tools.includes('temperature');
  return v.documents[root] !== undefined;
}

describe('solvability', () => {
  it(`1~${DAYS.length}일차 × 시드 ${SEEDS}개: 정답과 근거가 항상 정의된다`, () => {
    for (const day of DAYS) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const { visitors, rules, dayDef } = generateDay(gameData, seed * 7919 + 13, day);
        const activeIds = new Set(rules.map((r) => r.id));
        for (const v of visitors) {
          expect(['approve', 'deny', 'quarantine']).toContain(v.correctVerdict);
          if (v.correctVerdict === 'deny') {
            expect(v.correctReasons.length).toBeGreaterThan(0);
            // 서류 오류로 거부하거나, 건강 규정(산소포화도)으로 거부하고 해설이 있다
            expect(v.faults.length > 0 || v.healthExplain.length > 0).toBe(true);
          } else {
            expect(v.faults).toHaveLength(0);
          }
          if (v.correctVerdict === 'quarantine') {
            // 해금된 장비로 단서가 나오고, 해설이 있다
            expect(dayDef.tools.length).toBeGreaterThan(0);
            expect(v.healthExplain.length).toBeGreaterThan(0);
          }
          for (const f of v.faults) {
            expect(activeIds.has(f.rule)).toBe(true);
            expect(f.explain.length).toBeGreaterThan(0);
            expect(isPickableKey(v, f.field, dayDef.tools)).toBe(true);
            const partner = f.evidence.find((k) => isPickableKey(v, k, dayDef.tools) && !k.startsWith('rule:'));
            expect(partner).toBeDefined();
            expect(findFault(v, [f.field, partner])).not.toBeNull();
          }
        }
      }
    }
  });

  it('4~6일차 감염자는 모두 증상기이고 해금된 장비로 발견된다 (격리 정답)', () => {
    for (const day of [4, 5, 6]) {
      for (let seed = 0; seed < 200; seed++) {
        for (const v of generateDay(gameData, seed, day).visitors) {
          if (!v.truth.health.infected) continue;
          expect(v.truth.health.stage).toBe('symptomatic');
          expect(v.correctVerdict).toBe('quarantine');
        }
      }
    }
  });

  it('정상 방문자에게는 어떤 지적도 인정되지 않는다', () => {
    const { visitors } = generateDay(gameData, 77, 3);
    for (const v of visitors.filter((x) => x.faults.length === 0)) {
      expect(findFault(v, ['idCard.name', 'statement.name'])).toBeNull();
      expect(findFault(v, ['idCard.expiry', 'ref.today'])).toBeNull();
    }
  });

  it('어떤 판정도 하나만 고집해서는 정답률 60%를 넘지 못한다', () => {
    for (const day of DAYS) {
      const count = { approve: 0, deny: 0, quarantine: 0 };
      let total = 0;
      for (let seed = 0; seed < 100; seed++) {
        for (const v of generateDay(gameData, seed, day).visitors) {
          total++;
          count[v.correctVerdict]++;
        }
      }
      for (const n of Object.values(count)) expect(n / total).toBeLessThan(0.6);
    }
  });

  it('6일차에는 고령자 예외(폐쇄 구역 출신 승인) 방문자가 나온다', () => {
    let exceptions = 0;
    for (let seed = 0; seed < 50; seed++) {
      for (const v of generateDay(gameData, seed, 6).visitors) {
        if (v.role === 'exception') {
          exceptions++;
          expect(v.correctVerdict).toBe('approve');
          expect(v.observed.hasElder).toBe(true);
          expect(gameData.days.days[5].closedDistricts).toContain(v.truth.homeDistrict);
        }
      }
    }
    expect(exceptions).toBeGreaterThan(0);
  });
});

describe('solvability: M3', () => {
  it('9일차 의료인은 유효한 증명서로 폐쇄 구역 예외를 받는다', () => {
    let medicsFromClosed = 0;
    for (let seed = 0; seed < 100; seed++) {
      const { visitors, dayDef } = generateDay(gameData, seed, 9);
      for (const v of visitors.filter((x) => x.role === 'medic')) {
        expect(v.documents.medicalCert).toBeDefined();
        expect(v.correctVerdict).toBe('approve');
        if (dayDef.closedDistricts.includes(v.truth.homeDistrict)) medicsFromClosed++;
      }
    }
    expect(medicsFromClosed).toBeGreaterThan(0);
  });

  it('10일차 위조 의료인 증명서는 거부가 정답이고 규정집 의료기관 목록으로 지적할 수 있다', () => {
    let forged = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const v of generateDay(gameData, seed, 10).visitors) {
        const f = v.faults.find((x) => x.type === 'medForged');
        if (!f) continue;
        forged++;
        expect(v.correctVerdict).toBe('deny');
        expect(v.correctReasons).toContain('위조 의료인 증명서');
        expect(findFault(v, [f.field, 'ref.hospitals'])).toBe(f);
      }
    }
    expect(forged).toBeGreaterThan(0);
  });

  it('7일차부터 장비로 못 잡는 잠복기 감염자는 승인이 정답이고 표시가 붙는다 (6일차까지는 없음)', () => {
    let undetectable = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const v of generateDay(gameData, seed, 7).visitors) {
        if (v.undetectable) {
          undetectable++;
          expect(v.truth.health.stage).toBe('incubating');
          expect(v.correctVerdict).toBe('approve');
        }
      }
    }
    expect(undetectable).toBeGreaterThan(0);
    for (const day of [1, 2, 3, 4, 5, 6]) {
      for (let seed = 0; seed < 50; seed++) {
        expect(generateDay(gameData, seed, day).visitors.some((v) => v.undetectable)).toBe(false);
      }
    }
  });
});
