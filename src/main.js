import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { store } from './ui/store.js';
import { focusScreen } from './ui/a11y.js';
import { loadSettings } from './save/storage.js';
import { renderTitle } from './ui/screens/title.js';
import { renderBriefing } from './ui/screens/briefing.js';
import { renderInspection } from './ui/screens/inspection.js';
import { renderSummary } from './ui/screens/summary.js';
import { renderNight } from './ui/screens/night.js';
import { renderEvent } from './ui/screens/event.js';
import { renderSupply } from './ui/screens/supply.js';
import { renderEnding } from './ui/screens/ending.js';

const SCREENS = {
  title: renderTitle,
  briefing: renderBriefing,
  inspection: renderInspection,
  summary: renderSummary,
  night: renderNight,
  event: renderEvent,
  supply: renderSupply,
  ending: renderEnding,
};

// 게임 진행 상태가 필요한 화면 (없으면 타이틀로)
const NEEDS_GAME = new Set(['briefing', 'inspection', 'summary', 'night', 'event', 'supply', 'ending']);

const app = document.getElementById('app');
let current = null;
let currentName = null;

function navigate(screen, patch = {}) {
  store.set({ ...patch, screen });
}

function mount(name) {
  current?.cleanup?.();
  let target = SCREENS[name] ? name : 'title';
  if (NEEDS_GAME.has(target) && !store.get().game) target = 'title';
  current = SCREENS[target]({ store, navigate });
  current.el.id = 'screen';
  app.replaceChildren(current.el);
  document.title = current.title === '대피소 게이트' ? current.title : `${current.title} | 대피소 게이트`;
  window.scrollTo(0, 0);
  focusScreen(current.el);
}

/** 설정을 문서 루트 속성/CSS 변수로 반영 (인라인 style 속성 대신 CSSOM 사용) */
function applySettings(settings) {
  const root = document.documentElement;
  root.dataset.motion = settings.reducedMotion ? 'reduced' : 'normal';
  root.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  root.style.setProperty('--font-scale', String(settings.fontScale));
}

let lastSettings = null;
store.subscribe((state) => {
  if (state.settings !== lastSettings) {
    lastSettings = state.settings;
    applySettings(state.settings);
  }
  if (state.screen !== currentName) {
    currentName = state.screen;
    mount(state.screen);
  }
});

currentName = store.get().screen;
store.set({ settings: loadSettings() });
mount(currentName);
