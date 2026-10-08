import { el } from '../dom.js';
import { newGame, continueGame, hasPlayableSave } from '../gameActions.js';
import { openSettingsSheet } from '../components/settingsSheet.js';
import { STORAGE_MESSAGES } from '../../save/storage.js';

export function renderTitle() {
  const save = hasPlayableSave();
  const note = el('p', { className: 'title-screen__note', attrs: { id: 'title-note', role: 'status' } });
  if (save.ok) note.textContent = `${save.data.day}일차 근무 전 기록이 있습니다.`;
  else if (save.reason === 'none') note.textContent = '저장된 기록이 없습니다. 하루 근무를 마치면 자동으로 저장됩니다.';
  else note.textContent = STORAGE_MESSAGES[save.reason];

  let newArmed = false;
  const newBtn = el('button', {
    className: `btn btn--block ${save.ok ? '' : 'btn--primary'}`,
    text: '새로 시작',
    attrs: { type: 'button', 'data-autofocus': !save.ok },
  });
  newBtn.addEventListener('click', () => {
    // 기존 기록이 있으면 한 번 더 눌러야 시작 (기록은 첫 근무일을 마칠 때 덮어써짐)
    if (save.ok && !newArmed) {
      newArmed = true;
      newBtn.textContent = '한 번 더 누르면 새로 시작';
      note.textContent = '새로 시작해 첫날을 마치면 기존 기록은 지워집니다.';
      return;
    }
    newGame();
  });

  const continueBtn = el('button', {
    className: `btn btn--block ${save.ok ? 'btn--primary' : ''}`,
    text: '이어서 근무',
    attrs: { type: 'button', disabled: !save.ok, 'aria-describedby': 'title-note', 'data-autofocus': save.ok },
    on: {
      click: () => {
        const err = continueGame();
        if (err) note.textContent = err;
      },
    },
  });

  const root = el('main', { className: 'screen title-screen', attrs: { 'aria-labelledby': 'title-heading' } }, [
    el('header', { className: 'station-plate' }, [
      el('div', { className: 'station-plate__main' }, [
        el('span', { className: 'line-marker', text: '3', attrs: { 'aria-hidden': 'true' } }),
        el('div', {}, [
          el('h1', { className: 'station-plate__name', text: '제3 지하 대피소', attrs: { id: 'title-heading' } }),
          el('p', { className: 'station-plate__sub', text: '출입 심사 창구' }),
        ]),
      ]),
      el('div', { className: 'station-plate__strip', attrs: { 'aria-hidden': 'true' } }),
    ]),
    el('section', { className: 'posted-notice', attrs: { 'aria-label': '안내문' } }, [
      el('p', {
        text: '이 대피소의 출입구는 하나입니다. 창구 너머에는 그림자만 보입니다. 서류와 메모를 읽고, 규정에 따라 들이거나 돌려보내십시오. 오늘 들인 한 사람이 내일 대피소 전체를 바꿀 수 있습니다.',
      }),
    ]),
    el('nav', { className: 'title-screen__menu', attrs: { 'aria-label': '메인 메뉴' } }, [
      continueBtn,
      newBtn,
      el('button', {
        className: 'btn btn--block',
        text: '설정',
        attrs: { type: 'button' },
        on: { click: () => openSettingsSheet() },
      }),
      note,
    ]),
  ]);

  return { el: root, title: '대피소 게이트' };
}
