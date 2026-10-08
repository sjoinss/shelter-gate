import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { createRng } from '../src/core/rng.js';
import { createShelter, runNight } from '../src/core/shelterState.js';
import { judge } from '../src/core/scoring.js';
import { startDay, useTool, currentVisitor, setPowerOut, findFault } from '../src/core/dayFlow.js';
import { generateDay } from '../src/core/visitorGenerator.js';
import { activeRules, buildContext, evaluate } from '../src/core/ruleEngine.js';
import { pickEvent, applyChoice } from '../src/core/events.js';
import { pickEnding, endingStats } from '../src/core/endings.js';

const { balance, events, endings } = gameData;

function find(day, pred, seeds = 400) {
  for (let seed = 0; seed < seeds; seed++) {
    const v = generateDay(gameData, seed, day).visitors.find(pred);
    if (v) return v;
  }
  return null;
}

describe('M4: PCR', () => {
  it('증상 응답 + 키트 음성 + PCR 양성이면 격리가 정답', () => {
    const v = find(11, (x) => x.correctReasons.includes('PCR 양성'));
    expect(v).toBeTruthy();
    expect(v.correctVerdict).toBe('quarantine');
    expect(v.exam.rapidKit).toBe('neg');
    expect(Object.values(v.exam.symptoms).some(Boolean)).toBe(true);
  });

  it('시약이 떨어지면 PCR 대상자는 격리가 정답이 된다', () => {
    const v = find(11, (x) => x.noPcr && x.correctVerdict === 'approve');
    expect(v).toBeTruthy();
    expect(v.noPcr.verdict).toBe('quarantine');
    expect(judge(v, 'approve').kind).toBe('correct');
    expect(judge(v, 'quarantine', null, { reagentsOut: true }).kind).toBe('correct');
    expect(judge(v, 'approve', null, { reagentsOut: true }).kind).toBe('approvedSick');
  });

  it('PCR은 시약을 1개 쓰고 45초가 걸린다. 정전 중에는 쓸 수 없다', () => {
    let s = startDay(gameData, 1, 11, { ...createShelter(balance), reagents: 1 });
    expect(useTool(setPowerOut(s, true), 'pcr', 0, gameData).result).toBeNull();
    const r = useTool(s, 'pcr', 0, gameData);
    expect(r.result).toEqual({ tool: 'pcr', value: currentVisitor(s).exam.pcr });
    expect(r.state.reagentsLeft).toBe(0);
    expect(r.state.penaltySec).toBe(45);
    s = { ...r.state, index: 1 };
    expect(useTool(s, 'pcr', 0, gameData).result).toBeNull();
  });

  it('10일차 밤부터 본부가 시약을 1개씩 보낸다', () => {
    const night = (day) => runNight(createShelter(balance), { day, quarantined: [], approvedInfected: 0 }, createRng(1), balance);
    expect(night(9).shelter.reagents).toBe(0);
    expect(night(10).shelter.reagents).toBe(1);
  });
});

describe('M4: 상부 지침과 규정 충돌 (12일차)', () => {
  it('지침 대상 구역(07)은 폐쇄 구역이어도 승인이 정답이고, 충돌 기록이 남는다', () => {
    const v = find(12, (x) => x.role === 'directive');
    expect(v).toBeTruthy();
    expect(v.documents.idCard.district).toMatch(/^HS-07-/);
    expect(v.correctVerdict).toBe('approve');
    expect(v.conflicts).toEqual([{ winner: 'R-HQ-DIRECTIVE', loser: 'R-DISTRICT-CLOSED', note: expect.any(String) }]);
    const wrong = judge(v, 'deny', '폐쇄 구역 거주');
    expect(wrong.kind).toBe('wronglyDenied');
    expect(wrong.explain.some((t) => t.startsWith('규정 충돌'))).toBe(true);
  });

  it('지침은 다른 거부 규정까지 무효로 하지 않는다', () => {
    const ctx = buildContext(gameData, 12);
    const rules = activeRules(gameData.rules.rules, 12);
    const v = find(12, (x) => x.role === 'directive');
    const expired = { ...v, documents: { ...v.documents, idCard: { ...v.documents.idCard, expiry: ctx.today - 1 } } };
    const r = evaluate(expired, rules, ctx);
    expect(r.verdict).toBe('deny');
    expect(r.reasons.map((x) => x.ruleId)).toEqual(['R-ID-EXPIRY']);
  });

  it('지침은 12일차에만 적용된다', () => {
    expect(activeRules(gameData.rules.rules, 12).some((r) => r.id === 'R-HQ-DIRECTIVE')).toBe(true);
    expect(activeRules(gameData.rules.rules, 13).some((r) => r.id === 'R-HQ-DIRECTIVE')).toBe(false);
  });
});

