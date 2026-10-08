// 하루 진행 상태 머신 (심사 단계). 순수 함수: 새 상태를 반환한다.
// 실시간 경과는 UI 타이머가 재고, 여기서는 행동에 따른 시간 패널티(penaltySec)만 누적한다.
// 게임 시간 = 실시간 경과 + penaltySec
import { generateDay } from './visitorGenerator.js';
import { judge, QUARANTINE_FULL_REASON } from './scoring.js';
import { canAdmit, quarantineFree } from './shelterState.js';

export function startDay(data, baseSeed, day, shelter) {
  const { dayDef, ctx, rules, visitors } = generateDay(data, baseSeed, day);
  return {
    day,
    today: ctx.today,
    dayDef,
    ctx,
    rules,
    visitors,
    index: 0,
    asked: {}, // visitorId → 질문 id 목록
    exams: {}, // visitorId → { tempAt, recheckDone, symptomsDone }
    pointed: {}, // visitorId → 인정된 지적의 rule id 목록
    judgements: [],
    approvedPeople: 0,
    approvedInfected: 0,
    quarantined: [], // { name, groupSize, infected }
    penaltySec: 0,
    occupancy: shelter.occupancy,
    capacity: shelter.capacity,
    quarantineFree: quarantineFree(shelter),
    quarantineSeats: shelter.quarantineSeats,
    quarantineEnabled: rules.some((r) => r.verdict === 'quarantine'),
    kitsLeft: shelter.kits ?? 0,
    kitsUsed: 0,
    reagentsLeft: shelter.reagents ?? 0,
    powerOut: false, // 정전 중 (전기 장비 사용 불가)
    medicsAdmitted: 0,
    ended: false,
  };
}

export function currentVisitor(state) {
  if (state.ended) return null;
  return state.visitors[state.index] ?? null;
}

export function remainingVisitors(state) {
  return Math.max(0, state.visitors.length - state.index);
}

export function gameTime(state, realElapsedSec) {
  return realElapsedSec + state.penaltySec;
}

/** 질문. 이미 물은 질문이면 상태 그대로 */
export function ask(state, question, data) {
  const v = currentVisitor(state);
  if (!v || !state.dayDef.questions.includes(question)) return state;
  const asked = state.asked[v.id] ?? [];
  if (asked.includes(question)) return state;
  return {
    ...state,
    asked: { ...state.asked, [v.id]: [...asked, question] },
    penaltySec: state.penaltySec + data.balance.actions.questionCostSec,
  };
}

/** 체온 재측정이 가능해지는 게임 시각 (아직 첫 측정 전이거나 이미 재측정했으면 null) */
export function recheckReadyAt(state, data) {
  const v = currentVisitor(state);
  const rec = v && state.exams[v.id];
  if (!rec || rec.tempAt == null || rec.recheckDone) return null;
  return rec.tempAt + data.balance.tools.temperature.recheckDelaySec;
}

/**
 * 검사 장비 사용 → { state, result }
 *  tool: 'temperature' (첫 측정 또는 재측정) | 'symptoms'
 *  result: { tool: 'temperature', value, recheck: boolean } | { tool: 'symptoms', answers } | null
 * 결과는 생성 시 확정된 값을 꺼내 보여 줄 뿐이다 (재검사로 바뀌지 않음).
 */
export function useTool(state, tool, realElapsedSec, data) {
  const v = currentVisitor(state);
  if (!v || !state.dayDef.tools.includes(tool)) return { state, result: null };
  if (state.powerOut && data.balance.outage.poweredTools.includes(tool)) return { state, result: null };
  const rec = state.exams[v.id] ?? {};
  const cost = data.balance.tools[tool].costSec;
  const now = gameTime(state, realElapsedSec) + cost;
  let nextRec;
  let result;

  if (tool === 'temperature') {
    if (rec.tempAt == null) {
      nextRec = { ...rec, tempAt: now };
      result = { tool, value: v.exam.temperature.first, recheck: false };
    } else {
      const ready = recheckReadyAt(state, data);
      if (ready == null || gameTime(state, realElapsedSec) < ready) return { state, result: null };
      nextRec = { ...rec, recheckDone: true };
      result = { tool, value: v.exam.temperature.recheck, recheck: true };
    }
  } else if (tool === 'symptoms') {
    if (rec.symptomsDone) return { state, result: null };
    nextRec = { ...rec, symptomsDone: true };
    result = { tool, answers: { ...v.exam.symptoms } };
  } else if (tool === 'rapidKit') {
    if (rec.kitDone || state.kitsLeft <= 0) return { state, result: null };
    nextRec = { ...rec, kitDone: true };
    result = { tool, value: v.exam.rapidKit };
  } else if (tool === 'spo2') {
    if (rec.spo2Done) return { state, result: null };
    nextRec = { ...rec, spo2Done: true };
    result = { tool, value: v.exam.spo2 };
  } else if (tool === 'pcr') {
    if (rec.pcrDone || state.reagentsLeft <= 0) return { state, result: null };
    nextRec = { ...rec, pcrDone: true };
    result = { tool, value: v.exam.pcr };
  } else if (tool === 'breathing') {
    if (rec.breathingDone) return { state, result: null };
    nextRec = { ...rec, breathingDone: true };
    result = { tool, value: v.exam.breathing };
  } else {
    return { state, result: null };
  }

  const next = { ...state, exams: { ...state.exams, [v.id]: nextRec }, penaltySec: state.penaltySec + cost };
  if (tool === 'rapidKit') {
    next.kitsLeft = state.kitsLeft - 1;
    next.kitsUsed = state.kitsUsed + 1;
  }
  if (tool === 'pcr') next.reagentsLeft = state.reagentsLeft - 1;
  return { state: next, result };
}

