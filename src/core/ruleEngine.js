// 규정 평가 / 정답 판정. UI를 import하지 않는다.
// 판정은 플레이어에게 보이는 정보(documents, observed, statement)만 참조한다 (6장 원칙).

export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/** 해당 일차에 적용되는 규정 (since ≤ day < until), priority 높은 순 */
export function activeRules(rules, day) {
  return rules
    .filter((r) => r.since <= day && (r.until == null || day < r.until))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function getDayDef(data, day) {
  const def = data.days.days.find((d) => d.day === day);
  if (!def) throw new Error(`정의되지 않은 일차: ${day}`);
  return def;
}

/** 규정 평가에 필요한 참조값 */
export function buildContext(data, day) {
  const { districts, balance } = data;
  const dayDef = getDayDef(data, day);
  const closed = new Set(dayDef.closedDistricts);
  const validDistrictCodes = [];
  const closedDistrictCodes = [];
  for (const d of districts.districts) {
    for (const b of d.blocks) {
      const code = `${districts.city}-${d.code}-${b}`;
      validDistrictCodes.push(code);
      if (closed.has(d.code)) closedDistrictCodes.push(code);
    }
  }
  return {
    day,
    today: day + balance.calendar.todayOffset,
    validDistrictCodes,
    closedDistrictCodes,
    shelterName: districts.shelterName,
    hospitals: districts.hospitals ?? [],
    directiveDistrictCodes: validDistrictCodes.filter((c) => (districts.directiveDistricts?.[day] ?? []).includes(c.split('-')[1])),
  };
}

const patterns = new Map();
/** 데이터 파일의 정규식 문자열 → RegExp (캐시) */
function patternOf(source) {
  if (!patterns.has(source)) patterns.set(source, new RegExp(source));
  return patterns.get(source);
}

/** 조건을 만족하면 true (규정의 check는 "위반 조건") */
function matches(check, subject, ctx) {
  if (check.op === 'any') return check.checks.some((c) => matches(c, subject, ctx));
  if (check.op === 'all') return check.checks.every((c) => matches(c, subject, ctx));
  if (check.op === 'spanLess') {
    const from = getPath(subject, check.from);
    const to = getPath(subject, check.to);
    return from != null && to != null && to - from < check.value;
  }

  const value = getPath(subject, check.field);
  if (value === undefined || value === null) return false; // 해당 서류/값이 없으면 적용되지 않음
  const ref = check.ref !== undefined ? ctx[check.ref] : check.value;

  switch (check.op) {
    case 'before':
    case '<':
      return value < ref;
    case 'after':
    case '>':
      return value > ref;
    case '>=':
      return value >= ref;
    case '==':
      return value === ref;
    case 'in':
      return ref.includes(value);
    case 'notIn':
      return !ref.includes(value);
    case 'notEqual':
      return value !== ref;
    case 'mismatch':
      return check.against.some((p) => {
        const other = getPath(subject, p);
        return other !== undefined && !deepEqual(value, other);
      });
    case 'matches':
      return typeof value === 'string' && patternOf(check.pattern).test(value);
    case 'notMatches':
      return typeof value !== 'string' || !patternOf(check.pattern).test(value);
    case 'anyTrue':
      return Object.values(value).some((v) => v === true);
    case 'answerDenies': {
      // value = 기록된 증상 키, against = 문답 답변 객체
      const answers = getPath(subject, check.against);
      return answers !== undefined && answers[value] === false;
    }
    default:
      throw new Error(`알 수 없는 규정 연산자: ${check.op}`);
  }
}

function violates(rule, subject, ctx) {
  if (!matches(rule.check, subject, ctx)) return false;
  return !(rule.unless && matches(rule.unless, subject, ctx)); // 예외 조건
}

/** 규정 평가에 쓰는 "보이는 정보" 묶음 */
export function subjectOf(visitor) {
  return { ...visitor.documents, observed: visitor.observed, statement: visitor.statement, exam: visitor.exam };
}

/**
 * (visitor, activeRules, ctx) → { verdict, reasons, violated }
 *  - verdict: 가장 priority가 높은 위반 규정의 판정 (서류 문제 deny > 건강 quarantine)
 *  - reasons: verdict와 같은 판정을 내리는 위반 규정들의 사유 (정답 사유)
 *  - violated: 위반한 모든 규정 id
 */
export function evaluate(visitor, rules, ctx) {
  const subject = subjectOf(visitor);
  let violated = rules.filter((r) => r.verdict !== 'approve' && violates(r, subject, ctx));

  // 규정 충돌: verdict가 approve인 우선 규정(지침)이 적용되면 overrides에 적힌 규정을 무효로 한다
  const conflicts = [];
  for (const o of rules.filter((r) => r.verdict === 'approve' && violates(r, subject, ctx))) {
    for (const id of o.overrides ?? []) {
      if (violated.some((v) => v.id === id)) {
        conflicts.push({ winner: o.id, loser: id, note: o.conflictNote ?? '' });
        violated = violated.filter((v) => v.id !== id);
      }
    }
  }

  if (violated.length === 0) return { verdict: 'approve', reasons: [], violated: [], conflicts };
  const verdict = violated[0].verdict; // priority 순으로 정렬되어 있음
  return {
    verdict,
    reasons: violated.filter((r) => r.verdict === verdict).map((r) => ({ ruleId: r.id, reason: r.reason })),
    violated: violated.map((r) => r.id),
    conflicts,
  };
}
