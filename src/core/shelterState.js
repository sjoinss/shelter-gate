// 대피소 상태: 수용/격리실/신뢰도/보급 포인트 + 밤 처리 (9-3, 11장). UI 비의존.
import { spreadInfections } from './infectionModel.js';

export function createShelter(balance) {
  const b = balance.shelter;
  return {
    capacity: b.capacityMax,
    occupancy: b.initialOccupancy,
    quarantineSeats: b.quarantineSeats,
    quarantine: [], // { name, groupSize, infected, dayIn, releaseDay, transferDay }
    hiddenInfected: 0, // 일반 구역에 있는 (아직 드러나지 않은) 감염자 수 — 플레이어에게 보이지 않음
    trust: b.trustStart,
    supplyPoints: 0,
    ...balance.resources.initial, // food, medicine, filters, kits
    flags: { bribes: 0, ruleBreaks: 0, eventsSeen: [] },
  };
}

export const RESOURCE_KEYS = ['food', 'medicine', 'filters', 'kits', 'reagents'];
export const RESOURCE_LABEL = { food: '식량', medicine: '의약품', filters: '필터', kits: '키트', reagents: 'PCR 시약' };

export function infectedInQuarantine(shelter) {
  return shelter.quarantine.filter((e) => e.infected).reduce((s, e) => s + e.groupSize, 0);
}

/** 하룻밤 예상 소모량 (보급 화면 안내용) */
export function nightlyNeed(shelter, balance) {
  const r = balance.resources;
  return {
    food: shelter.occupancy * r.foodPerPerson,
    medicine: infectedInQuarantine(shelter) * r.medicinePerInfected,
    filters: r.filtersPerDay + (shelter.occupancy > r.extraFilterOccupancy ? 1 : 0),
    kits: 0,
    reagents: 0,
  };
}

export function remainingCapacity(shelter) {
  return Math.max(0, shelter.capacity - shelter.occupancy);
}

export function canAdmit(shelter, people) {
  return remainingCapacity(shelter) >= people;
}

export function quarantineUsed(shelter) {
  return shelter.quarantine.reduce((sum, e) => sum + e.groupSize, 0);
}

export function quarantineFree(shelter) {
  return Math.max(0, shelter.quarantineSeats - quarantineUsed(shelter));
}

/** 정산 결과를 반영한 새 상태 */
export function applyDaySummary(shelter, summary, balance) {
  const trust = Math.min(balance.shelter.trustMax, Math.max(0, shelter.trust + summary.trustDelta));
  return {
    ...shelter,
    occupancy: Math.min(shelter.capacity, shelter.occupancy + summary.approvedPeople),
    trust,
    supplyPoints: shelter.supplyPoints + summary.supplyEarned,
  };
}

const SHORTAGE_TEXT = {
  food: (n) => `식량이 ${n}인분 모자라 배급을 줄였습니다. 주민들의 불만이 큽니다.`,
  medicine: (n) => `의약품이 ${n}개 모자라 격리실 환자 일부가 치료를 받지 못했습니다.`,
  filters: () => '필터가 떨어져 환기 설비를 제대로 돌리지 못했습니다. 감염이 더 잘 번집니다.',
};

function groupName(e) {
  return e.groupSize > 1 ? `${e.name} 일행 ${e.groupSize}명` : e.name;
}

/**
 * 밤 처리: 오늘 격리자 등록 → 일반 구역 감염 발견·확산 → 격리 결과.
 * @param input { day, quarantined: [{ name, groupSize, infected }], approvedInfected }
 * @returns {{ shelter, report: { kind: 'info'|'warn'|'ok', text }[], found: number }}
 */
