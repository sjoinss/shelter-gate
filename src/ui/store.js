// 단순 구독형 store. 게임 로직은 core/에 있고, 여기는 UI가 보는 상태만 담는다.
import { DEFAULT_SETTINGS } from '../save/storage.js';

export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    /** 얕은 병합으로 상태를 갱신하고 구독자에게 알린다. */
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore({
  screen: 'title',
  settings: { ...DEFAULT_SETTINGS },
  // game: { baseSeed, day, shelter, history } — 진행 중인 게임 (일차 시작 상태)
  game: null,
  // 직전 정산 결과와 저장 결과
  lastSummary: null,
  lastNight: null,
  // 밤 이벤트: { event, day, seed, outcome }
  pendingEvent: null,
  saveStatus: null,
  // 엔딩: { kind: 'gameover' | 'buildEnd' }
  ending: null,
});
