import { describe, it, expect } from 'vitest';
import { gameData } from '../src/data/index.js';
import { createRng } from '../src/core/rng.js';
import { rollHealth, spreadInfections } from '../src/core/infectionModel.js';
import { startDay, useTool, currentVisitor, recheckReadyAt } from '../src/core/dayFlow.js';
import { createShelter } from '../src/core/shelterState.js';

const { balance } = gameData;
const TH = balance.infection.feverThreshold;
const N = 20000;
const TOL = 0.02;

function rate(stage, pred) {
  const rng = createRng(31337 + stage.length);
  let hits = 0;
  for (let i = 0; i < N; i++) if (pred(rollHealth(rng, stage, balance))) hits++;
  return hits / N;
}

describe('infectionModel: 검사별 감지 확률 (9-2, 허용 오차 ±2%p)', () => {
  const det = balance.infection.detection;
  for (const stage of ['none', 'incubating', 'symptomatic']) {
    it(`체온 첫 측정 37.5°C 이상 — ${stage}`, () => {
      expect(Math.abs(rate(stage, (h) => h.results.temperature.first >= TH) - det.temperature[stage])).toBeLessThan(TOL);
    });
    it(`증상 응답 1개 이상 — ${stage}`, () => {
      const r = rate(stage, (h) => Object.values(h.results.symptoms).some(Boolean));
      expect(Math.abs(r - det.symptoms[stage])).toBeLessThan(TOL);
    });
  }

  it('비감염 오탐(뛰어온 사람)은 재측정하면 항상 정상', () => {
    const rng = createRng(5);
    for (let i = 0; i < N; i++) {
      const h = rollHealth(rng, 'none', balance);
      expect(h.results.temperatureFinal).toBeLessThan(TH);
    }
  });

  it('증상기 감염자의 높은 체온은 재측정해도 37.5°C 이상', () => {
    const rng = createRng(6);
    for (let i = 0; i < N; i++) {
      const h = rollHealth(rng, 'symptomatic', balance);
      if (h.results.temperature.first >= TH) expect(h.results.temperature.recheck).toBeGreaterThanOrEqual(TH);
    }
  });
});

describe('infectionModel: 결과 사전 확정 (재검사 불변)', () => {
  it('같은 방문자에게 같은 검사를 반복해도 결과가 바뀌지 않는다', () => {
    const s0 = startDay(gameData, 99, 5, createShelter(balance));
    const v = currentVisitor(s0);
    const a = useTool(s0, 'symptoms', 0, gameData);
    expect(a.result.answers).toEqual(v.exam.symptoms);
    // 두 번째 문답은 수행되지 않음 (시간도 소모하지 않음)
    const b = useTool(a.state, 'symptoms', 1, gameData);
    expect(b.result).toBeNull();
    expect(b.state.penaltySec).toBe(a.state.penaltySec);
    // 다른 시드로 다시 생성해도 같은 (baseSeed, day)면 같은 결과
    const again = currentVisitor(startDay(gameData, 99, 5, createShelter(balance)));
    expect(again.exam).toEqual(v.exam);
  });

  it('체온 재측정은 첫 측정 후 게임 시간 5초가 지나야 가능하고 한 번만', () => {
    let s = startDay(gameData, 3, 4, createShelter(balance));
    const v = currentVisitor(s);
    const first = useTool(s, 'temperature', 0, gameData);
    expect(first.result).toEqual({ tool: 'temperature', value: v.exam.temperature.first, recheck: false });
    s = first.state;
    const ready = recheckReadyAt(s, gameData);
    expect(ready).toBe(balance.tools.temperature.costSec + balance.tools.temperature.recheckDelaySec);
    expect(useTool(s, 'temperature', 1, gameData).result).toBeNull(); // 아직 이르다
    const re = useTool(s, 'temperature', ready, gameData);
    expect(re.result).toEqual({ tool: 'temperature', value: v.exam.temperature.recheck, recheck: true });
    expect(useTool(re.state, 'temperature', ready + 10, gameData).result).toBeNull();
  });

  it('해금 전 장비는 사용할 수 없다', () => {
    const s = startDay(gameData, 3, 3, createShelter(balance));
    expect(useTool(s, 'temperature', 0, gameData).result).toBeNull();
    const s4 = startDay(gameData, 3, 4, createShelter(balance));
    expect(useTool(s4, 'symptoms', 0, gameData).result).toBeNull();
  });
});

describe('infectionModel: 확산', () => {
  it('감염자가 없으면 확산 없음, 밀도가 높을수록 기대 확산이 크다', () => {
    const rng = createRng(1);
    expect(spreadInfections(rng, 0, 50, 80, balance)).toBe(0);
    let low = 0;
    let high = 0;
    for (let i = 0; i < 2000; i++) {
      low += spreadInfections(rng, 2, 10, 80, balance);
      high += spreadInfections(rng, 2, 78, 80, balance);
    }
    expect(high).toBeGreaterThan(low);
  });

  it('확산 수는 건강한 인원을 넘지 않는다', () => {
    const rng = createRng(2);
    for (let i = 0; i < 500; i++) expect(spreadInfections(rng, 5, 6, 80, balance)).toBeLessThanOrEqual(1);
  });
});
