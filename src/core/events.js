// 밤 이벤트 / 딜레마 (13장). 선택지마다 얻는 것과 잃는 것이 있다. UI 비의존.
import { RESOURCE_KEYS, infectedInQuarantine, nightlyNeed } from './shelterState.js';

function eligible(ev, shelter, day, balance) {
  const seen = shelter.flags.eventsSeen;
  if (ev.fixedDay != null) return ev.fixedDay === day && !seen.includes(ev.id);
  if (day < (ev.minDay ?? balance.events.fromDay) || day > (ev.maxDay ?? 99)) return false;
  if (!ev.repeat && seen.includes(ev.id)) return false;
  const w = ev.when ?? {};
  if (w.maxFilters != null && shelter.filters > w.maxFilters) return false;
  if (w.minInfectedInQuarantine != null && infectedInQuarantine(shelter) < w.minInfectedInQuarantine) return false;
  if (w.foodBelowDays != null) {
    const need = Math.max(1, nightlyNeed(shelter, balance).food);
    if (shelter.food / need >= w.foodBelowDays) return false;
  }
  return true;
}

/** 오늘 밤 일어날 이벤트 (없으면 null). 고정 이벤트가 우선 */
export function pickEvent(shelter, day, rng, events, balance) {
  const list = events.events;
  const fixed = list.find((ev) => ev.fixedDay === day && eligible(ev, shelter, day, balance));
  if (fixed) return fixed;
  if (day < balance.events.fromDay || !rng.chance(balance.events.chancePerNight)) return null;
  const pool = list.filter((ev) => ev.fixedDay == null && eligible(ev, shelter, day, balance));
  if (pool.length === 0) return null;
  return rng.weighted(pool.map((ev) => [ev, ev.weight ?? 1]));
}

/** 선택지를 고를 수 있는지 (requires 충족) */
export function canChoose(shelter, choice) {
  return Object.entries(choice.requires ?? {}).every(([k, n]) => (shelter[k] ?? 0) >= n);
}

/** 고정 이벤트(집단 발열)의 규모: 일반 구역의 숨은 감염 + 지난 중대 오심 */
export function outbreakSize(shelter, history) {
  const majors = history.reduce((s, h) => s + (h.majors ?? 0), 0);
  return shelter.hiddenInfected + majors * 2;
}

function applyEffects(shelter, effects) {
  const next = { ...shelter, flags: { ...shelter.flags } };
  for (const [key, delta] of Object.entries(effects)) {
    if (key === 'hiddenInfectedHalve') {
      if (delta) next.hiddenInfected = Math.floor(next.hiddenInfected / 2);
    } else if (key === 'bribes' || key === 'ruleBreaks') {
      next.flags[key] += delta;
    } else if (key === 'capacity') {
      // 한도가 줄면 넘치는 인원은 다른 대피소로 옮겨진다
      next.capacity = Math.max(40, next.capacity + delta);
      next.occupancy = Math.min(next.occupancy, next.capacity);
    } else if (key === 'occupancy') {
      next.occupancy = Math.min(next.capacity, next.occupancy + delta);
    } else if (key === 'trust') {
      next.trust = Math.min(100, Math.max(0, next.trust + delta));
    } else if (key === 'supplyPoints' || key === 'hiddenInfected' || RESOURCE_KEYS.includes(key)) {
      next[key] = Math.max(0, next[key] + delta);
    }
  }
  return next;
}

/**
 * 선택 적용 → { shelter, result: string[] }
 * 결과에 위험(risk)이 있으면 시드 난수로 판정한다.
 */
export function applyChoice(shelter, event, choiceIndex, rng) {
  const choice = event.choices[choiceIndex];
  if (!choice || !canChoose(shelter, choice)) return { shelter, result: [] };
  let next = applyEffects(shelter, choice.effects ?? {});
  const result = [choice.result];
  if (choice.risk && rng.chance(choice.risk.chance)) {
    next = applyEffects(next, choice.risk.effects);
    result.push(choice.risk.result);
  }
  next.flags.eventsSeen = [...next.flags.eventsSeen.filter((id) => id !== event.id), event.id].slice(-20);
  return { shelter: next, result };
}
