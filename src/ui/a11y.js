// 스크린리더 알림(live region)과 포커스 관리

/** aria-live 영역으로 알린다. 같은 문구를 연속으로 보내도 다시 읽히도록 비웠다가 채운다. */
export function announce(message, { assertive = false } = {}) {
  const region = document.getElementById(assertive ? 'live-assertive' : 'live-polite');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
}

/** 화면 전환 후 제목(또는 data-autofocus 요소)으로 포커스를 옮긴다. */
export function focusScreen(container) {
  const target = container.querySelector('[data-autofocus]') ?? container.querySelector('h1, h2');
  if (!target) return;
  if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1');
  target.focus();
}

/**
 * 모달/패널용 포커스 트랩. 반환된 release()를 호출하면 트랩을 풀고 이전 포커스로 돌아간다.
 */
export function trapFocus(container, { onEscape } = {}) {
  const previous = document.activeElement;

  function onKeydown(e) {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableIn(container);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeydown);
  (focusableIn(container)[0] ?? container).focus();

  return function release() {
    container.removeEventListener('keydown', onKeydown);
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
}
