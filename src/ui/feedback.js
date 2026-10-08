// Toast(✓/⚠/✕ + 텍스트)와 선택적 햅틱
import { el } from './dom.js';
import { store } from './store.js';

const ICONS = { success: '✓', warning: '⚠', error: '✕', info: '·' };
let region = null;

function ensureRegion() {
  if (region?.isConnected) return region;
  region = el('div', { className: 'toasts' });
  document.body.append(region);
  return region;
}

/** type: 'success' | 'warning' | 'error' | 'info' */
export function toast(message, type = 'info', { duration = 2600 } = {}) {
  const urgent = type === 'warning' || type === 'error';
  const node = el(
    'div',
    { className: `toast toast--${type}`, attrs: { role: urgent ? 'alert' : 'status' } },
    [el('span', { className: 'toast__icon', text: ICONS[type], attrs: { 'aria-hidden': 'true' } }), el('span', { text: message })],
  );
  const r = ensureRegion();
  r.append(node);
  while (r.children.length > 3) r.firstChild.remove();
  setTimeout(() => node.remove(), duration);
}

/** 진동 (지원하지 않는 브라우저에서는 조용히 무시) */
export function haptic(pattern = 15) {
  if (!store.get().settings.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 미지원 */
  }
}
