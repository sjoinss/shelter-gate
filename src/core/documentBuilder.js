// truth → 정상 서류. 오류는 faultInjector가 따로 주입한다.

export function districtCode(city, district, block) {
  return `${city}-${district}-${block}`;
}

/**
 * @param truth 방문자 진실
 * @param rng 시드 난수
 * @param ctx buildContext() 결과
 * @param dayDef days.json 항목
 * @param data gameData
 */
export function buildDocuments(truth, rng, ctx, dayDef, data) {
  const { today } = ctx;
  const { documents: docBal } = data.balance;
  const docs = {};

  if (dayDef.documents.includes('idCard')) {
    const issued = rng.int(1, today);
    docs.idCard = {
      name: truth.name,
      sex: truth.sex === 'M' ? '남' : '여',
      age: truth.age,
      district: districtCode(data.districts.city, truth.homeDistrict, truth.homeBlock),
      issued,
      expiry: today + rng.int(0, docBal.idCardValidAheadMax),
      appearance: { ...truth.appearance },
    };
  }

  if (dayDef.documents.includes('permit')) {
    docs.permit = {
      name: truth.name,
      issued: today - rng.int(0, docBal.permitIssuedBackMax),
      validUntil: today + rng.int(0, docBal.permitValidAheadMax),
      shelter: ctx.shelterName,
      issuer: '임시재난대응본부',
    };
  }

  if (dayDef.documents.includes('companionList') && truth.companions.length > 0) {
    docs.companionList = {
      applicant: truth.name,
      members: truth.companions.map((c) => ({ name: c.name, age: c.age, relation: c.relation })),
      total: truth.companions.length + 1,
    };
  }

  if (dayDef.documents.includes('healthRecord')) {
    docs.healthRecord = {
      name: truth.name,
      lastTest: today - rng.int(2, 9), // 최근 검사일 (결과는 음성)
      vaccinated: rng.chance(0.7) ? '완료' : '미완료',
      chronic: rng.pick(['없음', '없음', '없음', '고혈압', '당뇨', '관절염', '위염']),
      recentSymptom: null, // 최근 진료 증상 키 (건강 기록 모순 오류에서만 채움)
      recentVisit: null,
    };
  }

  if (dayDef.documents.includes('releaseCert') && truth.released) {
    const start = today - rng.int(9, 16);
    const released = start + rng.int(data.balance.release.minQuarantineDays, 8);
    docs.releaseCert = {
      name: truth.name,
      start,
      released: Math.min(released, today - 1),
      confirmer: rng.pick(data.districts.otherShelterConfirmers),
    };
  }

  if (dayDef.documents.includes('medicalCert') && truth.medic) {
    docs.medicalCert = {
      name: truth.name,
      license: `HS-${truth.medic}-${String(rng.int(10000, 99999))}`,
      affiliation: rng.pick(data.districts.hospitals),
      validUntil: today + rng.int(2, 30),
    };
  }

  return docs;
}
