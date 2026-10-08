// 서류 오류/위조 주입 (8장).
// 각 오류는 { type, rule, field, evidence, explain }을 남긴다.
//  - field: 잘못된 값이 들어간 항목 키 (불일치 지적 대상)
//  - evidence: field와 함께 지적하면 인정되는 항목 키 목록 (서류·메모·진술·규정집)

import { SYMPTOMS, SYMPTOM_LABEL } from './infectionModel.js';

const APPEARANCE_LABEL ={ height: '키', build: '체격', hair: '머리', feature: '특징' };

function pickOther(rng, list, current) {
  const options = list.filter((v) => v !== current);
  return rng.pick(options);
}

function alterName(rng, name, syllables) {
  const surname = name[0];
  const given = [...name.slice(1)];
  const pos = rng.int(0, given.length - 1);
  given[pos] = pickOther(rng, syllables, given[pos]);
  return surname + given.join('');
}

const D = (n) => `D+${n}`;

/**
 * 오류 유형 정의.
 * available(v, ctx, data): 이 방문자에게 적용 가능한지
 * apply(v, rng, ctx, data): v.documents / v.truth를 수정하고 fault 기록을 반환
 */
export const FAULT_TYPES = {
  nameCard: {
    rule: 'R-NAME-MATCH',
    available: (v) => !!v.documents.idCard,
    apply(v, rng, ctx, data) {
      const card = v.documents.idCard;
      card.name = alterName(rng, v.truth.name, data.names.givenSyllables);
      const evidence = ['statement.name', 'rule:R-NAME-MATCH'];
      let explain = `대피카드 이름은 '${card.name}'이지만 본인이 말한 이름은 '${v.truth.name}'입니다. (이름을 물으면 확인할 수 있습니다)`;
      if (v.documents.permit) {
        evidence.push('permit.name');
        explain += ` 허가증의 이름도 '${v.truth.name}'입니다.`;
      }
      if (v.documents.healthRecord) evidence.push('healthRecord.name');
      if (v.documents.medicalCert) evidence.push('medicalCert.name');
      return { field: 'idCard.name', evidence, explain };
    },
  },

  namePermit: {
    rule: 'R-NAME-MATCH',
    available: (v) => !!v.documents.permit,
    apply(v, rng, ctx, data) {
      const permit = v.documents.permit;
      permit.name = alterName(rng, v.truth.name, data.names.givenSyllables);
      return {
        field: 'permit.name',
        evidence: ['idCard.name', 'statement.name', 'rule:R-NAME-MATCH'],
        explain: `허가증 이름은 '${permit.name}', 대피카드 이름은 '${v.documents.idCard.name}'입니다. 서로 다릅니다.`,
      };
    },
  },

  expiry: {
    rule: 'R-ID-EXPIRY',
    available: (v) => !!v.documents.idCard,
    apply(v, rng, ctx, data) {
      const card = v.documents.idCard;
      card.expiry = ctx.today - rng.int(1, data.balance.documents.idCardExpiredBackMax);
      card.issued = rng.int(Math.max(1, card.expiry - 20), card.expiry);
      return {
        field: 'idCard.expiry',
        evidence: ['ref.today', 'rule:R-ID-EXPIRY'],
        explain: `대피카드 유효기간 ${D(card.expiry)}가 오늘(${D(ctx.today)})보다 이전입니다.`,
      };
    },
  },

  appearance: {
    rule: 'R-APPEARANCE',
    available: (v) => !!v.documents.idCard,
    apply(v, rng, ctx, data) {
      const card = v.documents.idCard;
      const part = rng.pick(['height', 'build', 'hair', 'feature']);
      const vocab = data.appearance;
      const list = part === 'hair' ? vocab.hair.map((h) => h.text) : vocab[part];
      const truthValue = v.truth.appearance[part];
      card.appearance[part] = pickOther(rng, list, truthValue);
      const label = APPEARANCE_LABEL[part];
      return {
        field: `idCard.appearance.${part}`,
        evidence: [`observed.appearance.${part}`, 'rule:R-APPEARANCE'],
        explain: `인상착의의 ${label} 항목이 대피카드에는 '${card.appearance[part]}', 외모 메모에는 '${truthValue}'(으)로 적혀 있습니다.`,
      };
    },
  },

  districtInvalid: {
    rule: 'R-DISTRICT-CODE',
    group: 'district',
    available: (v) => !!v.documents.idCard,
    apply(v, rng, ctx, data) {
      const card = v.documents.idCard;
      const { city, districts } = data.districts;
      const d = districts.find((x) => x.code === v.truth.homeDistrict);
      const kind = rng.pick(['noDistrict', 'noBlock', 'format']);
      let explain;
      if (kind === 'noDistrict') {
        const code = String(rng.int(districts.length + 1, 19)).padStart(2, '0');
        card.district = `${city}-${code}-${rng.pick(['A', 'B', 'C'])}`;
        explain = `구역 번호 ${code}번은 구역 목록에 없습니다.`;
      } else if (kind === 'noBlock') {
        const missing = ['A', 'B', 'C', 'D', 'E'].filter((b) => !d.blocks.includes(b));
        const block = rng.pick(missing);
        card.district = `${city}-${d.code}-${block}`;
        explain = `${d.name}(${d.code})에는 ${block}블록이 없습니다.`;
      } else {
        const block = v.truth.homeBlock;
        card.district = rng.pick([
          `${city}-${Number(d.code)}-${block}`,
          `${city}${d.code}-${block}`,
          `${city}-${d.code}-${block.toLowerCase()}`,
          `${[...city].reverse().join('')}-${d.code}-${block}`,
        ]);
        explain = `코드 형식이 'HS-두 자리 숫자-블록 대문자'가 아닙니다.`;
      }
      return {
        field: 'idCard.district',
        evidence: ['ref.districts', 'rule:R-DISTRICT-CODE'],
        explain: `거주구역 코드 '${card.district}': ${explain}`,
      };
    },
  },

  districtClosed: {
    rule: 'R-DISTRICT-CLOSED',
    group: 'district', // 같은 필드를 덮어쓰므로 구역 코드 위조와 함께 주입하지 않음
    available: (v, ctx, data, dayDef) => !!v.documents.idCard && dayDef.closedDistricts.length > 0,
    apply(v, rng, ctx, data, dayDef) {
      const { city, districts } = data.districts;
      const code = rng.pick(dayDef.closedDistricts);
      const d = districts.find((x) => x.code === code);
      v.truth.homeDistrict = code;
      v.truth.homeBlock = rng.pick(d.blocks);
      v.documents.idCard.district = `${city}-${code}-${v.truth.homeBlock}`;
      return {
        field: 'idCard.district',
        evidence: ['ref.districts', 'rule:R-DISTRICT-CLOSED', 'statement.district'],
        explain: `거주구역 ${v.documents.idCard.district}(${d.name})은(는) 오늘 폐쇄된 구역입니다.`,
      };
    },
  },

  permitIssued: {
    rule: 'R-PERMIT-DATE',
    available: (v) => !!v.documents.permit,
    apply(v, rng, ctx) {
      const p = v.documents.permit;
      p.issued = ctx.today + rng.int(1, 3);
      p.validUntil = Math.max(p.validUntil, p.issued + rng.int(1, 5));
      return {
        field: 'permit.issued',
        evidence: ['ref.today', 'rule:R-PERMIT-DATE'],
        explain: `허가증 발급일 ${D(p.issued)}가 오늘(${D(ctx.today)})보다 이후입니다.`,
      };
    },
  },

  permitExpired: {
    rule: 'R-PERMIT-DATE',
    available: (v) => !!v.documents.permit,
    apply(v, rng, ctx) {
      const p = v.documents.permit;
      p.validUntil = ctx.today - rng.int(1, 4);
      p.issued = p.validUntil - rng.int(1, 5);
      return {
        field: 'permit.validUntil',
        evidence: ['ref.today', 'rule:R-PERMIT-DATE'],
        explain: `허가증 유효일 ${D(p.validUntil)}가 오늘(${D(ctx.today)})보다 이전입니다.`,
      };
    },
  },

  permitShelter: {
    rule: 'R-PERMIT-SHELTER',
    available: (v) => !!v.documents.permit,
    apply(v, rng, ctx, data) {
      const p = v.documents.permit;
      p.shelter = rng.pick(data.districts.otherShelters);
      return {
        field: 'permit.shelter',
        evidence: ['ref.shelter', 'rule:R-PERMIT-SHELTER'],
        explain: `허가증의 허가 대피소가 '${p.shelter}'입니다. 이곳은 ${ctx.shelterName}입니다.`,
      };
    },
  },

  healthContradiction: {
    rule: 'R-HEALTH-CONTRADICTION',
    available: (v) =>
      !!v.documents.healthRecord && Object.values(v.truth.health.results.symptoms).some((x) => x === false),
    apply(v, rng, ctx) {
      const answers = v.truth.health.results.symptoms;
      const symptom = rng.pick(SYMPTOMS.filter((s) => answers[s] === false));
      const record = v.documents.healthRecord;
      record.recentSymptom = symptom;
      record.recentVisit = ctx.today - rng.int(1, 3);
      const label = SYMPTOM_LABEL[symptom];
      return {
        field: 'healthRecord.recentSymptom',
        evidence: [`exam.symptoms.${symptom}`, 'rule:R-HEALTH-CONTRADICTION'],
        explain: `건강 기록에는 ${D(record.recentVisit)} ${label} 진료 기록이 있는데, 증상 문답에서는 ${label} 증상이 없다고 답했습니다.`,
      };
    },
  },

  minorAlone: {
    rule: 'R-MINOR-ALONE',
    group: 'companions',
    available: (v) => !!v.documents.idCard,
    apply(v, rng, ctx, data) {
      const t = v.truth;
      const [min, max] = data.balance.generator.minorAloneAge;
      t.age = rng.int(min, max);
      t.ageGroup = 'child';
      t.companions = [];
      t.item = 'backpack';
      const childHair = data.appearance.hair.filter((h) => h.ages.includes('child')).map((h) => h.text);
      if (!childHair.includes(t.appearance.hair)) t.appearance.hair = rng.pick(childHair);
      const card = v.documents.idCard;
      card.age = t.age;
      card.appearance = { ...t.appearance };
      delete v.documents.companionList;
      return {
        field: 'idCard.age',
        evidence: ['observed.groupSize', 'rule:R-MINOR-ALONE'],
        explain: `대피카드 나이는 ${t.age}세이고 혼자 왔습니다. 16세 미만은 성인 동행자가 있어야 합니다.`,
      };
    },
  },

  companionCount: {
    rule: 'R-COMPANION-COUNT',
    group: 'companions',
    available: (v) => !!v.documents.companionList,
    apply(v, rng, ctx, data) {
      const list = v.documents.companionList;
      const actual = list.total;
      const more = actual === 2 || rng.chance(0.5);
      if (more) {
        const surname = v.truth.name[0];
        const syl = data.names.givenSyllables;
        list.members.push({ name: surname + rng.pick(syl) + rng.pick(syl), age: rng.int(5, 60), relation: '자녀' });
      } else {
        list.members.splice(rng.int(0, list.members.length - 1), 1);
      }
      list.total = list.members.length + 1;
      return {
        field: 'companionList.total',
        evidence: ['observed.groupSize', 'statement.groupSize', 'rule:R-COMPANION-COUNT'],
        explain: `동행자 명부의 총 인원은 ${list.total}명이지만 창구 앞에는 ${actual}명이 서 있었습니다.`,
      };
    },
  },
};

