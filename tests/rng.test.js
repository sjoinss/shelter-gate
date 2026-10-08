import { describe, it, expect } from 'vitest';
import { createRng, daySeed } from '../src/core/rng.js';

describe('rng', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('다른 시드는 다른 수열을 만든다', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next()는 [0, 1) 범위다', () => {
    const r = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, max)는 양 끝을 포함하고 범위를 벗어나지 않는다', () => {
    const r = createRng(99);
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('chance(p)는 대량 시행에서 p에 근접한다', () => {
    const r = createRng(2024);
    const n = 20000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (r.chance(0.3)) hits++;
    expect(hits / n).toBeCloseTo(0.3, 1);
  });

  it('shuffle은 원본을 바꾸지 않고 같은 원소를 유지한다', () => {
    const r = createRng(5);
    const src = [1, 2, 3, 4, 5, 6];
    const out = r.shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
  });

  it('daySeed = baseSeed + day', () => {
    expect(daySeed(1000, 3)).toBe(1003);
  });
});
