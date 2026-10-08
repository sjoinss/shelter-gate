import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import {
  createShelter,
  applyDaySummary,
  canAdmit,
  isGameOver,
  runNight,
  quarantineUsed,
  quarantineFree,
} from '../src/core/shelterState.js';
import { judge, summarizeDay } from '../src/core/scoring.js';
import { createRng } from '../src/core/rng.js';
import {
  startDay,
  decide,
  ask,
  point,
  dayResult,
  currentVisitor,
  canQuarantineCurrent,
  denyReasons,
} from '../src/core/dayFlow.js';

const { balance } = gameData;

function fakeVisitor(correctVerdict, reasons = []) {
  return {
    id: 'x',
    truth: { name: '김민준' },
    documents: { idCard: { name: '김민준' } },
    faults: reasons.map((r) => ({ explain: `${r} 설명` })),
    correctVerdict,
    correctReasons: reasons,
  };
}

describe('scoring.judge', () => {
  it('정상인 승인 = 정확, 거부 = 정상인 거부', () => {
    expect(judge(fakeVisitor('approve'), 'approve').kind).toBe('correct');
    expect(judge(fakeVisitor('approve'), 'deny', '이름 불일치').kind).toBe('wronglyDenied');
  });
  it('오류 방문자: 맞는 사유로 거부 = 정확, 틀린 사유 = 사유 오류, 승인 = 오류 승인', () => {
    const v = fakeVisitor('deny', ['대피카드 만료']);
    expect(judge(v, 'deny', '대피카드 만료').kind).toBe('correct');
    expect(judge(v, 'deny', '이름 불일치').kind).toBe('wrongReason');
    expect(judge(v, 'approve').kind).toBe('approvedFaulty');
    expect(judge(v, 'approve').explain).toEqual(['대피카드 만료 설명']);
  });
});

describe('scoring.summarizeDay', () => {
  const ok = { correct: true, kind: 'correct' };
  const bad = { correct: false, kind: 'wronglyDenied' };

  it('오심 2회까지는 경고, 3회째부터 벌점', () => {
    const s2 = summarizeDay({ day: 1, judgements: [ok, bad, bad], unprocessed: 0, approvedPeople: 1 }, balance);
    expect(s2.warnings).toBe(2);
    expect(s2.penaltyPoints).toBe(0);
    const s3 = summarizeDay({ day: 1, judgements: [ok, ok, ok, ok, bad, bad, bad], unprocessed: 0, approvedPeople: 1 }, balance);
    expect(s3.penalized).toBe(1);
    expect(s3.penaltyPoints).toBe(balance.scoring.penaltyPerMistake);
    expect(s3.supplyEarned).toBe(4 * balance.scoring.supplyPerCorrect - balance.scoring.penaltyPerMistake);
  });

  it('신뢰도: 오심 종류별 감소 + 미처리 감소, 완벽한 날은 보너스', () => {
    const t = balance.scoring.trust;
    const s = summarizeDay({ day: 1, judgements: [ok, bad], unprocessed: 2, approvedPeople: 0 }, balance);
    expect(s.trustDelta).toBe(t.wronglyDenied + 2 * t.unprocessed);
    const perfect = summarizeDay({ day: 1, judgements: [ok, ok], unprocessed: 0, approvedPeople: 2 }, balance);
    expect(perfect.trustDelta).toBe(t.perfectDayBonus);
  });

  it('보급 포인트는 음수가 되지 않는다', () => {
    const s = summarizeDay({ day: 1, judgements: [bad, bad, bad, bad, bad], unprocessed: 0, approvedPeople: 0 }, balance);
    expect(s.supplyEarned).toBe(0);
  });
});

describe('shelterState', () => {
  it('초기값은 balance.json을 따른다', () => {
    const s = createShelter(balance);
    expect(s).toMatchObject({ capacity: 80, occupancy: 0, quarantineSeats: 6, trust: balance.shelter.trustStart });
  });

  it('정산 반영: 수용 인원 증가, 신뢰도 0~100 범위 유지, 보급 포인트 누적', () => {
    const s = createShelter(balance);
    const next = applyDaySummary(s, { approvedPeople: 5, trustDelta: -500, supplyEarned: 3 }, balance);
    expect(next.occupancy).toBe(5);
    expect(next.trust).toBe(0);
    expect(isGameOver(next)).toBe(true);
    expect(next.supplyPoints).toBe(3);
    const up = applyDaySummary(s, { approvedPeople: 0, trustDelta: 500, supplyEarned: 0 }, balance);
    expect(up.trust).toBe(100);
  });

  it('수용 한도를 넘는 입장은 불가', () => {
    expect(canAdmit({ capacity: 80, occupancy: 78 }, 2)).toBe(true);
    expect(canAdmit({ capacity: 80, occupancy: 79 }, 2)).toBe(false);
  });
});

describe('scoring: M2 격리 판정', () => {
  const sick = { ...fakeVisitor('quarantine', ['발열']), healthExplain: ['체온 38.2°C'] };
  it('격리 대상: 격리 = 정확, 승인 = 중대 오심, 거부 = 격리 대상 거부', () => {
    expect(judge(sick, 'quarantine').kind).toBe('correct');
    expect(judge(sick, 'approve').kind).toBe('approvedSick');
    expect(judge(sick, 'deny', '대피카드 만료').kind).toBe('deniedSick');
  });
  it('격리실이 모자라면 "격리실 만석"으로 거부하는 것이 정답', () => {
    expect(judge(sick, 'deny', '격리실 만석', { quarantineFull: true }).kind).toBe('correct');
    expect(judge(sick, 'approve', null, { quarantineFull: true }).kind).toBe('approvedSick');
  });
  it('정상인·서류 오류 방문자를 격리하면 격리 오판', () => {
    expect(judge(fakeVisitor('approve'), 'quarantine').kind).toBe('wrongQuarantine');
    expect(judge(fakeVisitor('deny', ['대피카드 만료']), 'quarantine').kind).toBe('wrongQuarantine');
  });
  it('중대 오심은 경고 없이 바로 벌점', () => {
    const major = { correct: false, kind: 'approvedSick' };
    const s = summarizeDay({ day: 4, judgements: [major], unprocessed: 0, approvedPeople: 1 }, balance);
    expect(s.warnings).toBe(0);
    expect(s.majors).toBe(1);
    expect(s.penaltyPoints).toBe(balance.scoring.penaltyMajor);
    expect(s.trustDelta).toBe(balance.scoring.trust.approvedSick);
  });
});

