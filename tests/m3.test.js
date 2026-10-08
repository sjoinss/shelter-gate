import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { createRng } from '../src/core/rng.js';
import { createShelter, runNight, nightlyNeed } from '../src/core/shelterState.js';
import { judge } from '../src/core/scoring.js';
import { startDay, useTool, currentVisitor } from '../src/core/dayFlow.js';
import { pickEvent, applyChoice, canChoose } from '../src/core/events.js';
import { buySupplies, orderCost } from '../src/core/supply.js';
import { generateDay } from '../src/core/visitorGenerator.js';

const { balance, events } = gameData;

describe('M3: 신속 키트', () => {
  it('키트를 쓰면 재고가 줄고, 재고가 없으면 쓸 수 없다', () => {
    let s = startDay(gameData, 1, 7, { ...createShelter(balance), kits: 1 });
    const v = currentVisitor(s);
    const r = useTool(s, 'rapidKit', 0, gameData);
    expect(r.result).toEqual({ tool: 'rapidKit', value: v.exam.rapidKit });
    expect(r.state.kitsLeft).toBe(0);
    expect(r.state.penaltySec).toBe(balance.tools.rapidKit.costSec);
    s = { ...r.state, index: 1 };
    expect(useTool(s, 'rapidKit', 0, gameData).result).toBeNull();
  });

  it('키트가 떨어지면 증상 응답자는 격리가 정답이 된다', () => {
    let found = null;
    for (let seed = 0; seed < 300 && !found; seed++) {
      found = generateDay(gameData, seed, 7).visitors.find((v) => v.noKit && v.correctVerdict === 'approve');
    }
    expect(found).toBeTruthy();
    expect(found.noKit.verdict).toBe('quarantine');
    expect(judge(found, 'approve').kind).toBe('correct');
    expect(judge(found, 'approve', null, { kitsOut: true }).kind).toBe('approvedSick');
    expect(judge(found, 'quarantine', null, { kitsOut: true }).kind).toBe('correct');
  });
});

describe('M3: 물자 소모와 부족', () => {
  const night = (shelter, extra = {}) =>
    runNight(shelter, { day: 7, quarantined: [], approvedInfected: 0, ...extra }, createRng(3), balance);

  it('7일차부터 식량은 인원수만큼, 필터는 하루 1개(60명 초과 시 2개) 소모', () => {
    const s = { ...createShelter(balance), occupancy: 50 };
    const r = night(s);
    expect(r.shelter.food).toBe(s.food - 50);
    expect(r.shelter.filters).toBe(s.filters - 1);
    expect(night({ ...s, occupancy: 70 }).shelter.filters).toBe(s.filters - 2);
  });

  it('6일차 밤까지는 소모하지 않는다', () => {
    const s = { ...createShelter(balance), occupancy: 50 };
    const r = runNight(s, { day: 6, quarantined: [], approvedInfected: 0 }, createRng(3), balance);
    expect(r.shelter.food).toBe(s.food);
  });

  it('식량이 모자라면 신뢰도가 깎이고 재고는 0에서 멈춘다', () => {
    const s = { ...createShelter(balance), occupancy: 50, food: 10 };
    const r = night(s);
    expect(r.shelter.food).toBe(0);
    expect(r.shelter.trust).toBe(s.trust + balance.resources.shortageTrust.food);
    expect(r.report.some((l) => l.text.includes('식량'))).toBe(true);
  });

  it('하루 동안 쓴 키트는 밤에 재고로 반영된다', () => {
    expect(night(createShelter(balance), { kitsLeft: 1 }).shelter.kits).toBe(1);
  });

  it('의료인이 들어오면 의약품을 얻는다', () => {
    const s = createShelter(balance);
    expect(night(s, { medicsAdmitted: 2 }).shelter.medicine).toBe(s.medicine + 2 * balance.resources.medicReward.medicine);
  });

  it('예상 소모량 계산', () => {
    const s = {
      ...createShelter(balance),
      occupancy: 61,
      quarantine: [{ name: 'a', groupSize: 2, infected: true, dayIn: 7, releaseDay: 9, transferDay: 11 }],
    };
    expect(nightlyNeed(s, balance)).toEqual({ food: 61, medicine: 2, filters: 2, kits: 0 });
  });
});

describe('M3: 보급 배분', () => {
  it('포인트 안에서만 살 수 있고, 묶음 단위로 늘어난다', () => {
    const s = { ...createShelter(balance), supplyPoints: 5 };
    const order = { food: 2, kits: 1 };
    expect(orderCost(order, balance)).toBe(3);
    const r = buySupplies(s, order, balance);
    expect(r.ok).toBe(true);
    expect(r.shelter.supplyPoints).toBe(2);
    expect(r.shelter.food).toBe(s.food + 20);
    expect(r.shelter.kits).toBe(s.kits + 2);
    expect(buySupplies(s, { food: 6 }, balance).ok).toBe(false);
    expect(buySupplies(s, { food: -1 }, balance).ok).toBe(false);
    expect(buySupplies(s, { gold: 1 }, balance).ok).toBe(false);
  });
});

describe('M3: 밤 이벤트', () => {
  it('6일차 밤에는 고정 이벤트(집단 발열)가 한 번만 나온다', () => {
    const s = createShelter(balance);
    expect(pickEvent(s, 6, createRng(1), events, balance).id).toBe('outbreak');
    const seen = { ...s, flags: { ...s.flags, eventsSeen: ['outbreak'] } };
    expect(pickEvent(seen, 6, createRng(1), events, balance)).toBeNull();
  });

  it('조건이 맞지 않는 이벤트는 나오지 않는다', () => {
    const s = { ...createShelter(balance), filters: 10, food: 9999 };
    for (let i = 0; i < 200; i++) {
      const ev = pickEvent(s, 8, createRng(i), events, balance);
      if (ev) expect(['ventilation', 'ration', 'family-visit']).not.toContain(ev.id);
    }
  });

  it('선택지 효과가 적용되고, 자원이 모자라면 그 선택지는 고를 수 없다', () => {
    const outbreak = events.events.find((e) => e.id === 'outbreak');
    const s = { ...createShelter(balance), filters: 2, hiddenInfected: 4 };
    expect(canChoose(s, outbreak.choices[0])).toBe(false);
    expect(applyChoice(s, outbreak, 0, createRng(1)).shelter).toBe(s);
    const ok = applyChoice({ ...s, filters: 5 }, outbreak, 0, createRng(1));
    expect(ok.shelter.filters).toBe(2);
    expect(ok.shelter.hiddenInfected).toBe(2);
    expect(ok.shelter.flags.eventsSeen).toContain('outbreak');
  });

  it('뇌물은 부패 기록을 남기고, 약 35% 확률로 적발되어 신뢰도가 깎인다', () => {
    const bribe = events.events.find((e) => e.id === 'bribe');
    const s = createShelter(balance);
    let caught = 0;
    for (let i = 0; i < 400; i++) {
      const r = applyChoice(s, bribe, 0, createRng(i));
      expect(r.shelter.flags.bribes).toBe(1);
      expect(r.shelter.supplyPoints).toBe(6);
      if (r.shelter.trust < s.trust) caught++;
    }
    expect(caught / 400).toBeGreaterThan(0.25);
    expect(caught / 400).toBeLessThan(0.45);
  });
});