FAULT_TYPES.medForged = {
  rule: 'R-MED-FORGED',
  available: (v) => !v.documents.medicalCert,
  apply(v, rng, ctx, data) {
    const d = data.districts;
    const badLicense = rng.chance(0.5);
    const digits = String(rng.int(10000, 99999));
    const license = badLicense
      ? rng.pick([`HS-MD-${digits.slice(0, 4)}`, `HS-MO-${digits}`, `MD-${digits}`, `HS-DR-${digits}`])
      : `HS-${rng.pick(['MD', 'RN'])}-${digits}`;
    const affiliation = badLicense ? rng.pick(d.hospitals) : rng.pick(d.fakeHospitals);
    v.documents.medicalCert = { name: v.truth.name, license, affiliation, validUntil: ctx.today + rng.int(2, 30) };
    return badLicense
      ? {
          field: 'medicalCert.license',
          evidence: ['ref.hospitals', 'rule:R-MED-FORGED'],
          explain: `의료인 증명서 면허번호 '${license}'는 형식(HS-MD 또는 HS-RN 뒤 숫자 다섯 자리)에 맞지 않습니다.`,
        }
      : {
          field: 'medicalCert.affiliation',
          evidence: ['ref.hospitals', 'rule:R-MED-FORGED'],
          explain: `의료인 증명서 소속 기관 '${affiliation}'는 규정집의 의료기관 목록에 없습니다.`,
        };
  },
};

/**
 * 방문자에게 오류를 count개(서로 다른 규정) 주입한다.
 * @returns fault 목록 (주입 불가 시 빈 배열)
 */
export function injectFaults(v, rng, ctx, data, dayDef, rules, count) {
  const activeIds = new Set(rules.map((r) => r.id));
  const faults = [];
  const usedRules = new Set();
  const usedGroups = new Set();

  for (let i = 0; i < count; i++) {
    const candidates = Object.entries(FAULT_TYPES).filter(
      ([, t]) =>
        activeIds.has(t.rule) &&
        !usedRules.has(t.rule) &&
        !(t.group && usedGroups.has(t.group)) &&
        t.available(v, ctx, data, dayDef),
    );
    if (candidates.length === 0) break;
    const [type, def] = rng.pick(candidates);
    const record = def.apply(v, rng, ctx, data, dayDef);
    usedRules.add(def.rule);
    if (def.group) usedGroups.add(def.group);
    faults.push({ type, rule: def.rule, ...record });
  }
  return faults;
}
