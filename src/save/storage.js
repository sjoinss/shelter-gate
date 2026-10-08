// localStorage 저장/불러오기 (20장, 19-2 ⑥).
// 저장 데이터는 변조될 수 있는 입력으로 취급한다: 허용 목록으로 검증하고, 통과한 필드만 새 객체에 복사한다.

export const SAVE_VERSION = 3; // 2: 격리실·감염 상태 (M2), 3: 물자·이벤트 기록 (M3)
export const KEYS = Object.freeze({
  save: 'shelterGate.v1.save',
  settings: 'shelterGate.v1.settings',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_RAW_LENGTH = 200_000;
const MAX_DAY = 14;

/** 프로토타입 오염 키를 버리는 JSON 파서. 실패 시 null */
export function safeParse(text) {
  if (typeof text !== 'string' || text.length > MAX_RAW_LENGTH) return null;
  try {
    return JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
  } catch {
    return null;
  }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const MAX_QUARANTINE = 50;
const MAX_NAME = 20;

function validateQuarantineEntry(e) {
  if (!isObj(e)) return null;
  if (typeof e.name !== 'string' || e.name.length === 0 || e.name.length > MAX_NAME) return null;
  if (!isInt(e.groupSize, 1, 10)) return null;
  if (typeof e.infected !== 'boolean') return null;
  for (const k of ['dayIn', 'releaseDay', 'transferDay']) if (!isInt(e[k], 1, 30)) return null;
  return {
    name: e.name,
    groupSize: e.groupSize,
    infected: e.infected,
    dayIn: e.dayIn,
    releaseDay: e.releaseDay,
    transferDay: e.transferDay,
  };
}

const RESOURCE_FIELDS = ['food', 'medicine', 'filters', 'kits'];
const EVENT_ID = /^[a-z0-9-]{1,30}$/;

function validateFlags(f) {
  if (!isObj(f)) return null;
  if (!isInt(f.bribes, 0, 1000) || !isInt(f.ruleBreaks, 0, 1000)) return null;
  if (!Array.isArray(f.eventsSeen) || f.eventsSeen.length > 20) return null;
  if (!f.eventsSeen.every((id) => typeof id === 'string' && EVENT_ID.test(id))) return null;
  return { bribes: f.bribes, ruleBreaks: f.ruleBreaks, eventsSeen: [...f.eventsSeen] };
}

function validateShelter(s) {
  if (!isObj(s)) return null;
  if (!isInt(s.capacity, 0, 1000)) return null;
  if (!isInt(s.occupancy, 0, s.capacity)) return null;
  if (!isInt(s.quarantineSeats, 0, 100)) return null;
  if (!isNum(s.trust, 0, 100)) return null;
  if (!isInt(s.supplyPoints, 0, 100_000)) return null;
  if (!isInt(s.hiddenInfected, 0, 1000)) return null;
  for (const k of RESOURCE_FIELDS) if (!isInt(s[k], 0, 100_000)) return null;
  const flags = validateFlags(s.flags);
  if (!flags) return null;
  if (!Array.isArray(s.quarantine) || s.quarantine.length > MAX_QUARANTINE) return null;
  const quarantine = [];
  for (const e of s.quarantine) {
    const clean = validateQuarantineEntry(e);
    if (!clean) return null;
    quarantine.push(clean);
  }
  return {
    capacity: s.capacity,
    occupancy: s.occupancy,
    quarantineSeats: s.quarantineSeats,
    quarantine,
    hiddenInfected: s.hiddenInfected,
    food: s.food,
    medicine: s.medicine,
    filters: s.filters,
    kits: s.kits,
    flags,
    trust: s.trust,
    supplyPoints: s.supplyPoints,
  };
}

function validateHistoryEntry(h) {
  if (!isObj(h)) return null;
  const fields = ['day', 'processed', 'correct', 'mistakes', 'unprocessed', 'approvedPeople', 'trustDelta', 'infections', 'majors'];
  const out = {};
  for (const f of fields) {
    const min = f === 'trustDelta' ? -1000 : 0;
    if (!isInt(h[f], min, 1000)) return null;
    out[f] = h[f];
  }
  if (out.day < 1 || out.day > MAX_DAY) return null;
  return out;
}

/** 저장 데이터 검증. 통과하면 정리된 새 객체, 아니면 null */
export function validateSave(raw) {
  if (!isObj(raw)) return null;
  if (raw.version !== SAVE_VERSION) return null;
  if (!isInt(raw.baseSeed, 0, 0xffffffff)) return null;
  if (!isInt(raw.day, 1, MAX_DAY)) return null;
  const shelter = validateShelter(raw.shelter);
  if (!shelter) return null;
  if (!Array.isArray(raw.history) || raw.history.length > MAX_DAY) return null;
  const history = [];
  for (const h of raw.history) {
    const entry = validateHistoryEntry(h);
    if (!entry) return null;
    history.push(entry);
  }
  return { version: SAVE_VERSION, baseSeed: raw.baseSeed, day: raw.day, shelter, history };
}

export const DEFAULT_SETTINGS = Object.freeze({
  reducedMotion: false,
  highContrast: false,
  fontScale: 1,
  relaxedTimer: false,
  confirmVerdict: 'auto',
  haptics: true,
});

export const FONT_SCALES = [0.9, 1, 1.15, 1.3];
const CONFIRM_MODES = ['auto', 'on', 'off'];

/** 설정 검증: 항목별로 유효한 값만 받고 나머지는 기본값 */
export function validateSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!isObj(raw)) return out;
  for (const key of ['reducedMotion', 'highContrast', 'relaxedTimer', 'haptics']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (FONT_SCALES.includes(raw.fontScale)) out.fontScale = raw.fontScale;
  if (CONFIRM_MODES.includes(raw.confirmVerdict)) out.confirmVerdict = raw.confirmVerdict;
  return out;
}

function getStorage(storage) {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null; // 사생활 보호 모드 등에서 접근 자체가 throw
  }
}

/** → { ok: true, data } | { ok: false, reason: 'none' | 'invalid' | 'unavailable' } */
export function loadGame(storage) {
  const s = getStorage(storage);
  if (!s) return { ok: false, reason: 'unavailable' };
  let text;
  try {
    text = s.getItem(KEYS.save);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (text == null) return { ok: false, reason: 'none' };
  const data = validateSave(safeParse(text));
  return data ? { ok: true, data } : { ok: false, reason: 'invalid' };
}

/** → { ok: true } | { ok: false, reason: 'invalid' | 'quota' | 'unavailable' } */
export function saveGame(data, storage) {
  const clean = validateSave(data);
  if (!clean) return { ok: false, reason: 'invalid' };
  const s = getStorage(storage);
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(KEYS.save, JSON.stringify(clean));
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unavailable' };
  }
}

export function clearSave(storage) {
  const s = getStorage(storage);
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.removeItem(KEYS.save);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function loadSettings(storage) {
  const s = getStorage(storage);
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    return validateSettings(safeParse(s.getItem(KEYS.settings)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage) {
  const s = getStorage(storage);
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(KEYS.settings, JSON.stringify(validateSettings(settings)));
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unavailable' };
  }
}

/** 오류 사유 → 사용자 안내 문구 (원인과 대처) */
export const STORAGE_MESSAGES = {
  invalid: '저장 데이터를 불러올 수 없어 새로 시작합니다. 데이터가 손상되었거나 이전 버전의 기록입니다.',
  unavailable: '이 브라우저에서는 저장 공간을 사용할 수 없습니다. 사생활 보호 모드를 끄면 진행 상황을 저장할 수 있습니다.',
  quota: '저장 공간이 부족해 저장하지 못했습니다. 브라우저의 사이트 데이터를 정리한 뒤 다시 시도하세요.',
};
