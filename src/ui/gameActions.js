// 게임 진행 액션: 새 게임 / 이어하기 / 하루 종료 / 설정 변경. core와 저장소를 연결한다.
import { store } from './store.js';
import { gameData } from '../data/index.js';
import { createShelter, applyDaySummary, isGameOver, runNight } from '../core/shelterState.js';
import { createRng, daySeed } from '../core/rng.js';
import { pickEvent, applyChoice } from '../core/events.js';
import { buySupplies } from '../core/supply.js';
import { pickEnding } from '../core/endings.js';
import { summarizeDay } from '../core/scoring.js';
import { dayResult } from '../core/dayFlow.js';
import { loadGame, saveGame, clearSave, saveSettings, STORAGE_MESSAGES, SAVE_VERSION } from '../save/storage.js';

function randomSeed() {
  // 디버그용 ?seed= 는 개발 모드에서만 (프로덕션 빌드에서는 이 분기가 제거됨)
  if (import.meta.env.DEV) {
    const param = new URLSearchParams(location.search).get('seed');
    if (param !== null && /^\d{1,10}$/.test(param)) return Number(param) >>> 0;
  }
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export function hasPlayableSave() {
  return loadGame();
}

export function newGame() {
  store.set({
    game: { baseSeed: randomSeed(), day: 1, shelter: createShelter(gameData.balance), history: [] },
    lastSummary: null,
    saveStatus: null,
    ending: null,
    screen: 'briefing',
  });
}

/** → 실패 사유 문구 또는 null */
export function continueGame() {
  const res = loadGame();
  if (!res.ok) return res.reason === 'none' ? '저장된 기록이 없습니다.' : STORAGE_MESSAGES[res.reason];
  const { baseSeed, day, shelter, history } = res.data;
  if (day > gameData.days.lastPlayableDay) return '저장된 기록의 일차는 현재 빌드에서 아직 진행할 수 없습니다.';
  store.set({ game: { baseSeed, day, shelter, history }, lastSummary: null, saveStatus: null, ending: null, screen: 'briefing' });
  return null;
}

function persist(game) {
  const res = saveGame({ version: SAVE_VERSION, ...game });
  return res.ok ? { ok: true } : { ok: false, message: STORAGE_MESSAGES[res.reason] };
}

/** 심사 종료 → 정산 계산, 대피소 상태 반영, 밤 처리, 자동 저장 */
export function finishDay(dayState) {
  const { game } = store.get();
  const { balance } = gameData;
  const result = dayResult(dayState);
  const summary = summarizeDay(result, balance);
  const afterDay = applyDaySummary(game.shelter, summary, balance);

  // 밤: 격리 등록, 일반 구역 감염 발견·확산, 격리 결과 (일차별 시드로 재현 가능)
  const nightRng = createRng((daySeed(game.baseSeed, game.day) ^ 0x9e3779b9) >>> 0);
  const night = runNight(
    afterDay,
    {
      day: game.day,
      quarantined: result.quarantined,
      approvedInfected: result.approvedInfected,
      kitsLeft: result.kitsLeft,
      reagentsLeft: result.reagentsLeft,
      medicsAdmitted: result.medicsAdmitted,
      outage: result.outage,
    },
    nightRng,
    balance,
  );
  const shelter = night.shelter;

  const history = [
    ...game.history,
    {
      day: summary.day,
      processed: summary.processed,
      correct: summary.correct,
      mistakes: summary.mistakes.length,
      unprocessed: summary.unprocessed,
      approvedPeople: summary.approvedPeople,
      trustDelta: shelter.trust - game.shelter.trust,
      infections: night.found,
      majors: summary.majors,
      denied: result.denied,
      hiddenAdmitted: result.undetected.length,
    },
  ];

  let ending = null;
  let saveStatus = null;
  const next = { baseSeed: game.baseSeed, day: game.day + 1, shelter, history };

  const lastDay = game.day >= gameData.days.lastPlayableDay;
  if (isGameOver(shelter)) {
    ending = decideEnding(shelter, history);
    clearSave();
  } else if (!lastDay) {
    saveStatus = persist(next);
  }

  // 밤 이벤트 (게임 오버가 아닐 때). 마지막 날은 최종 이벤트 뒤에 엔딩을 정한다
  const event = ending ? null : pickEvent(shelter, game.day, nightRng, gameData.events, balance);
  if (lastDay && !ending && !event) {
    ending = decideEnding(shelter, history);
    clearSave();
  }

  store.set({
    game: next,
    lastSummary: { summary, shelterBefore: game.shelter, shelterAfter: afterDay, undetected: result.undetected },
    lastNight: { day: game.day, report: night.report, shelterBefore: afterDay, shelterAfter: shelter },
    pendingEvent: event ? { event, day: game.day, seed: nightRng.int(0, 0x7fffffff), outcome: null } : null,
    saveStatus,
    ending,
    screen: 'summary',
  });
}

function decideEnding(shelter, history) {
  const { ending, stats } = pickEnding(shelter, history, gameData.endings);
  return { kind: ending.id, ending, stats };
}

/** 밤 보고 다음 화면: 이벤트 → (마지막 날이면 엔딩) → 보급 → 브리핑 */
export function nextAfterNight() {
  const { ending, pendingEvent, game } = store.get();
  if (ending) return 'ending';
  if (pendingEvent && !pendingEvent.outcome) return 'event';
  if (game.day - 1 >= gameData.days.lastPlayableDay) {
    store.set({ ending: decideEnding(game.shelter, game.history) });
    clearSave();
    return 'ending';
  }
  if (game.day - 1 >= gameData.balance.shop.openFromDay) return 'supply';
  return 'briefing';
}

/** 이벤트 선택 적용 + 저장 */
export function chooseEvent(index) {
  const { pendingEvent, game } = store.get();
  if (!pendingEvent || pendingEvent.outcome) return;
  const before = game.shelter;
  const { shelter, result } = applyChoice(before, pendingEvent.event, index, createRng(pendingEvent.seed));
  if (shelter === before) return;
  const next = { ...game, shelter };
  let ending = null;
  if (isGameOver(shelter)) {
    ending = decideEnding(shelter, game.history);
    clearSave();
  }
  const lastDay = game.day - 1 >= gameData.days.lastPlayableDay;
  store.set({
    game: next,
    ending,
    pendingEvent: { ...pendingEvent, outcome: { index, result, before, after: shelter } },
    saveStatus: ending || lastDay ? null : persist(next),
  });
}

/** 보급 주문 → 실패 시 안내 문구, 성공 시 null */
export function confirmSupplies(order) {
  const { game } = store.get();
  const r = buySupplies(game.shelter, order, gameData.balance);
  if (!r.ok) return '보급 포인트가 모자랍니다. 수량을 줄이세요.';
  const next = { ...game, shelter: r.shelter };
  const saveStatus = persist(next);
  store.set({ game: next, saveStatus });
  return saveStatus.ok ? null : saveStatus.message;
}

export function retrySave() {
  const { game } = store.get();
  store.set({ saveStatus: persist(game) });
}

/** → 실패 시 안내 문구, 성공 시 null */
export function updateSettings(patch) {
  const settings = { ...store.get().settings, ...patch };
  store.set({ settings });
  const res = saveSettings(settings);
  return res.ok ? null : STORAGE_MESSAGES[res.reason];
}

export function resetSave() {
  const res = clearSave();
  return res.ok ? null : STORAGE_MESSAGES[res.reason];
}

/** 판정 확인 단계가 켜져 있는지 (auto: 터치 기기 또는 좁은 화면) */
export function confirmVerdictEnabled() {
  const mode = store.get().settings.confirmVerdict;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return matchMedia('(pointer: coarse)').matches || innerWidth <= 768;
}
