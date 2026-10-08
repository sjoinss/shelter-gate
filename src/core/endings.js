// 엔딩 분기 (14장). 누적 기록으로 조건을 위에서부터 검사해 처음 맞는 엔딩을 고른다. UI 비의존.
import { infectedInQuarantine } from './shelterState.js';

/** 엔딩 판정에 쓰는 누적 통계 */
export function endingStats(shelter, history) {
  const sum = (key) => history.reduce((s, h) => s + (h[key] ?? 0), 0);
  const processed = sum('processed');
  return {
    trust: shelter.trust,
    infections: sum('infections'),
    untreated: shelter.hiddenInfected + infectedInQuarantine(shelter),
    bribes: shelter.flags?.bribes ?? 0,
    ruleBreaks: shelter.flags?.ruleBreaks ?? 0,
    occupancyRatio: shelter.capacity > 0 ? shelter.occupancy / shelter.capacity : 0,
    denyRatio: processed > 0 ? sum('denied') / processed : 0,
    processed,
    mistakes: sum('mistakes'),
    approvedPeople: sum('approvedPeople'),
  };
}

const TESTS = {
  trustAtMost: (s, v) => s.trust <= v,
  trustBelow: (s, v) => s.trust < v,
  infectionsAtLeast: (s, v) => s.infections >= v,
  untreatedAtLeast: (s, v) => s.untreated >= v,
  bribesAtLeast: (s, v) => s.bribes >= v,
  ruleBreaksAtLeast: (s, v) => s.ruleBreaks >= v,
  occupancyRatioBelow: (s, v) => s.occupancyRatio < v,
  denyRatioAbove: (s, v) => s.denyRatio > v,
};

/** when의 모든 조건을 만족하는지. any는 그중 하나만 맞으면 된다 */
function satisfies(when, stats) {
  for (const [key, value] of Object.entries(when)) {
    if (key === 'any') {
      if (!value.some((w) => satisfies(w, stats))) return false;
    } else if (!TESTS[key]) {
      throw new Error(`알 수 없는 엔딩 조건: ${key}`);
    } else if (!TESTS[key](stats, value)) {
      return false;
    }
  }
  return true;
}

export function pickEnding(shelter, history, endings) {
  const stats = endingStats(shelter, history);
  const ending = endings.endings.find((e) => satisfies(e.when, stats)) ?? endings.endings[endings.endings.length - 1];
  return { ending, stats };
}