describe('M4: 격리 해제 확인서 (13일차)', () => {
  it('유효한 확인서를 가진 방문자는 승인, 격리 기간이 5일 미만이면 위조로 거부', () => {
    const ok = find(13, (x) => x.role === 'released');
    expect(ok.documents.releaseCert.released - ok.documents.releaseCert.start).toBeGreaterThanOrEqual(5);
    expect(ok.correctVerdict).toBe('approve');

    const bad = find(13, (x) => x.faults.some((f) => f.type === 'releaseForged'));
    expect(bad).toBeTruthy();
    const f = bad.faults.find((x) => x.type === 'releaseForged');
    expect(bad.documents.releaseCert.released - bad.documents.releaseCert.start).toBeLessThan(5);
    expect(bad.correctReasons).toContain('격리 해제 확인서 위조');
    expect(findFault(bad, ['releaseCert.released', 'releaseCert.start'])).toBe(f);
  });
});

describe('M4: 정전과 밤 사건', () => {
  it('정전이 있던 날 밤에는 환기가 멈춰 확산이 커진다', () => {
    const s = { ...createShelter(balance), occupancy: 60 };
    let normal = 0;
    let outage = 0;
    for (let i = 0; i < 300; i++) {
      normal += runNight(s, { day: 12, quarantined: [], approvedInfected: 3 }, createRng(i), balance).shelter.hiddenInfected;
      outage += runNight(s, { day: 12, quarantined: [], approvedInfected: 3, outage: true }, createRng(i), balance).shelter.hiddenInfected;
    }
    expect(outage).toBeGreaterThan(normal);
  });

  it('10일차 밤 물자 수송 중단: 한도를 줄이면 넘치는 인원은 이송된다', () => {
    const s = { ...createShelter(balance), occupancy: 78, flags: { bribes: 0, ruleBreaks: 0, eventsSeen: ['outbreak'] } };
    const ev = pickEvent(s, 10, createRng(1), events, balance);
    expect(ev.id).toBe('shortage');
    const r = applyChoice(s, ev, 0, createRng(1));
    expect(r.shelter.capacity).toBe(70);
    expect(r.shelter.occupancy).toBe(70);
  });

  it('14일차 밤에는 최종 사건이 나온다', () => {
    const s = createShelter(balance);
    expect(pickEvent(s, 14, createRng(1), events, balance).id).toBe('final');
  });
});

describe('M4: 엔딩 분기', () => {
  const day = (over = {}) => ({
    day: 1, processed: 10, correct: 8, mistakes: 2, unprocessed: 0, approvedPeople: 6, trustDelta: 0,
    infections: 0, majors: 0, denied: 4, hiddenAdmitted: 0, ...over,
  });
  const shelterWith = (over = {}) => ({ ...createShelter(balance), occupancy: 60, trust: 65, ...over });
  const ending = (shelter, history) => pickEnding(shelter, history, endings).ending.id;

  it('신뢰도 0 또는 감염 폭증이면 붕괴', () => {
    expect(ending(shelterWith({ trust: 0 }), [day()])).toBe('collapse');
    expect(ending(shelterWith(), [day({ infections: 30 })])).toBe('collapse');
  });

  it('뇌물 2회 이상이면 부패 (붕괴가 아니면)', () => {
    expect(ending(shelterWith({ flags: { bribes: 2, ruleBreaks: 0, eventsSeen: [] } }), [day()])).toBe('corrupt');
  });

  it('규정을 어기고 많이 들였지만 대피소가 위태로우면 규정 위반자', () => {
    const s = shelterWith({ trust: 40, flags: { bribes: 0, ruleBreaks: 3, eventsSeen: [] } });
    expect(ending(s, [day()])).toBe('ruleBreaker');
  });

  it('거의 아무도 들이지 않았으면 엄격한 수문장', () => {
    expect(ending(shelterWith({ occupancy: 10 }), [day()])).toBe('strict');
    expect(ending(shelterWith(), [day({ denied: 8 })])).toBe('strict');
  });

  it('그 밖에는 유지', () => {
    expect(ending(shelterWith(), [day()])).toBe('maintained');
  });

  it('누적 통계', () => {
    const st = endingStats(shelterWith(), [day({ infections: 2 }), day({ infections: 3, denied: 2 })]);
    expect(st.infections).toBe(5);
    expect(st.denyRatio).toBeCloseTo(6 / 20);
  });
});
