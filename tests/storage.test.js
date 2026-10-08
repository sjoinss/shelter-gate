import { describe, it, expect } from 'vitest';
import {
  KEYS,
  safeParse,
  validateSave,
  validateSettings,
  loadGame,
  saveGame,
  clearSave,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
} from '../src/save/storage.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const validSave = () => ({
  version: 3,
  baseSeed: 12345,
  day: 5,
  shelter: {
    capacity: 80,
    occupancy: 5,
    quarantineSeats: 6,
    quarantine: [{ name: '김민준', groupSize: 2, infected: true, dayIn: 4, releaseDay: 6, transferDay: 8 }],
    hiddenInfected: 1,
    food: 120,
    medicine: 8,
    filters: 3,
    kits: 2,
    flags: { bribes: 1, ruleBreaks: 0, eventsSeen: ['outbreak', 'bribe'] },
    trust: 68,
    supplyPoints: 4,
  },
  history: [{ day: 1, processed: 6, correct: 5, mistakes: 1, unprocessed: 0, approvedPeople: 3, trustDelta: -2, infections: 0, majors: 0 }],
});

describe('storage: 검증', () => {
  it('정상 데이터는 그대로 통과', () => {
    expect(validateSave(validSave())).toEqual(validSave());
  });

  it('손상된 JSON은 null', () => {
    expect(safeParse('{"version":1,')).toBeNull();
    expect(safeParse(undefined)).toBeNull();
    expect(safeParse('x'.repeat(300_000))).toBeNull();
  });

  it('잘못된 타입·범위는 거부', () => {
    const cases = [
      (s) => (s.day = '2'),
      (s) => (s.day = 0),
      (s) => (s.day = 15),
      (s) => (s.baseSeed = -1),
      (s) => (s.baseSeed = 1.5),
      (s) => (s.shelter.trust = 101),
      (s) => (s.shelter.trust = NaN),
      (s) => (s.shelter.occupancy = 81),
      (s) => (s.shelter = null),
      (s) => (s.history = 'x'),
      (s) => (s.history = Array.from({ length: 20 }, () => s.history[0])),
      (s) => (s.history[0].day = 99),
      (s) => (s.shelter.hiddenInfected = -1),
      (s) => (s.shelter.food = -5),
      (s) => (s.shelter.kits = 1.5),
      (s) => (s.shelter.flags = null),
      (s) => (s.shelter.flags.bribes = '1'),
      (s) => (s.shelter.flags.eventsSeen = ['<script>']),
      (s) => (s.shelter.flags.eventsSeen = Array.from({ length: 21 }, () => 'bribe')),
      (s) => (s.shelter.quarantine = 'x'),
      (s) => (s.shelter.quarantine[0].infected = 'yes'),
      (s) => (s.shelter.quarantine[0].name = ''),
      (s) => (s.shelter.quarantine[0].name = 'x'.repeat(21)),
      (s) => (s.shelter.quarantine[0].groupSize = 0),
      (s) => (s.shelter.quarantine = Array.from({ length: 51 }, () => s.shelter.quarantine[0])),
    ];
    for (const mutate of cases) {
      const s = validSave();
      mutate(s);
      expect(validateSave(s)).toBeNull();
    }
  });

  it('버전 불일치는 거부 (M1의 v1 저장 포함)', () => {
    expect(validateSave({ ...validSave(), version: 1 })).toBeNull();
    expect(validateSave({ ...validSave(), version: 2 })).toBeNull();
    expect(validateSave({ ...validSave(), version: 4 })).toBeNull();
  });

  it('격리 항목의 모르는 키는 버린다', () => {
    const s = validSave();
    s.shelter.quarantine[0].extra = '<img>';
    expect(validateSave(s).shelter.quarantine[0]).toEqual(validSave().shelter.quarantine[0]);
  });

  it('모르는 키는 버리고, __proto__ 키는 오염을 일으키지 않는다', () => {
    const text = JSON.stringify(validSave()).replace(
      '"version":3',
      '"version":3,"__proto__":{"polluted":true},"extra":"x","constructor":{"prototype":{"polluted":true}}',
    );
    const parsed = safeParse(text);
    const clean = validateSave(parsed);
    expect(clean).toEqual(validSave());
    expect(clean.extra).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('설정: 유효한 값만 반영, 나머지는 기본값', () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = validateSettings({ highContrast: true, fontScale: 99, confirmVerdict: 'maybe', haptics: 'yes' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, highContrast: true });
  });
});

describe('storage: 저장소 입출력', () => {
  it('저장 → 불러오기 왕복', () => {
    const st = memoryStorage();
    expect(saveGame(validSave(), st)).toEqual({ ok: true });
    expect(loadGame(st)).toEqual({ ok: true, data: validSave() });
    clearSave(st);
    expect(loadGame(st)).toEqual({ ok: false, reason: 'none' });
  });

  it('손상된 저장 데이터는 invalid로 안전하게 폴백', () => {
    const st = memoryStorage({ [KEYS.save]: '{broken' });
    expect(loadGame(st)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('저장소 접근이 throw하면 unavailable', () => {
    const throwing = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    expect(loadGame(throwing)).toEqual({ ok: false, reason: 'unavailable' });
    expect(saveGame(validSave(), throwing)).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });

  it('용량 초과는 quota', () => {
    const full = memoryStorage();
    full.setItem = () => {
      const e = new Error('full');
      e.name = 'QuotaExceededError';
      throw e;
    };
    expect(saveGame(validSave(), full)).toEqual({ ok: false, reason: 'quota' });
    expect(saveSettings(DEFAULT_SETTINGS, full)).toEqual({ ok: false, reason: 'quota' });
  });

  it('잘못된 데이터는 저장하지 않는다', () => {
    const st = memoryStorage();
    expect(saveGame({ ...validSave(), day: 'x' }, st)).toEqual({ ok: false, reason: 'invalid' });
    expect(st.map.size).toBe(0);
  });
});
