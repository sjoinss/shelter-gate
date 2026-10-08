// 방문자 생성: truth → documents → faults → observed/statement → 정답 판정.
// 같은 (baseSeed, day) → 같은 방문자 열 (18장 재현성).
import { createRng, daySeed } from './rng.js';
import { activeRules, buildContext, evaluate, getDayDef } from './ruleEngine.js';
import { buildDocuments } from './documentBuilder.js';
import { injectFaults } from './faultInjector.js';
import { rollHealth, explainHealth } from './infectionModel.js';

const MAX_ATTEMPTS = 30;

function makeName(rng, data, surname, used) {
  const syl = data.names.givenSyllables;
  for (let i = 0; i < 50; i++) {
    const name = (surname ?? rng.pick(data.names.surnames)) + rng.pick(syl) + rng.pick(syl);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new Error('이름 풀 부족');
}

function ageGroupOf(age) {
  return age < 16 ? 'child' : age >= 70 ? 'elder' : 'adult';
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function makePerson(rng, data, ageGroup, fixedAge = null) {
  const g = data.balance.generator;
  const range = ageGroup === 'child' ? g.childAge : ageGroup === 'elder' ? g.elderAge : g.adultAge;
  const hairOptions = data.appearance.hair.filter((h) => h.ages.includes(ageGroup)).map((h) => h.text);
  return {
    sex: rng.pick(['M', 'F']),
    age: fixedAge ?? rng.int(range[0], range[1]),
    ageGroup,
    appearance: {
      height: rng.pick(data.appearance.height),
      build: rng.pick(data.appearance.build),
      hair: rng.pick(hairOptions),
      feature: rng.pick(data.appearance.feature),
    },
  };
}

/** 관계에 맞는 나이 (자녀는 18살 이상 어리게, 배우자·형제는 비슷하게, 부모는 18살 이상 많게) */
function companionAge(rng, g, relKey, mainAge) {
  const maxAge = g.elderAge[1];
  switch (relKey) {
    case 'child':
      return rng.int(g.childAge[0], Math.min(g.childAge[1], mainAge - 18));
    case 'spouse':
      return clamp(mainAge + rng.int(-6, 6), g.adultAge[0], maxAge);
    case 'sibling':
      return clamp(mainAge + rng.int(-10, 10), g.adultAge[0], maxAge);
    case 'parent':
      return rng.int(mainAge + 18, Math.min(mainAge + 35, maxAge));
    default:
      return rng.int(g.adultAge[0], maxAge);
  }
}

function makeCompanions(rng, data, dayDef, main, used) {
  if (!dayDef.companionChance || !rng.chance(dayDef.companionChance)) return [];
  const g = data.balance.generator;
  const count = rng.int(1, g.maxCompanions);
  const rel = data.names.relations;
  const canChild = main.age - 18 >= g.childAge[0];
  const canParent = main.age + 18 <= g.elderAge[1];
  const companions = [];
  for (let i = 0; i < count; i++) {
    const relKey = rng.weighted([
      ['child', canChild ? 4 : 0],
      ['spouse', i === 0 ? 3 : 0],
      ['parent', canParent ? 1 : 0],
      ['sibling', 1],
      ['neighbor', 1],
    ]);
    const age = companionAge(rng, g, relKey, main.age);
    const person = makePerson(rng, data, ageGroupOf(age), age);
    const sameFamily = relKey === 'child' || relKey === 'sibling';
    companions.push({
      ...person,
      name: makeName(rng, data, sameFamily ? main.name[0] : null, used),
      relation: rel[relKey],
    });
  }
  return companions;
}

/**
 * @param opts.exception 고령자 예외 방문자: 70세 이상 본인이 폐쇄 구역 출신
 */
function makeTruth(rng, data, dayDef, used, { exception = false, medic = false, directive = false, released = false } = {}) {
  const ageGroup = exception ? 'elder' : medic ? 'adult' : rng.chance(data.balance.generator.elderChance) ? 'elder' : 'adult';
  const person = makePerson(rng, data, ageGroup, medic ? rng.int(26, 62) : null);
  // 의료인은 절반쯤 폐쇄 구역 출신 (예외 규정이 필요한 경우)
  const fromClosed = exception || (medic && rng.chance(0.5));
  const directiveCodes = data.districts.directiveDistricts?.[dayDef.day] ?? [];
  const candidates = data.districts.districts.filter((d) =>
    directive
      ? directiveCodes.includes(d.code)
      : fromClosed
        ? dayDef.closedDistricts.includes(d.code)
        : !dayDef.closedDistricts.includes(d.code),
  );
  const district = rng.pick(candidates);
  const name = makeName(rng, data, null, used);
  return {
    ...person,
    name,
    homeDistrict: district.code,
    homeBlock: rng.pick(district.blocks),
    item: ageGroup === 'elder' ? rng.pick(['none', 'cane']) : rng.pick(data.appearance.items),
    companions: makeCompanions(rng, data, dayDef, { name, age: person.age }, used),
    medic: medic ? rng.pick(['MD', 'RN']) : null,
    released,
  };
}

function makeObserved(truth) {
  const companions = truth.companions.map((c) => ({
    sex: c.sex,
    age: c.age,
    ageGroup: c.ageGroup,
    height: c.appearance.height,
    build: c.appearance.build,
  }));
  return {
    appearance: { ...truth.appearance },
    sex: truth.sex,
    age: truth.age,
    ageGroup: truth.ageGroup,
    item: truth.item,
    signs: [...truth.health.signs],
    groupSize: companions.length + 1,
    adultCompanions: companions.filter((c) => c.ageGroup !== 'child').length,
    hasElder: truth.age >= 70 || companions.some((c) => c.age >= 70),
    companions,
  };
}

function makeStatement(truth, data) {
  const d = data.districts.districts.find((x) => x.code === truth.homeDistrict);
  return {
    name: truth.name,
    district: `${d.name} ${truth.homeBlock}블록`,
    groupSize: truth.companions.length + 1,
  };
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * role:
 *  - normal: 문제 없음 → 승인
 *  - faulty: 서류 오류 → 거부
 *  - infected: 증상기 감염자, 해금된 장비로 반드시 단서가 나옴 → 격리
 *  - exception: 고령자 예외 (폐쇄 구역 출신이지만 승인)
 *  - hidden: 잠복기 감염자. 장비로 잡힐 수도, 안 잡힐 수도 있음 (7일차부터, 운 요소)
 *  - medic: 유효한 의료인 증명서를 가진 의료인 (9일차부터)
 *  - directive: 본부 긴급 지침 대상 구역 주민 (폐쇄 구역이지만 지침이 우선해 승인, 12일차)
 *  - released: 다른 대피소에서 격리를 마친 사람, 유효한 격리 해제 확인서 (13일차부터)
 */
function generateVisitor({ id, rng, data, dayDef, ctx, rules, role, used }) {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const activeIds = new Set(ruleById.keys());

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const usedLocal = new Set(used);
    const truth = makeTruth(rng, data, dayDef, usedLocal, {
      exception: role === 'exception',
      medic: role === 'medic',
      directive: role === 'directive',
      released: role === 'released',
    });
    const stage = role === 'infected' ? 'symptomatic' : role === 'hidden' ? 'incubating' : 'none';
    truth.health = rollHealth(rng, stage, data.balance);
    const visitor = {
      id,
      role,
      seed: rng.int(0, 0x7fffffff),
      truth,
      documents: buildDocuments(truth, rng, ctx, dayDef, data),
      faults: [],
    };

    if (role === 'faulty') {
      const count = rng.chance(dayDef.twoFaultChance) ? 2 : 1;
      visitor.faults = injectFaults(visitor, rng, ctx, data, dayDef, rules, count);
      if (visitor.faults.length === 0) continue;
    }
    visitor.observed = makeObserved(truth);
    visitor.statement = makeStatement(truth, data);
    visitor.exam = truth.health.results;

    // 공정성 검증
    const result = evaluate(visitor, rules, ctx);
    const docViolated = new Set(result.violated.filter((rid) => ruleById.get(rid).category === 'document'));
    const healthViolated = result.violated.filter((rid) => ruleById.get(rid).category === 'health');
    const injected = new Set(visitor.faults.map((f) => f.rule));
    if (!sameSet(docViolated, injected)) continue; // 의도하지 않은 서류 위반 / 주입한 오류가 드러나지 않음
    if (role === 'infected' && healthViolated.length === 0) continue; // 증상기 감염자는 반드시 발견 가능
    if (role !== 'infected' && role !== 'hidden' && healthViolated.length > 0) continue;
    if (['exception', 'medic', 'directive', 'released'].includes(role) && result.verdict !== 'approve') continue;
    if (role === 'directive' && result.conflicts.length === 0) continue;

    visitor.correctVerdict = result.verdict;
    visitor.correctReasons = result.reasons.map((r) => r.reason);
    visitor.conflicts = result.conflicts;
    visitor.healthExplain = explainHealth(visitor.exam, activeIds, data.balance.infection.feverThreshold);
    // 잠복기 감염자를 장비로 못 잡는 경우: 승인이 정답이지만 정산에서 알려 준다
    visitor.undetectable = truth.health.infected && result.verdict === 'approve';
    // 키트가 떨어졌을 때의 정답 (키트 결과를 양성으로 간주)
    if (activeIds.has('R-KIT-QUARANTINE')) {
      const noKit = evaluate({ ...visitor, exam: { ...visitor.exam, rapidKit: 'pos' } }, rules, ctx);
      if (noKit.verdict !== result.verdict) {
        visitor.noKit = { verdict: noKit.verdict, reasons: noKit.reasons.map((r) => r.reason) };
      }
    }
    // 시약이 떨어졌을 때의 정답 (PCR 결과를 양성으로 간주)
    if (activeIds.has('R-PCR-QUARANTINE')) {
      const noPcr = evaluate({ ...visitor, exam: { ...visitor.exam, pcr: 'pos' } }, rules, ctx);
      if (noPcr.verdict !== result.verdict) {
        visitor.noPcr = { verdict: noPcr.verdict, reasons: noPcr.reasons.map((r) => r.reason) };
      }
    }
    for (const n of usedLocal) used.add(n);
    return visitor;
  }
  throw new Error(`방문자 생성 실패: ${id}`);
}

/** 하루치 방문자 열 생성 */
export function generateDay(data, baseSeed, day) {
  const dayDef = getDayDef(data, day);
  const rng = createRng(daySeed(baseSeed, day));
  const ctx = buildContext(data, day);
  const rules = activeRules(data.rules.rules, day);
  const n = dayDef.visitors;
  const counts = {
    faulty: Math.round(n * dayDef.faultRatio),
    infected: Math.round(n * (dayDef.infectedRatio ?? 0)),
    exception: Math.round(n * (dayDef.exceptionRatio ?? 0)),
    // 잠복기 감염자는 기대값만 정하고 확률로 뽑는다 (운 요소가 매일 생기지 않게)
    hidden: Math.floor(n * (dayDef.hiddenRatio ?? 0)) + (rng.chance((n * (dayDef.hiddenRatio ?? 0)) % 1) ? 1 : 0),
    medic: Math.round(n * (dayDef.medicRatio ?? 0)),
    directive: Math.round(n * (dayDef.directiveRatio ?? 0)),
    released: Math.round(n * (dayDef.releasedRatio ?? 0)),
  };
  const roles = [];
  for (const [role, count] of Object.entries(counts)) for (let i = 0; i < count; i++) roles.push(role);
  while (roles.length < n) roles.push('normal');
  const used = new Set();
  const visitors = rng
    .shuffle(roles)
    .map((role, i) => generateVisitor({ id: `d${day}-v${i + 1}`, rng, data, dayDef, ctx, rules, role, used }));
  return { dayDef, ctx, rules, visitors };
}
