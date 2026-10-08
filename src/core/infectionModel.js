// 감염 모델 (9장). 모든 검사 결과는 방문자 생성 시점에 확정한다 — 재검사로 결과가 바뀌지 않는다.
// (예외: 체온 재측정. 뛰어온 비감염자는 처음에 높게 나오고 재측정 값이 정상)

export const SYMPTOMS = ['cough', 'fever', 'vomiting', 'breathless'];
export const SYMPTOM_LABEL = { cough: '기침', fever: '발열', vomiting: '구토', breathless: '호흡곤란' };

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param stage 'none' | 'incubating' | 'symptomatic'
 * @returns {{ infected, stage, results: { temperature: { first, recheck }, temperatureFinal, symptoms }, signs: string[] }}
 */
export function rollHealth(rng, stage, balance) {
  const inf = balance.infection;
  const det = inf.detection;
  const th = inf.feverThreshold;
  const signs = [];

  // 체온
  let first;
  let recheck;
  if (rng.chance(det.temperature[stage])) {
    if (stage === 'none') {
      // 비감염 오탐: 방금 뛰어온 사람. 재측정하면 정상
      first = round1(th + rng.next() * 0.6);
      recheck = round1(36.3 + rng.next() * 0.8);
      if (rng.chance(inf.runnerSignChance)) signs.push('panting');
    } else {
      first = round1(th + 0.1 + rng.next() * 1.6);
      recheck = round1(Math.max(th, first - rng.next() * 0.3));
    }
  } else {
    first = round1(36.1 + rng.next() * 1.2); // 최대 37.3
    recheck = first;
  }
  const temperatureFinal = first >= th ? recheck : first;

  // 증상 문답 (본인이 답하는 내용)
  const symptoms = Object.fromEntries(SYMPTOMS.map((s) => [s, false]));
  if (rng.chance(det.symptoms[stage])) {
    const count = stage === 'symptomatic' ? rng.int(1, 3) : 1;
    for (const s of rng.shuffle(SYMPTOMS).slice(0, count)) symptoms[s] = true;
  }

  // 신속 키트, 산소포화도, 호흡 양상
  const rapidKit = rng.chance(det.rapidKit[stage]) ? 'pos' : 'neg';
  const spo2 = rng.chance(det.spo2Low[stage]) ? rng.int(86, 93) : rng.int(95, 99);
  const breathing = rng.chance(det.breathing[stage]) ? 'labored' : 'normal';

  // 겉으로 보이는 징후 (메모 + 그림자 동작)
  if (stage === 'symptomatic' && rng.chance(inf.visibleSignChance)) {
    signs.push(symptoms.cough ? 'cough' : 'sweat');
  }

  return {
    infected: stage !== 'none',
    stage,
    results: { temperature: { first, recheck }, temperatureFinal, symptoms, rapidKit, spo2, breathing },
    signs,
  };
}

/** 밤사이 일반 구역 감염 확산 수 = f(감염자 수, 수용 밀도) */
export function spreadInfections(rng, infected, occupancy, capacity, balance) {
  if (infected <= 0) return 0;
  const density = capacity > 0 ? occupancy / capacity : 0;
  const expected = infected * balance.infection.spreadRate * (0.5 + density);
  const n = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
  return Math.min(n, Math.max(0, occupancy - infected));
}

/** 정산 해설용 건강 검사 문장 */
export function explainHealth(exam, activeRuleIds, threshold) {
  const lines = [];
  const { first, recheck } = exam.temperature;
  if (activeRuleIds.has('R-TEMP-QUARANTINE')) {
    if (first >= threshold && recheck >= threshold) {
      lines.push(`체온 ${first}°C, 재측정 ${recheck}°C로 ${threshold}°C 이상이어서 격리 대상입니다.`);
    } else if (first >= threshold) {
      lines.push(`첫 측정은 ${first}°C였지만 5초 뒤 재측정하면 ${recheck}°C로 정상입니다.`);
    }
  }
  const yes = SYMPTOMS.filter((s) => exam.symptoms[s]).map((s) => SYMPTOM_LABEL[s]);
  if (activeRuleIds.has('R-SYMPTOM-QUARANTINE') && yes.length) {
    lines.push(`증상 문답에서 ${yes.join(', ')} 증상이 있다고 답했습니다.`);
  }
  if (activeRuleIds.has('R-KIT-QUARANTINE') && yes.length) {
    lines.push(
      `증상 문답에서 ${yes.join(', ')} 증상이 있다고 답했으므로 키트 검사 대상입니다. 키트 결과는 ${exam.rapidKit === 'pos' ? '양성' : '음성'}입니다.`,
    );
  }
  if (activeRuleIds.has('R-SPO2-DENY') && exam.spo2 < 94) {
    lines.push(`산소포화도 ${exam.spo2}%로 94% 미만입니다. 중증 의심으로 의료시설에 안내해야 했습니다.`);
  }
  if (activeRuleIds.has('R-BREATH-QUARANTINE') && exam.breathing === 'labored') {
    lines.push('호흡 관찰에서 숨 쉴 때마다 어깨가 크게 들썩였습니다(이상 호흡).');
  }
  return lines;
}
