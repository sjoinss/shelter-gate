// 설정 시트. 타이틀과 일시정지 화면에서 같은 것을 연다 (화면 전환 없이 진행 상태 유지).
import { el } from '../dom.js';
import { openSheet } from './sheet.js';
import { store } from '../store.js';
import { updateSettings, resetSave } from '../gameActions.js';
import { toast } from '../feedback.js';
import { FONT_SCALES } from '../../save/storage.js';

const FONT_LABELS = ['작게', '보통', '크게', '아주 크게'];

let fieldId = 0;

function radioGroup(legend, name, options, current, onChange, hint) {
  const hintId = hint ? `hint-${++fieldId}` : null;
  return el('fieldset', { className: 'setting', attrs: hintId ? { 'aria-describedby': hintId } : {} }, [
    el('legend', { className: 'setting__label', text: legend }),
    hint ? el('p', { className: 'setting__hint', text: hint, attrs: { id: hintId } }) : null,
    el(
      'div',
      { className: 'segmented' },
      options.map(([value, label]) => {
        const id = `opt-${++fieldId}`;
        const input = el('input', {
          attrs: { type: 'radio', name, id, checked: value === current },
          on: { change: () => onChange(value) },
        });
        return el('label', { className: 'segmented__opt', attrs: { for: id } }, [input, el('span', { text: label })]);
      }),
    ),
  ]);
}

function toggle(label, checked, onChange, hint) {
  const id = `tgl-${++fieldId}`;
  const hintId = hint ? `${id}-hint` : null;
  return el('div', { className: 'setting setting--toggle' }, [
    el('label', { className: 'toggle', attrs: { for: id } }, [
      el('input', {
        attrs: { type: 'checkbox', id, checked, 'aria-describedby': hintId },
        on: { change: (e) => onChange(e.target.checked) },
      }),
      el('span', { className: 'setting__label', text: label }),
    ]),
    hint ? el('p', { className: 'setting__hint', text: hint, attrs: { id: hintId } }) : null,
  ]);
}

function apply(patch) {
  const err = updateSettings(patch);
  if (err) toast(err, 'warning', { duration: 5000 });
}

export function openSettingsSheet({ allowReset = true } = {}) {
  const s = store.get().settings;

  let resetArmed = false;
  const resetBtn = el('button', {
    className: 'btn btn--danger-outline btn--block',
    text: '저장 초기화',
    attrs: { type: 'button' },
  });
  resetBtn.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = '한 번 더 누르면 저장 기록을 지웁니다';
      return;
    }
    const err = resetSave();
    resetArmed = false;
    resetBtn.textContent = '저장 초기화';
    if (err) toast(err, 'error', { duration: 5000 });
    else toast('저장 기록을 지웠습니다.', 'success');
  });

  const body = [
    radioGroup(
      '글자 크기',
      'fontScale',
      FONT_SCALES.map((v, i) => [v, FONT_LABELS[i]]),
      s.fontScale,
      (v) => apply({ fontScale: v }),
    ),
    toggle('고대비', s.highContrast, (v) => apply({ highContrast: v })),
    toggle('모션 줄이기', s.reducedMotion, (v) => apply({ reducedMotion: v }), '그림자의 움직임을 멈춥니다. 징후는 메모로만 표시됩니다.'),
    toggle(
      '시간 여유 모드',
      s.relaxedTimer,
      (v) => apply({ relaxedTimer: v }),
      '하루 근무 시간이 1.5배가 됩니다. 다음 근무일부터 적용됩니다.',
    ),
    radioGroup(
      '판정 확인 단계',
      'confirmVerdict',
      [
        ['auto', '자동'],
        ['on', '켜기'],
        ['off', '끄기'],
      ],
      s.confirmVerdict,
      (v) => apply({ confirmVerdict: v }),
      '켜면 승인 버튼을 두 번 눌러야 확정됩니다. 자동은 터치 화면에서 켜집니다.',
    ),
    toggle('진동', s.haptics, (v) => apply({ haptics: v }), '지원하는 기기에서만 동작합니다.'),
    allowReset ? el('div', { className: 'setting' }, [resetBtn]) : null,
  ];

  return openSheet({ title: '설정', body, variant: 'sheet' });
}
