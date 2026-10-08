// 하단 시트 / 전체 화면 모달. 포커스 트랩 + 닫기 버튼 + 배경 탭 닫기.
import { el } from '../dom.js';
import { trapFocus } from '../a11y.js';

let counter = 0;

/**
 * @param {{ title: string, body: Node[], actions?: Node[], variant?: 'sheet'|'full', onClose?: () => void }} opts
 * @returns {{ close: () => void, node: HTMLElement }}
 */
export function openSheet({ title, body, actions = [], variant = 'sheet', onClose }) {
  const id = `sheet-title-${++counter}`;
  let release = null;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    release?.();
    backdrop.remove();
    onClose?.();
  }

  const closeBtn = el('button', {
    className: 'btn sheet__close',
    text: '닫기',
    attrs: { type: 'button' },
    on: { click: close },
  });

  const panel = el(
    'div',
    {
      className: `sheet sheet--${variant}`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    },
    [
      el('div', { className: 'sheet__header' }, [el('h2', { className: 'sheet__title', text: title, attrs: { id } }), closeBtn]),
      el('div', { className: 'sheet__body' }, body),
      actions.length ? el('div', { className: 'sheet__actions' }, actions) : null,
    ],
  );

  const backdrop = el('div', { className: 'sheet-backdrop' }, [panel]);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.body.append(backdrop);
  release = trapFocus(panel, { onEscape: close });
  return { close, node: panel };
}
