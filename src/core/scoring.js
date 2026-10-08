// 판정 채점과 하루 정산 (10장). UI 비의존.

export const QUARANTINE_FULL_REASON = '격리실 만석';

/** 중대 오심: 경고 면제 없이 즉시 벌점 */
export const MAJOR_KINDS = new Set(['approvedSick']);

export const KIND_LABEL = {
  correct: '정확',
  wronglyDenied: '정상인 거부',
  approvedFaulty: '서류 오류 방문자 승인',
  wrongReason: '거부 사유 오류',
  wrongQuarantine: '격리 오판',
  deniedSick: '격리 대상 거부',
  approvedSick: '격리 대상 승인 (중대 오심)',
};

/**
 * @param visitor 방문자
 * @param verdict 'approve' | 'deny' | 'quarantine'
 * @param reason 거부 사유 (deny일 때)
 * @param opts.quarantineFull 판정 시점에 이 일행을 받을 격리실 자리가 없었는지
 * @param opts.kitsOut 키트가 떨어져 이 방문자를 키트로 검사할 수 없었는지
 * @param opts.reagentsOut 시약이 떨어져 이 방문자를 PCR로 검사할 수 없었는지
 */
export function judge(visitor, verdict, reason = null, { quarantineFull = false, kitsOut = false, reagentsOut = false } = {}) {
  const base = { visitorId: visitor.id, name: visitor.documents.idCard?.name ?? visitor.truth.name, verdict, reason };
  let expected = visitor.correctVerdict;
  let reasons = visitor.correctReasons;
  let extra = [];
  // 키트가 없으면 증상 응답자는 격리 (키트 결과를 양성으로 간주)
  if (kitsOut && visitor.noKit) {
    expected = visitor.noKit.verdict;
    reasons = visitor.noKit.reasons;
    extra = ['키트가 떨어져 검사할 수 없었습니다. 이 경우 증상 응답자는 격리합니다.'];
  } else if (reagentsOut && visitor.noPcr) {
    expected = visitor.noPcr.verdict;
    reasons = visitor.noPcr.reasons;
    extra = ['시약이 떨어져 PCR을 할 수 없었습니다. 이 경우 증상 응답이 있고 키트가 음성인 사람은 격리합니다.'];
  }
  // 규정 충돌로 정답이 바뀐 경우, 어느 규정이 우선했는지 해설에 붙인다
  for (const c of visitor.conflicts ?? []) if (c.note) extra.push(`규정 충돌: ${c.note}`);
  // 격리 대상인데 격리실이 모자라면 '격리실 만석'으로 거부하는 것이 정답
  if (expected === 'quarantine' && quarantineFull) {
    expected = 'deny';
    reasons = [QUARANTINE_FULL_REASON];
  }
  const faultExplain = visitor.faults.map((f) => f.explain);
  const healthExplain = [...extra, ...(visitor.healthExplain ?? [])];
  const ok = { ...base, correct: true, kind: 'correct', explain: [] };
  const miss = (kind, explain) => ({ ...base, correct: false, kind, explain });

  if (expected === 'approve') {
    if (verdict === 'approve') return ok;
    if (verdict === 'quarantine') {
      return miss('wrongQuarantine', ['격리할 이유가 없었습니다. 승인해야 했습니다.', ...healthExplain]);
    }
    return miss('wronglyDenied', ['이 방문자는 오늘의 모든 규정을 충족했습니다. 승인해야 했습니다.', ...healthExplain]);
  }

  if (expected === 'quarantine') {
    if (verdict === 'quarantine') return ok;
    if (verdict === 'approve') return miss('approvedSick', healthExplain);
    return miss('deniedSick', ['서류에는 문제가 없고 건강 검사로 격리 대상이었습니다. 격리해야 했습니다.', ...healthExplain]);
  }

  // expected === 'deny'
  const denyExplain = reasons.includes(QUARANTINE_FULL_REASON)
    ? ['격리 대상이었지만 격리실 자리가 모자랐습니다. 이 경우 \'격리실 만석\'으로 거부합니다.', ...healthExplain]
    : faultExplain;
  if (verdict === 'approve') {
    return miss(reasons.includes(QUARANTINE_FULL_REASON) ? 'approvedSick' : 'approvedFaulty', denyExplain);
  }
  if (verdict === 'quarantine') {
    return miss('wrongQuarantine', ['서류에 문제가 있으면 건강 상태와 관계없이 거부합니다.', ...denyExplain]);
  }
  if (reasons.includes(reason)) return ok;
  return miss('wrongReason', [`거부는 맞지만 사유가 틀렸습니다. 정답 사유: ${reasons.join(', ')}`, ...denyExplain]);
}

/**
 * 하루 정산
 * @param judgements judge() 결과 목록 (처리 순서)
 * @param unprocessed 미처리 방문자 수
 * @param approvedPeople 승인으로 입장한 인원(일행 포함)
 */
export function summarizeDay({ day, judgements, unprocessed, approvedPeople }, balance) {
  const s = balance.scoring;
  const mistakes = judgements.filter((j) => !j.correct);
  const majors = mistakes.filter((m) => MAJOR_KINDS.has(m.kind));
  const normal = mistakes.length - majors.length;
  const correct = judgements.length - mistakes.length;

  // 일반 오심 2회까지 경고, 3회째부터 벌점. 중대 오심은 경고 없이 바로 벌점
  const penalized = Math.max(0, normal - s.freeWarnings);
  const penaltyPoints = penalized * s.penaltyPerMistake + majors.length * s.penaltyMajor;
  const supplyEarned = Math.max(0, correct * s.supplyPerCorrect - penaltyPoints);

  let trustDelta = 0;
  for (const m of mistakes) trustDelta += s.trust[m.kind] ?? 0;
  trustDelta += unprocessed * s.trust.unprocessed;
  if (mistakes.length === 0 && unprocessed === 0 && judgements.length > 0) trustDelta += s.trust.perfectDayBonus;

  return {
    day,
    processed: judgements.length,
    correct,
    mistakes,
    majors: majors.length,
    warnings: Math.min(normal, s.freeWarnings),
    penalized,
    penaltyPoints,
    supplyEarned,
    unprocessed,
    approvedPeople,
    trustDelta,
  };
}