export function runNight(
  shelter,
  { day, quarantined, approvedInfected, kitsLeft, reagentsLeft, medicsAdmitted = 0, outage = false },
  rng,
  balance,
) {
  const inf = balance.infection;
  const t = balance.scoring.trust;
  const report = [];
  let queue = [...shelter.quarantine];
  let occupancy = shelter.occupancy;
  let trust = shelter.trust;
  const res = balance.resources;
  const stock = {
    food: shelter.food,
    medicine: shelter.medicine,
    filters: shelter.filters,
    kits: kitsLeft ?? shelter.kits,
    reagents: reagentsLeft ?? shelter.reagents ?? 0,
  };
  const consuming = day >= res.consumeFromDay;

  // 1. 오늘 격리실로 보낸 사람 등록
  for (const p of quarantined) {
    queue.push({
      name: p.name,
      groupSize: p.groupSize,
      infected: p.infected,
      dayIn: day,
      releaseDay: day + rng.int(inf.quarantineDays[0], inf.quarantineDays[1]),
      transferDay: day + inf.transferAfterDays,
    });
  }
  if (quarantined.length) {
    const people = quarantined.reduce((s, p) => s + p.groupSize, 0);
    report.push({ kind: 'info', text: `오늘 ${quarantined.length}건, ${people}명을 격리실로 보냈습니다.` });
  }

  // 2. 일반 구역 감염: 드러난 감염자는 격리실로, 그동안 번진 감염은 다음 밤에 드러남
  const found = shelter.hiddenInfected + approvedInfected;
  let hidden = 0;
  if (found > 0) {
    let spread = spreadInfections(rng, found, occupancy, shelter.capacity, balance);
    if (consuming && stock.filters <= 0) spread = Math.ceil(spread * res.noFilterSpreadMultiplier); // 환기 불량
    if (outage) spread = Math.ceil(spread * res.outageSpreadMultiplier); // 정전으로 환기 정지
    const free = Math.max(0, shelter.quarantineSeats - queue.reduce((s, e) => s + e.groupSize, 0));
    const moved = Math.min(found, free);
    if (moved > 0) {
      queue.push({ name: '일반 구역 발열자', groupSize: moved, infected: true, dayIn: day, releaseDay: day + inf.transferAfterDays, transferDay: day + inf.transferAfterDays });
      occupancy -= moved;
    }
    const left = found - moved;
    report.push({
      kind: 'warn',
      text: `일반 구역에서 발열자 ${found}명이 나왔습니다. ${moved}명을 격리실로 옮겼습니다.${left ? ` 격리실이 모자라 ${left}명은 일반 구역에 남았습니다.` : ''}`,
    });
    trust += found * t.perInfectionFound + left * t.untreatedInfection;
    hidden = spread + left;
    if (spread > 0) report.push({ kind: 'warn', text: '밀집 생활로 감염이 번지고 있다는 보고가 있습니다. 추가 발열자가 나올 수 있습니다.' });
  }

  // 3. 격리 결과 (오늘 들어온 사람은 제외)
  const keep = [];
  for (const e of queue) {
    if (e.dayIn === day) {
      keep.push(e);
      continue;
    }
    if (!e.infected && day >= e.releaseDay) {
      if (occupancy + e.groupSize <= shelter.capacity) {
        occupancy += e.groupSize;
        report.push({ kind: 'ok', text: `${groupName(e)}: 음성 판정. 격리를 풀고 대피소에 들였습니다.` });
      } else {
        report.push({ kind: 'warn', text: `${groupName(e)}: 음성 판정. 수용 인원이 가득 차 귀가 조치했습니다.` });
      }
      continue;
    }
    if (e.infected && day >= e.transferDay) {
      report.push({ kind: 'info', text: `${groupName(e)}: 감염 확인. 의료시설로 이송했습니다.` });
      continue;
    }
    if (e.infected && day === e.releaseDay) {
      report.push({ kind: 'warn', text: `${groupName(e)}: 감염 확인. 격리를 유지합니다.` });
    }
    keep.push(e);
  }

  if (outage) {
    report.push({ kind: 'warn', text: '낮의 정전으로 환기 설비가 한동안 멈췄습니다. 공기가 탁해졌습니다.' });
  }

  // 4. 의료인 합류
  if (medicsAdmitted > 0) {
    stock.medicine += medicsAdmitted * res.medicReward.medicine;
    report.push({ kind: 'ok', text: `새로 들어온 의료인 ${medicsAdmitted}명이 의무실을 맡았습니다. 의약품 ${medicsAdmitted * res.medicReward.medicine}개를 확보했습니다.` });
  }

  // 5. 물자 소모 (7일차부터)
  if (consuming) {
    const tempShelter = { ...shelter, occupancy, quarantine: keep };
    const need = nightlyNeed(tempShelter, balance);
    const usedText = [];
    const LABEL = { food: ['식량', '인분'], medicine: ['의약품', '개'], filters: ['필터', '개'] };
    for (const key of ['food', 'medicine', 'filters']) {
      const used = Math.min(stock[key], need[key]);
      const short = need[key] - used;
      stock[key] -= used;
      if (used > 0) usedText.push(`${LABEL[key][0]} ${used}${LABEL[key][1]}`);
      if (short > 0) {
        const penalty = key === 'medicine' ? short * res.shortageTrust.medicine : res.shortageTrust[key];
        trust += penalty;
        report.push({ kind: 'warn', text: SHORTAGE_TEXT[key](short) });
      }
    }
    if (usedText.length) report.push({ kind: 'info', text: `밤사이 ${usedText.join(', ')}을(를) 썼습니다.` });
  }

  // 6. 본부의 PCR 시약 지급
  if (day >= res.reagentAllotment.fromNight) {
    stock.reagents += res.reagentAllotment.amount;
    report.push({ kind: 'info', text: `본부에서 PCR 시약 ${res.reagentAllotment.amount}개가 도착했습니다.` });
  }

  if (report.length === 0) report.push({ kind: 'ok', text: '특이 사항 없음.' });

  return {
    shelter: {
      ...shelter,
      ...stock,
      quarantine: keep,
      occupancy: Math.max(0, occupancy),
      hiddenInfected: hidden,
      trust: Math.min(balance.shelter.trustMax, Math.max(0, trust)),
    },
    report,
    found,
  };
}

export function isGameOver(shelter) {
  return shelter.trust <= 0;
}