describe('shelterState.runNight', () => {
  const night = (shelter, input, seed = 1) => runNight(shelter, input, createRng(seed), balance);

  it('오늘 격리한 사람을 격리실에 등록한다', () => {
    const s = createShelter(balance);
    const r = night(s, { day: 4, quarantined: [{ name: '김민준', groupSize: 2, infected: true }], approvedInfected: 0 });
    expect(quarantineUsed(r.shelter)).toBe(2);
    expect(quarantineFree(r.shelter)).toBe(4);
  });

  it('비감염 격리자는 2~3일 뒤 대피소에 입장, 감염 격리자는 이송될 때까지 유지', () => {
    let s = { ...createShelter(balance), occupancy: 10 };
    s = night(s, {
      day: 4,
      quarantined: [
        { name: '이서연', groupSize: 1, infected: false },
        { name: '박도윤', groupSize: 1, infected: true },
      ],
      approvedInfected: 0,
    }).shelter;
    for (let day = 5; day <= 7; day++) s = night(s, { day, quarantined: [], approvedInfected: 0 }).shelter;
    expect(s.occupancy).toBe(11); // 이서연 입장
    expect(s.quarantine.map((e) => e.name)).toEqual(['박도윤']);
    s = night(s, { day: 8, quarantined: [], approvedInfected: 0 }).shelter; // 4일 뒤 이송
    expect(s.quarantine).toHaveLength(0);
  });

  it('승인한 감염자는 밤에 발견되어 신뢰도를 깎고, 격리실로 옮겨진다', () => {
    const s = { ...createShelter(balance), occupancy: 40 };
    const r = night(s, { day: 4, quarantined: [], approvedInfected: 1 });
    expect(r.found).toBe(1);
    expect(r.shelter.occupancy).toBe(39);
    expect(quarantineUsed(r.shelter)).toBe(1);
    expect(r.shelter.trust).toBeLessThan(s.trust);
    expect(r.report.some((l) => l.kind === 'warn')).toBe(true);
  });

  it('격리실이 가득 차면 발견된 감염자는 일반 구역에 남아 계속 퍼진다', () => {
    const full = { ...createShelter(balance), occupancy: 60, quarantine: [{ name: 'x', groupSize: 6, infected: true, dayIn: 3, releaseDay: 7, transferDay: 7 }] };
    const r = night(full, { day: 4, quarantined: [], approvedInfected: 2 });
    expect(r.shelter.occupancy).toBe(60);
    expect(r.shelter.hiddenInfected).toBeGreaterThanOrEqual(2);
  });

  it('아무 일도 없으면 "특이 사항 없음"', () => {
    const r = night(createShelter(balance), { day: 1, quarantined: [], approvedInfected: 0 });
    expect(r.report).toEqual([{ kind: 'ok', text: '특이 사항 없음.' }]);
  });
});

describe('dayFlow', () => {
  it('격리실 자리가 모자라면 격리 판정을 할 수 없다', () => {
    let s = startDay(gameData, 11, 4, createShelter(balance));
    s = { ...s, quarantineFree: 0 };
    expect(canQuarantineCurrent(s)).toBe(false);
    expect(decide(s, 'quarantine').judgement).toBeNull();
    expect(denyReasons(s)).toContain('격리실 만석');
  });

  it('정답대로 처리하면 오심 0, 모든 방문자 처리', () => {
    let s = startDay(gameData, 123, 3, createShelter(balance));
    while (currentVisitor(s)) {
      const v = currentVisitor(s);
      ({ state: s } = decide(s, v.correctVerdict, v.correctReasons[0] ?? null));
    }
    const result = summarizeDay(dayResult(s), balance);
    expect(result.mistakes).toHaveLength(0);
    expect(result.unprocessed).toBe(0);
    expect(s.ended).toBe(true);
  });

  it('질문과 오지적은 시간 패널티, 같은 질문은 한 번만', () => {
    let s = startDay(gameData, 5, 1, createShelter(balance));
    s = ask(s, 'name', gameData);
    s = ask(s, 'name', gameData);
    expect(s.penaltySec).toBe(balance.actions.questionCostSec);
    s = ask(s, 'group', gameData); // 1일차에는 없는 질문
    expect(s.penaltySec).toBe(balance.actions.questionCostSec);
    const r = point(s, ['idCard.sex', 'observed.groupSize'], gameData);
    expect(r.fault).toBeNull();
    expect(r.state.penaltySec).toBe(balance.actions.questionCostSec + balance.actions.wrongPointCostSec);
  });

  it('올바른 지적은 인정된다', () => {
    const s = startDay(gameData, 8, 1, createShelter(balance));
    const idx = s.visitors.findIndex((v) => v.faults.length > 0);
    const state = { ...s, index: idx };
    const f = state.visitors[idx].faults[0];
    const r = point(state, [f.evidence[0], f.field], gameData);
    expect(r.fault).toBe(f);
    expect(r.state.pointed[state.visitors[idx].id]).toContain(f.rule);
  });
});