/** 두 항목이 어떤 오류의 (잘못된 항목, 근거) 쌍인지 */
export function findFault(visitor, keys) {
  if (keys.length !== 2 || keys[0] === keys[1]) return null;
  const [a, b] = keys;
  return (
    visitor.faults.find(
      (f) => (f.field === a && f.evidence.includes(b)) || (f.field === b && f.evidence.includes(a)),
    ) ?? null
  );
}

/** 불일치 지적 → { state, fault } (fault가 null이면 오지적, 시간 패널티) */
export function point(state, keys, data) {
  const v = currentVisitor(state);
  if (!v) return { state, fault: null };
  const fault = findFault(v, keys);
  if (!fault) {
    return { state: { ...state, penaltySec: state.penaltySec + data.balance.actions.wrongPointCostSec }, fault: null };
  }
  const prev = state.pointed[v.id] ?? [];
  return {
    state: { ...state, pointed: { ...state.pointed, [v.id]: prev.includes(fault.rule) ? prev : [...prev, fault.rule] } },
    fault,
  };
}

/** 현재 방문자 일행이 수용 가능한지 */
export function canApproveCurrent(state) {
  const v = currentVisitor(state);
  if (!v) return false;
  return canAdmit({ capacity: state.capacity, occupancy: state.occupancy }, v.observed.groupSize);
}

/** 현재 방문자 일행을 격리실에 넣을 수 있는지 */
export function canQuarantineCurrent(state) {
  const v = currentVisitor(state);
  if (!v || !state.quarantineEnabled) return false;
  return state.quarantineFree >= v.observed.groupSize;
}

/** 판정 → { state, judgement } */
export function decide(state, verdict, reason = null) {
  const v = currentVisitor(state);
  if (!v) return { state, judgement: null };
  if (verdict === 'approve' && !canApproveCurrent(state)) return { state, judgement: null };
  if (verdict === 'quarantine' && !canQuarantineCurrent(state)) return { state, judgement: null };

  const kitsOut = state.kitsLeft <= 0 && !state.exams[v.id]?.kitDone;
  const reagentsOut = state.reagentsLeft <= 0 && !state.exams[v.id]?.pcrDone;
  const judgement = judge(v, verdict, reason, { quarantineFull: !canQuarantineCurrent(state), kitsOut, reagentsOut });
  const size = v.observed.groupSize;
  const infected = v.truth.health?.infected ?? false;
  const next = {
    ...state,
    index: state.index + 1,
    judgements: [...state.judgements, judgement],
  };
  if (verdict === 'approve') {
    next.approvedPeople = state.approvedPeople + size;
    next.occupancy = state.occupancy + size;
    next.approvedInfected = state.approvedInfected + (infected ? 1 : 0);
    if (v.truth.medic) next.medicsAdmitted = state.medicsAdmitted + 1;
  }
  if (verdict === 'quarantine') {
    next.quarantineFree = state.quarantineFree - size;
    next.quarantined = [...state.quarantined, { name: judgement.name, groupSize: size, infected }];
  }
  if (next.index >= next.visitors.length) next.ended = true;
  return { state: next, judgement };
}

/** 정전 시작/끝 (UI 타이머가 호출) */
export function setPowerOut(state, on) {
  return { ...state, powerOut: on };
}

export function endDay(state) {
  return { ...state, ended: true };
}

/** 정산·밤 처리 입력값 */
export function dayResult(state) {
  return {
    day: state.day,
    judgements: state.judgements,
    unprocessed: state.visitors.length - state.judgements.length,
    approvedPeople: state.approvedPeople,
    approvedInfected: state.approvedInfected,
    quarantined: state.quarantined,
    kitsLeft: state.kitsLeft,
    reagentsLeft: state.reagentsLeft,
    medicsAdmitted: state.medicsAdmitted,
    denied: state.judgements.filter((j) => j.verdict === 'deny').length,
    outage: !!state.dayDef.outage,
    // 잠복기라 장비로 못 잡고 승인한 감염자 (정산 안내용)
    undetected: state.judgements
      .map((j, i) => ({ j, v: state.visitors[i] }))
      .filter(({ j, v }) => j.verdict === 'approve' && v.undetectable)
      .map(({ j }) => j.name),
  };
}

/** 오늘 고를 수 있는 거부 사유 (활성 규정의 사유 + 격리실 만석) */
export function denyReasons(state) {
  const reasons = state.rules.filter((r) => r.verdict === 'deny').map((r) => r.reason);
  if (state.quarantineEnabled) reasons.push(QUARANTINE_FULL_REASON);
  return [...new Set(reasons)];
}
