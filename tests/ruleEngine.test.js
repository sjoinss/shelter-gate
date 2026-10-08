import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { activeRules, buildContext, evaluate } from '../src/core/ruleEngine.js';

const allRules = gameData.rules.rules;

function makeVisitor(overrides = {}, day = 3) {
  const ctx = buildContext(gameData, day);
  const appearance = { height: '보통', build: '마른', hair: '붉은 곱슬머리', feature: '들창코' };
  return {
    documents: {
      idCard: {
        name: '김민준',
        sex: '남',
        age: 41,
        district: 'HS-03-B',
        issued: 5,
        expiry: ctx.today + 3,
        appearance: { ...appearance },
      },
      permit: { name: '김민준', issued: ctx.today - 1, validUntil: ctx.today + 2, shelter: '제3 지하 대피소' },
      ...overrides.documents,
    },
    observed: { appearance: { ...appearance }, groupSize: 1, ...overrides.observed },
    statement: { name: '김민준', district: '동림구 B블록', groupSize: 1, ...overrides.statement },
  };
}

function reasonsFor(v, day = 3) {
  return evaluate(v, activeRules(allRules, day), buildContext(gameData, day)).reasons.map((r) => r.ruleId);
}

describe('ruleEngine', () => {
  it('정상 방문자는 승인', () => {
    const r = evaluate(makeVisitor(), activeRules(allRules, 3), buildContext(gameData, 3));
    expect(r).toEqual({ verdict: 'approve', reasons: [], violated: [] });
  });

  it('활성 규정은 since/until을 따른다', () => {
    expect(activeRules(allRules, 1).map((r) => r.id).sort()).toEqual(['R-APPEARANCE', 'R-ID-EXPIRY', 'R-NAME-MATCH']);
    expect(activeRules(allRules, 2)).toHaveLength(5);
    expect(activeRules(allRules, 3)).toHaveLength(8);
    const withUntil = [{ id: 'X', since: 1, until: 2, check: {} }];
    expect(activeRules(withUntil, 1)).toHaveLength(1);
    expect(activeRules(withUntil, 2)).toHaveLength(0);
  });

  it('대피카드 만료: 오늘보다 이전이면 위반, 당일은 유효', () => {
    const today = buildContext(gameData, 3).today;
    const base = makeVisitor().documents.idCard;
    expect(reasonsFor(makeVisitor({ documents: { idCard: { ...base, expiry: today - 1 } } }))).toEqual(['R-ID-EXPIRY']);
    expect(reasonsFor(makeVisitor({ documents: { idCard: { ...base, expiry: today } } }))).toEqual([]);
  });

  it('이름 불일치: 진술 또는 허가증과 다르면 위반', () => {
    expect(reasonsFor(makeVisitor({ statement: { name: '김민중' } }))).toEqual(['R-NAME-MATCH']);
    const permit = { ...makeVisitor().documents.permit, name: '김민중' };
    expect(reasonsFor(makeVisitor({ documents: { permit } }))).toEqual(['R-NAME-MATCH']);
  });

  it('인상착의: 한 항목이라도 다르면 위반', () => {
    const obs = { appearance: { height: '보통', build: '마른', hair: '짧은 백발', feature: '들창코' } };
    expect(reasonsFor(makeVisitor({ observed: obs }))).toEqual(['R-APPEARANCE']);
  });

  it('구역 코드: 목록에 없거나 형식 오류면 위반', () => {
    const base = makeVisitor().documents.idCard;
    for (const code of ['HS-11-A', 'HS-02-D', 'HS-3-B', 'HS03-B', 'HS-03-b', 'SH-03-B']) {
      expect(reasonsFor(makeVisitor({ documents: { idCard: { ...base, district: code } } }))).toContain('R-DISTRICT-CODE');
    }
  });

  it('폐쇄 구역: 3일차에는 05, 07 구역이 폐쇄', () => {
    const base = makeVisitor().documents.idCard;
    expect(reasonsFor(makeVisitor({ documents: { idCard: { ...base, district: 'HS-07-A' } } }))).toEqual([
      'R-DISTRICT-CLOSED',
    ]);
    expect(reasonsFor(makeVisitor({ documents: { idCard: { ...base, district: 'HS-07-A' } } }), 2)).toEqual([]);
  });

  it('허가증 날짜·허가 대피소', () => {
    const today = buildContext(gameData, 3).today;
    const p = makeVisitor().documents.permit;
    expect(reasonsFor(makeVisitor({ documents: { permit: { ...p, issued: today + 1 } } }))).toEqual(['R-PERMIT-DATE']);
    expect(reasonsFor(makeVisitor({ documents: { permit: { ...p, validUntil: today - 1 } } }))).toEqual([
      'R-PERMIT-DATE',
    ]);
    expect(reasonsFor(makeVisitor({ documents: { permit: { ...p, shelter: '제5 지하 대피소' } } }))).toEqual([
      'R-PERMIT-SHELTER',
    ]);
  });

  it('동행 인원: 명부 총원과 실제 인원이 다르면 위반, 명부 없으면 미적용', () => {
    const companionList = { applicant: '김민준', members: [{ name: '김서연', age: 9, relation: '자녀' }], total: 2 };
    expect(reasonsFor(makeVisitor({ documents: { companionList }, observed: { groupSize: 2 } }))).toEqual([]);
    expect(reasonsFor(makeVisitor({ documents: { companionList }, observed: { groupSize: 3 } }))).toEqual([
      'R-COMPANION-COUNT',
    ]);
    expect(reasonsFor(makeVisitor({ observed: { groupSize: 3 } }))).toEqual([]);
  });

  it('해금 전 규정은 적용하지 않는다 (1일차에 허가증 오류가 있어도 승인)', () => {
    const p = { ...makeVisitor().documents.permit, shelter: '제5 지하 대피소' };
    expect(reasonsFor(makeVisitor({ documents: { permit: p } }), 1)).toEqual([]);
  });

  it('priority가 높은 규정의 판정이 우선한다', () => {
    const rules = [
      { id: 'LOW', since: 1, priority: 0, verdict: 'deny', reason: 'a', check: { op: 'notEqual', field: 'idCard.name', ref: 'x' } },
      { id: 'HIGH', since: 1, priority: 5, verdict: 'quarantine', reason: 'b', check: { op: 'notEqual', field: 'idCard.name', ref: 'x' } },
    ];
    const r = evaluate(makeVisitor(), activeRules(rules, 1), { x: '다른 이름' });
    expect(r.verdict).toBe('quarantine');
    expect(r.reasons.map((x) => x.ruleId)).toEqual(['HIGH']); // 정답 사유는 이긴 판정의 규정만
    expect(r.violated).toEqual(['HIGH', 'LOW']);
  });

  // ── M2: 건강 규정 ──
  function withExam(exam, day, extra = {}) {
    const v = makeVisitor(extra, day);
    v.exam = {
      temperature: { first: 36.5, recheck: 36.5 },
      temperatureFinal: 36.5,
      symptoms: { cough: false, fever: false, vomiting: false, breathless: false },
      ...exam,
    };
    return evaluate(v, activeRules(allRules, day), buildContext(gameData, day));
  }

  it('발열: 최종 체온 37.5°C 이상이면 격리 (4일차부터)', () => {
    expect(withExam({ temperatureFinal: 37.5 }, 4).verdict).toBe('quarantine');
    expect(withExam({ temperatureFinal: 37.4 }, 4).verdict).toBe('approve');
    expect(withExam({ temperatureFinal: 38.5 }, 3).verdict).toBe('approve'); // 해금 전
  });

  it('증상 응답이 하나라도 있으면 격리 (5일차부터)', () => {
    const symptoms = { cough: true, fever: false, vomiting: false, breathless: false };
    expect(withExam({ symptoms }, 5).verdict).toBe('quarantine');
    expect(withExam({ symptoms }, 4).verdict).toBe('approve');
  });

  it('서류 문제(거부)는 건강 문제(격리)보다 우선한다', () => {
    const base = makeVisitor({}, 4).documents.idCard;
    const today = buildContext(gameData, 4).today;
    const r = withExam({ temperatureFinal: 38.2 }, 4, { documents: { idCard: { ...base, expiry: today - 1 } } });
    expect(r.verdict).toBe('deny');
    expect(r.reasons.map((x) => x.ruleId)).toEqual(['R-ID-EXPIRY']);
    expect(r.violated).toContain('R-TEMP-QUARANTINE');
  });

  it('건강 기록 모순: 기록된 증상을 문답에서 부정하면 거부', () => {
    const healthRecord = { name: '김민준', recentSymptom: 'cough', recentVisit: 12 };
    const deny = { cough: false, fever: false, vomiting: false, breathless: false };
    expect(withExam({ symptoms: deny }, 5, { documents: { healthRecord } }).reasons.map((r) => r.ruleId)).toEqual([
      'R-HEALTH-CONTRADICTION',
    ]);
    // 정직하게 답하면 모순이 아니라 증상 응답 → 격리
    expect(withExam({ symptoms: { ...deny, cough: true } }, 5, { documents: { healthRecord } }).verdict).toBe('quarantine');
  });

  it('보호자 없는 미성년 (6일차부터)', () => {
    const base = makeVisitor({}, 6).documents.idCard;
    const minor ={ documents: { idCard: { ...base, age: 13 } }, observed: { adultCompanions: 0 } };
    expect(withExam({}, 6, minor).reasons.map((r) => r.ruleId)).toEqual(['R-MINOR-ALONE']);
    expect(withExam({}, 6, { ...minor, observed: { adultCompanions: 1 } }).verdict).toBe('approve');
    expect(withExam({}, 5, minor).verdict).toBe('approve');
  });

  it('고령자 예외: 6일차부터 70세 이상이 일행에 있으면 폐쇄 구역도 허가 (unless)', () => {
    const base = makeVisitor({}, 6).documents.idCard;
    const closed ={ documents: { idCard: { ...base, district: 'HS-07-A' } } };
    expect(withExam({}, 5, { ...closed, observed: { hasElder: true } }).verdict).toBe('deny');
    expect(withExam({}, 6, { ...closed, observed: { hasElder: true } }).verdict).toBe('approve');
    expect(withExam({}, 6, { ...closed, observed: { hasElder: false } }).verdict).toBe('deny');
  });
});
