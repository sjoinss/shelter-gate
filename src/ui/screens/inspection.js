// 심사 화면: 역 안내판 / 창구(그림자) + 심사 수첩 + 질문·검사 / 서류 / 규정집 / 도장 받침.
// 게임 규칙은 core/dayFlow.js에 있고, 여기서는 상태를 그리고 입력을 전달만 한다.
import { el } from '../dom.js';
import { announce, trapFocus } from '../a11y.js';
import { gameData } from '../../data/index.js';
import {
  startDay,
  currentVisitor,
  remainingVisitors,
  ask,
  point,
  decide,
  endDay,
  canApproveCurrent,
  canQuarantineCurrent,
  denyReasons,
  useTool,
  recheckReadyAt,
  gameTime,
} from '../../core/dayFlow.js';
import { memoItems, entryLines, answerLine, toolLines, QUESTIONS, TOOLS } from '../../core/describe.js';
import { SYMPTOM_LABEL } from '../../core/infectionModel.js';
import { MAJOR_KINDS } from '../../core/scoring.js';
import { renderSilhouettes } from '../components/silhouette.js';
import { openSheet } from '../components/sheet.js';
import { openSettingsSheet } from '../components/settingsSheet.js';
import { createTimer, formatClock } from '../timer.js';
import { toast, haptic } from '../feedback.js';
import { finishDay, confirmVerdictEnabled } from '../gameActions.js';
import { ruleArticles } from '../ruleArticles.js';

const D = (n) => `D+${n}`;
const LOG_MARK = { action: '>', speech: '', question: '?', exam: '■', system: '·', found: '!', ok: '✓', bad: '✕' };
const VERDICT_TEXT = { approve: '승인', quarantine: '격리', deny: '거부' };
const TABS = [
  { id: 'visitor', label: '창구' },
  { id: 'docs', label: '서류' },
  { id: 'rules', label: '규정집' },
];
const DOC_KINDS = ['idCard', 'permit', 'companionList', 'healthRecord', 'medicalCert'];
const DOC_TITLES = {
  idCard: '대피카드',
  permit: '대피 허가증',
  companionList: '동행자 명부',
  healthRecord: '건강 기록 카드',
  medicalCert: '의료인 증명서',
};
const ARM_MS = 3000;

export function renderInspection({ store, navigate }) {
  const { game, settings } = store.get();
  const { balance } = gameData;
  let s = startDay(gameData, game.baseSeed, game.day, game.shelter);
  const limitSec = s.dayDef.timeLimitSec * (settings.relaxedTimer ? balance.timer.relaxedMultiplier : 1);
  const ruleById = new Map(s.rules.map((r) => [r.id, r]));
  const freeWarnings = balance.scoring.freeWarnings;
  const threshold = balance.infection.feverThreshold;
  const spo2Threshold = balance.infection.spo2Threshold;

  const ui = {
    tab: 'visitor',
    pickMode: false,
    picked: [],
    armed: null,
    armTimer: null,
    overlay: null, // null | 'pause' | 'end'
    pauseAuto: false,
    endReason: null,
    finishArmed: false,
    quitArmed: false,
    log: [],
    presetReason: null,
    mistakes: 0,
    announced: new Set(),
    sheet: null,
    recheckPending: false,
  };
  const pickLabels = new Map();

  // ───────── 공통: 지적할 수 있는 항목 ─────────
  function pick(key, label, content, { block = false, interactive = true } = {}) {
    pickLabels.set(key, label);
    const children = [].concat(content);
    if (!ui.pickMode || !interactive) {
      return el(block ? 'div' : 'span', { className: `pick-static${block ? ' pick--block' : ''}` }, children);
    }
    const selected = ui.picked.includes(key);
    return el(
      'button',
      {
        className: `pick${block ? ' pick--block' : ''}${selected ? ' is-picked' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(selected), 'data-fid': `pick:${key}` },
        on: { click: () => togglePick(key) },
      },
      [selected ? el('span', { className: 'pick__mark', text: '✓', attrs: { 'aria-hidden': 'true' } }) : null, ...children],
    );
  }

  // ───────── 역 안내판 ─────────
  const clock = el('span', { className: 'clock', attrs: { role: 'timer', 'aria-label': '남은 근무 시간' } });
  const todaySlot = el('span', { className: 'station-bar__today' });
  const stats = el('dl', { className: 'station-bar__stats', attrs: { 'aria-label': '대피소 현황' } });
  const pauseBtn = el('button', {
    className: 'station-bar__pause',
    text: '멈춤',
    attrs: { type: 'button', 'aria-label': '일시정지' },
    on: { click: () => pause(false) },
  });

  const stationBar = el('header', { className: 'station-bar' }, [
    el('div', { className: 'station-bar__row' }, [
      el('span', { className: 'line-marker line-marker--small', text: '3', attrs: { 'aria-hidden': 'true' } }),
      el('div', { className: 'station-bar__place' }, [el('h1', { className: 'station-bar__day', text: `${s.day}일차 출입 심사` }), todaySlot]),
      clock,
      pauseBtn,
    ]),
    stats,
  ]);

  function stat(label, value) {
    return el('div', { className: 'stat' }, [el('dt', { text: label }), el('dd', { text: value })]);
  }

  function renderTop() {
    todaySlot.replaceChildren(pick('ref.today', `오늘 날짜 ${D(s.today)}`, el('span', { text: `오늘 ${D(s.today)}` })));
    const items = [stat('수용', `${s.occupancy}/${s.capacity}`)];
    if (s.quarantineEnabled) items.push(stat('격리', `${s.quarantineSeats - s.quarantineFree}/${s.quarantineSeats}`));
    if (s.dayDef.tools.includes('rapidKit')) items.push(stat('키트', String(s.kitsLeft)));
    items.push(stat('신뢰도', String(game.shelter.trust)), stat('대기', `${remainingVisitors(s)}명`));
    stats.replaceChildren(...items);
  }

  // ───────── 서류철 색인 탭 ─────────
  const tabButtons = new Map();
  const tabs = el('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': '심사 영역' } });
  for (const t of TABS) {
    const btn = el('button', {
      className: 'tabs__tab',
      text: t.label,
      attrs: { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}` },
      on: { click: () => selectTab(t.id) },
    });
    tabButtons.set(t.id, btn);
    tabs.append(btn);
  }

  function selectTab(id) {
    ui.tab = id;
    desk.dataset.active = id;
    for (const [tid, btn] of tabButtons) {
      btn.setAttribute('aria-selected', String(tid === id));
      btn.tabIndex = tid === id ? 0 : -1;
    }
  }

  // ───────── 패널 ─────────
  const panel = (id) =>
    el('section', { className: 'panel', dataset: { panel: id }, attrs: { id: `panel-${id}`, role: 'tabpanel', 'aria-labelledby': `tab-${id}` } });
  const panelVisitor = panel('visitor');
  const panelDocs = panel('docs');
  const panelRules = panel('rules');
  const desk = el('main', { className: 'desk', dataset: { active: 'visitor' }, attrs: { id: 'inspection-main' } }, [panelRules, panelVisitor, panelDocs]);

  // 창구: 그림자 → 심사 수첩(메모 + 관찰 기록) → 검사 장비 → 질문
  function renderVisitor() {
    const v = currentVisitor(s);
    if (!v) {
      panelVisitor.replaceChildren(
        el('h2', { className: 'panel__title', text: '창구' }),
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'empty-state__title', text: '창구 앞에 아무도 없습니다.' }),
          el('p', { text: '오늘 근무가 끝났습니다. 근무 보고서를 확인하세요.' }),
        ]),
      );
      return;
    }

    const rec = s.exams[v.id] ?? {};
    const labored = !!rec.breathingDone && v.exam.breathing === 'labored';
    const window_ = el('div', { className: 'booth__window' }, [renderSilhouettes(v.observed, { labored })]);

    const memo = el(
      'ul',
      { className: 'memo__list', attrs: { 'aria-label': '외모 메모' } },
      memoItems(v.observed).map((m) =>
        el('li', { className: m.sign ? 'memo__sign' : '' }, [
          m.key ? pick(m.key, `메모: ${m.text}`, el('span', { text: m.text })) : el('span', { text: m.text }),
        ]),
      ),
    );

    const log = el(
      'ol',
      { className: 'log', attrs: { 'aria-label': '관찰 기록' } },
      ui.log.map((line) => {
        if (line.kind === 'divider') return el('li', { className: 'log__divider', text: line.text });
        const mark = el('span', { className: 'log__mark', text: LOG_MARK[line.kind] ?? '·', attrs: { 'aria-hidden': 'true' } });
        const text = line.kind === 'speech' ? `“${line.text}”` : line.text;
        const label = line.kind === 'speech' ? `진술: ${line.text}` : `검사: ${line.text}`;
        const body = line.key ? pick(line.key, label, el('span', { text })) : el('span', { text });
        return el('li', { className: `log__line log--${line.kind}` }, [mark, body]);
      }),
    );

    panelVisitor.replaceChildren(
      el('h2', { className: 'panel__title' }, [
        el('span', { text: '창구' }),
        el('span', { className: 'panel__meta', text: `${s.index + 1}번째 / ${s.visitors.length}명` }),
      ]),
      window_,
      el('div', { className: 'notebook' }, [memo, log]),
      el('div', { className: 'controls' }, [renderTools(v), renderQuestions(v)]),
    );
  }

  function renderQuestions(v) {
    const asked = s.asked[v.id] ?? [];
    return el('div', { className: 'controls__group', attrs: { role: 'group', 'aria-labelledby': 'q-label' } }, [
      el('p', { className: 'controls__label', text: `질문 (한 번에 ${balance.actions.questionCostSec}초)`, attrs: { id: 'q-label' } }),
      ...s.dayDef.questions.map((q) =>
        el('button', {
          className: 'btn btn--question',
          text: asked.includes(q) ? `${QUESTIONS[q].label} ✓` : QUESTIONS[q].label,
          attrs: { type: 'button', disabled: asked.includes(q) || ui.overlay !== null, 'data-fid': `q:${q}` },
          on: { click: () => onAsk(q) },
        }),
      ),
    ]);
  }

  // 검사 장비 (해금된 것만). 결과는 수첩에 ■ 줄로 남는다
  function renderTools(v) {
    const tools = s.dayDef.tools;
    if (!tools.length) return null;
    const rec = s.exams[v.id] ?? {};
    const busy = ui.overlay !== null;
    const cost = (t) => balance.tools[t].costSec;
    const buttons = [];

    for (const tool of tools) {
      if (tool === 'temperature') {
        if (rec.tempAt == null) {
          buttons.push(toolButton('tool:temp', `${TOOLS.temperature.label} ${cost(tool)}초`, busy, () => onTool(tool)));
        } else if (!rec.recheckDone) {
          const wait = Math.ceil(recheckReadyAt(s, gameData) - gameTime(s, timer.elapsedSec));
          const ready = wait <= 0;
          buttons.push(
            toolButton(
              'tool:temp',
              ready ? `${TOOLS.temperature.recheckLabel} ${cost(tool)}초` : `재측정은 ${wait}초 후`,
              busy || !ready,
              () => onTool(tool),
            ),
          );
        } else {
          buttons.push(toolButton('tool:temp', '체온 측정 끝 ✓', true, null));
        }
        continue;
      }
      const doneKey = { symptoms: 'symptomsDone', rapidKit: 'kitDone', spo2: 'spo2Done', breathing: 'breathingDone' }[tool];
      if (rec[doneKey]) {
        buttons.push(toolButton(`tool:${tool}`, `${TOOLS[tool].label} 끝 ✓`, true, null));
      } else if (tool === 'rapidKit' && s.kitsLeft <= 0) {
        buttons.push(toolButton(`tool:${tool}`, '키트 없음 (재고 0)', true, null));
      } else {
        const extra = tool === 'rapidKit' ? `, 재고 ${s.kitsLeft}` : '';
        buttons.push(toolButton(`tool:${tool}`, `${TOOLS[tool].label} ${cost(tool)}초${extra}`, busy, () => onTool(tool)));
      }
    }

    return el('div', { className: 'controls__group', attrs: { role: 'group', 'aria-labelledby': 'tools-label' } }, [
      el('p', { className: 'controls__label', text: '검사 장비', attrs: { id: 'tools-label' } }),
      ...buttons,
    ]);
  }

  function toolButton(fid, label, disabled, onClick) {
    return el('button', {
      className: 'btn btn--tool',
      text: label,
      attrs: { type: 'button', disabled, 'data-fid': fid },
      on: onClick ? { click: onClick } : {},
    });
  }

  // 서류
  function docBlock(kind, doc, { interactive = true } = {}) {
    const title = DOC_TITLES[kind];
    const row = (label, key, value) => [
      el('dt', { text: label }),
      el('dd', {}, [pick(key, `${title} ${label}: ${value}`, el('span', { text: value }), { interactive })]),
    ];

    let rows = [];
    if (kind === 'idCard') {
      const a = doc.appearance;
      rows = [
        ...row('이름', 'idCard.name', doc.name),
        ...row('성별', 'idCard.sex', doc.sex),
        ...row('나이', 'idCard.age', `${doc.age}세`),
        ...row('거주구역', 'idCard.district', doc.district),
        ...row('발급일', 'idCard.issued', D(doc.issued)),
        ...row('유효기간', 'idCard.expiry', D(doc.expiry)),
      ];
      const appearance = el('dl', { className: 'doc__sub' }, [
        ...row('키', 'idCard.appearance.height', a.height),
        ...row('체격', 'idCard.appearance.build', a.build),
        ...row('머리', 'idCard.appearance.hair', a.hair),
        ...row('특징', 'idCard.appearance.feature', a.feature),
      ]);
      rows.push(el('dt', { text: '인상착의' }), el('dd', { className: 'has-sub' }, [appearance]));
    } else if (kind === 'permit') {
      rows = [
        ...row('이름', 'permit.name', doc.name),
        ...row('발급일', 'permit.issued', D(doc.issued)),
        ...row('유효일', 'permit.validUntil', D(doc.validUntil)),
        ...row('허가 대피소', 'permit.shelter', doc.shelter),
        ...row('발급 기관', 'permit.issuer', doc.issuer),
      ];
    } else if (kind === 'companionList') {
      const table = el('table', { className: 'doc__table' }, [
        el('thead', {}, [el('tr', {}, ['이름', '나이', '관계'].map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]),
        el(
          'tbody',
          {},
          doc.members.map((m) => el('tr', {}, [el('td', { text: m.name }), el('td', { text: `${m.age}세` }), el('td', { text: m.relation })])),
        ),
      ]);
      rows = [
        ...row('신청자', 'companionList.applicant', doc.applicant),
        el('dt', { text: '동행자' }),
        el('dd', {}, [table]),
        ...row('총 인원', 'companionList.total', `${doc.total}명 (신청자 포함)`),
      ];
    } else if (kind === 'healthRecord') {
      rows = [
        ...row('이름', 'healthRecord.name', doc.name),
        ...row('최근 검사', 'healthRecord.lastTest', `${D(doc.lastTest)} 음성`),
        ...row('예방접종', 'healthRecord.vaccinated', doc.vaccinated),
        ...row('지병', 'healthRecord.chronic', doc.chronic),
        ...row('최근 진료', 'healthRecord.recentSymptom', doc.recentSymptom ? `${D(doc.recentVisit)} ${SYMPTOM_LABEL[doc.recentSymptom]}` : '없음'),
      ];
    } else if (kind === 'medicalCert') {
      rows = [
        ...row('이름', 'medicalCert.name', doc.name),
        ...row('면허번호', 'medicalCert.license', doc.license),
        ...row('소속 기관', 'medicalCert.affiliation', doc.affiliation),
        ...row('유효기간', 'medicalCert.validUntil', D(doc.validUntil)),
      ];
    }

    return el('article', { className: `doc doc--${kind}`, attrs: { 'aria-label': title } }, [
      el('header', { className: 'doc__header' }, [
        el('h3', { className: 'doc__title', text: title }),
        interactive
          ? el('button', {
              className: 'btn btn--small',
              text: '크게 보기',
              attrs: { type: 'button', 'aria-label': `${title} 크게 보기` },
              on: { click: () => openViewer(kind, doc, title) },
            })
          : null,
      ]),
      el('dl', { className: 'doc__fields' }, rows),
    ]);
  }

  function openViewer(kind, doc, title) {
    ui.sheet = openSheet({
      title,
      body: [el('div', { className: 'doc-viewer' }, [docBlock(kind, doc, { interactive: false })])],
      variant: 'full',
      onClose: () => (ui.sheet = null),
    });
  }

  function renderDocs() {
    const v = currentVisitor(s);
    const kids = [el('h2', { className: 'panel__title', text: '제출 서류' })];
    if (!v) {
      kids.push(el('div', { className: 'empty-state' }, [el('p', { className: 'empty-state__title', text: '제출된 서류가 없습니다.' })]));
    } else {
      for (const kind of DOC_KINDS) if (v.documents[kind]) kids.push(docBlock(kind, v.documents[kind]));
    }
    panelDocs.replaceChildren(...kids);
  }

  // 규정집: 제n조 조항 + 참고 표
  function renderRules() {
    const { districts } = gameData;
    const closed = new Set(s.dayDef.closedDistricts);
    const articles = ruleArticles(s.rules, gameData.rules.rules, s.day);
    const book = el('div', { className: 'rulebook-panel' }, [
      el('h2', { className: 'rulebook-panel__title', text: '출입 심사 규정' }),
      el('table', { className: 'ref-table' }, [
        el('tbody', {}, [
          el('tr', {}, [
            el('th', { text: '오늘', attrs: { scope: 'row' } }),
            el('td', {}, [pick('ref.today', `오늘 날짜 ${D(s.today)}`, el('span', { text: D(s.today) }))]),
          ]),
          el('tr', {}, [
            el('th', { text: '이곳', attrs: { scope: 'row' } }),
            el('td', {}, [pick('ref.shelter', `이곳: ${districts.shelterName}`, el('span', { text: districts.shelterName }))]),
          ]),
        ]),
      ]),
      el(
        'ol',
        { className: 'rulebook' },
        articles.map((a) =>
          el('li', {}, [
            pick(
              `rule:${a.rule.id}`,
              `제${a.no}조 (${a.title})`,
              [
                el('span', { className: 'rulebook__head' }, [
                  a.mark ? el('span', { className: 'mark-new', text: a.mark }) : null,
                  el('span', { text: `제${a.no}조 (${a.title})` }),
                ]),
                el('span', { className: 'rulebook__text', text: a.text }),
              ],
              { block: true },
            ),
          ]),
        ),
      ),
    ]);

    if (ruleById.has('R-DISTRICT-CODE') || ruleById.has('R-DISTRICT-CLOSED')) {
      book.append(
        el('h3', { className: 'rulebook-panel__sub' }, [pick('ref.districts', '별표 1 구역 목록', el('span', { text: '별표 1. 구역 목록' }))]),
        el('p', { className: 'hint', text: `코드 형식은 ${districts.city}-구역번호 두 자리-블록 대문자입니다. 예: ${districts.city}-03-B` }),
        el('div', { className: 'table-wrap' }, [
          el('table', { className: 'district-table' }, [
            el('thead', {}, [el('tr', {}, ['번호', '구역', '블록', '상태'].map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]),
            el(
              'tbody',
              {},
              districts.districts.map((d) =>
                el('tr', { className: closed.has(d.code) ? 'is-closed' : '' }, [
                  el('td', { text: d.code }),
                  el('td', { text: d.name }),
                  el('td', { text: d.blocks.join(', ') }),
                  el('td', { text: closed.has(d.code) ? '✕ 폐쇄' : '정상' }),
                ]),
              ),
            ),
          ]),
        ]),
      );
    }
    if (s.dayDef.documents.includes('medicalCert')) {
      book.append(
        el('h3', { className: 'rulebook-panel__sub' }, [pick('ref.hospitals', '별표 2 의료기관 목록', el('span', { text: '별표 2. 의료기관 목록' }))]),
        el('p', { className: 'hint', text: `면허번호 형식: ${districts.licenseFormatText}` }),
        el('ul', { className: 'plain-list' }, districts.hospitals.map((h) => el('li', { text: h }))),
      );
    }
    panelRules.replaceChildren(book);
  }

  // ───────── 지적 바 / 도장 받침 ─────────
  const pickBar = el('div', { className: 'pick-bar', attrs: { role: 'region', 'aria-label': '불일치 지적' } });
  const verdictBar = el('footer', { className: 'verdict-bar', attrs: { 'aria-label': '판정' } });

  function renderPickBar() {
    pickBar.hidden = !ui.pickMode;
    if (!ui.pickMode) {
      pickBar.replaceChildren();
      return;
    }
    const kids = [
      el('p', {
        className: 'pick-bar__help',
        text: `서로 맞지 않는 항목 두 개를 형광펜으로 칠하세요 (${ui.picked.length}/2). 서류, 메모, 진술, 검사 결과, 규정집에서 고를 수 있습니다.`,
      }),
    ];
    if (ui.picked.length) {
      kids.push(el('ul', { className: 'pick-bar__chips' }, ui.picked.map((k) => el('li', { className: 'chip', text: pickLabels.get(k) ?? k }))));
    }
    pickBar.replaceChildren(
      ...kids,
      el('div', { className: 'pick-bar__actions' }, [
        el('button', {
          className: 'btn',
          text: '취소',
          attrs: { type: 'button', 'data-fid': 'pick-cancel' },
          on: { click: () => setPickMode(false) },
        }),
        el('button', {
          className: 'btn btn--primary',
          text: '지적하기',
          attrs: { type: 'button', disabled: ui.picked.length !== 2, 'data-fid': 'pick-submit' },
          on: { click: submitPoint },
        }),
      ]),
    );
  }

  function armableVerdict(kind, label, unavailableLabel, available) {
    const blocked = !currentVisitor(s) || ui.overlay !== null || ui.pickMode;
    const armed = ui.armed === kind;
    return el('button', {
      className: `btn verdict-btn verdict-btn--${kind}${armed ? ' is-armed' : ''}`,
      text: !available && currentVisitor(s) ? unavailableLabel : armed ? `한 번 더 눌러 ${label}` : label,
      attrs: { type: 'button', disabled: blocked || !available, 'data-fid': kind },
      on: { click: () => onArmable(kind) },
    });
  }

  function renderVerdict() {
    const v = currentVisitor(s);
    const blocked = !v || ui.overlay !== null;
    const verdicts = [armableVerdict('approve', '승인', '수용 초과', canApproveCurrent(s))];
    if (s.quarantineEnabled) verdicts.push(armableVerdict('quarantine', '격리', '격리실 만석', canQuarantineCurrent(s)));
    verdicts.push(
      el('button', {
        className: 'btn verdict-btn verdict-btn--deny',
        text: '거부',
        attrs: { type: 'button', disabled: blocked || ui.pickMode, 'data-fid': 'deny' },
        on: { click: openReasonSheet },
      }),
    );

    verdictBar.replaceChildren(
      el('button', {
        className: `btn btn--point${ui.pickMode ? ' is-active' : ''}`,
        text: ui.pickMode ? '형광펜 내려놓기' : '불일치 지적',
        attrs: { type: 'button', 'aria-pressed': String(ui.pickMode), disabled: blocked, 'data-fid': 'point' },
        on: { click: () => setPickMode(!ui.pickMode) },
      }),
      el('div', { className: `verdict-bar__verdicts verdict-bar__verdicts--${verdicts.length}`, attrs: { role: 'group', 'aria-label': '판정 도장' } }, verdicts),
    );
  }

  // 판정 순간의 도장 (유일한 연출, 모션 줄이기면 정지 상태로 잠깐)
  const stampHost = el('div', { className: 'stamp-flash', attrs: { 'aria-hidden': 'true' } });
  function stampFlash(verdict) {
    const mark = el('span', { className: `stamp-flash__mark verdict-btn--${verdict}`, text: VERDICT_TEXT[verdict] });
    stampHost.replaceChildren(mark);
    setTimeout(() => {
      if (stampHost.firstChild === mark) mark.remove();
    }, 750);
  }

  // ───────── 오버레이 (일시정지 / 근무 종료) ─────────
  const overlayHost = el('div', { className: 'overlay-host' });
  let releaseOverlay = null;

  function renderOverlay() {
    releaseOverlay?.();
    releaseOverlay = null;
    root.classList.toggle('is-covered', ui.overlay !== null);
    if (!ui.overlay) {
      overlayHost.replaceChildren();
      return;
    }

    let card;
    if (ui.overlay === 'pause') {
      const left = remainingVisitors(s);
      card = el('section', { className: 'overlay-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ov-title' } }, [
        el('h2', { className: 'overlay-card__title', text: '창구 잠시 닫음', attrs: { id: 'ov-title' } }),
        el('p', {
          text: ui.pauseAuto
            ? '화면을 벗어나서 근무 시간을 멈췄습니다. 서류는 덮어 두었습니다.'
            : '근무 시간을 멈췄습니다. 서류는 덮어 두었습니다.',
        }),
        el('div', { className: 'overlay-card__actions' }, [
          el('button', { className: 'btn btn--primary btn--block', text: '창구 다시 열기', attrs: { type: 'button' }, on: { click: resume } }),
          el('button', {
            className: 'btn btn--block',
            text: '설정',
            attrs: { type: 'button' },
            on: { click: () => openSettingsSheet({ allowReset: false }) },
          }),
          el('button', {
            className: 'btn btn--block',
            text: ui.finishArmed ? `한 번 더 누르면 마감, 대기 ${left}명은 미처리` : '오늘 업무 마감',
            attrs: { type: 'button' },
            on: {
              click: () => {
                if (!ui.finishArmed) {
                  ui.finishArmed = true;
                  renderOverlay();
                  return;
                }
                s = endDay(s);
                timer.stop();
                showEnd('manual');
              },
            },
          }),
          el('button', {
            className: 'btn btn--block btn--danger-outline',
            text: ui.quitArmed ? '한 번 더 누르면 나감, 오늘 진행은 저장되지 않음' : '처음 화면으로 나가기',
            attrs: { type: 'button' },
            on: {
              click: () => {
                if (!ui.quitArmed) {
                  ui.quitArmed = true;
                  renderOverlay();
                  return;
                }
                navigate('title');
              },
            },
          }),
        ]),
      ]);
    } else {
      const left = s.visitors.length - s.judgements.length;
      const msg = {
        time: `근무 시간이 끝났습니다.${left ? ` 기다리던 ${left}명은 미처리로 남습니다.` : ''}`,
        done: '오늘 방문자를 모두 처리했습니다.',
        manual: `업무를 마감했습니다.${left ? ` 기다리던 ${left}명은 미처리로 남습니다.` : ''}`,
      }[ui.endReason];
      card = el('section', { className: 'overlay-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ov-title' } }, [
        el('h2', { className: 'overlay-card__title', text: '근무 종료', attrs: { id: 'ov-title' } }),
        el('p', { text: msg }),
        el('div', { className: 'overlay-card__actions' }, [
          el('button', {
            className: 'btn btn--primary btn--block',
            text: '근무 보고서 작성',
            attrs: { type: 'button' },
            on: { click: () => finishDay(s) },
          }),
        ]),
      ]);
      announce(msg, { assertive: true });
    }
    overlayHost.replaceChildren(el('div', { className: 'overlay' }, [card]));
    releaseOverlay = trapFocus(card);
  }

  // ───────── 렌더 ─────────
  function renderAll() {
    const fid = document.activeElement?.dataset?.fid;
    pickLabels.clear();
    renderTop();
    renderRules();
    renderVisitor();
    renderDocs();
    renderPickBar();
    renderVerdict();
    if (fid && ui.overlay === null) {
      const target = root.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  // ───────── 동작 ─────────
  function startVisitorLog(prevLine) {
    const v = currentVisitor(s);
    ui.log = [];
    if (prevLine) ui.log.push(prevLine);
    ui.log.push({ kind: 'divider', text: `${s.index + 1}번째 방문자` });
    ui.log.push(...entryLines(v));
    const memo = memoItems(v.observed).map((m) => m.text).join(', ');
    announce(`${s.index + 1}번째 방문자. 메모: ${memo}`);
  }

  function scrollLogToEnd() {
    requestAnimationFrame(() => {
      panelVisitor.querySelector('.log')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onAsk(q) {
    const v = currentVisitor(s);
    const before = s;
    s = ask(s, q, gameData);
    if (s === before) return;
    const answer = answerLine(v, q);
    ui.log.push({ kind: 'question', text: QUESTIONS[q].prompt }, answer);
    announce(answer.text);
    renderAll();
    scrollLogToEnd();
  }

  function onTool(tool) {
    const r = useTool(s, tool, timer.elapsedSec, gameData);
    if (!r.result) return;
    s = r.state;
    const lines = toolLines(r.result, threshold, spo2Threshold);
    ui.log.push(...lines);
    announce(lines.filter((l) => l.kind === 'exam').map((l) => l.text).join(', '));
    haptic(10);
    if (tool === 'temperature' && !r.result.recheck) ui.recheckPending = true;
    renderAll();
    scrollLogToEnd();
  }

  // 재측정 대기 표시: 패널 전체를 다시 그리지 않고 버튼만 갱신
  function updateRecheckButton() {
    if (!ui.recheckPending) return;
    const readyAt = recheckReadyAt(s, gameData);
    const btn = panelVisitor.querySelector('[data-fid="tool:temp"]');
    if (readyAt == null || !btn) {
      ui.recheckPending = false;
      return;
    }
    const wait = Math.ceil(readyAt - gameTime(s, timer.elapsedSec));
    if (wait <= 0) {
      ui.recheckPending = false;
      btn.disabled = ui.overlay !== null;
      btn.textContent = `${TOOLS.temperature.recheckLabel} ${balance.tools.temperature.costSec}초`;
    } else {
      btn.textContent = `재측정은 ${wait}초 후`;
    }
  }

  function setPickMode(on) {
    ui.pickMode = on;
    ui.picked = [];
    disarm();
    renderAll();
    if (on) announce('지적 모드. 서로 맞지 않는 항목 두 개를 고르세요.');
  }

  function togglePick(key) {
    if (ui.picked.includes(key)) ui.picked = ui.picked.filter((k) => k !== key);
    else ui.picked = [...ui.picked, key].slice(-2);
    haptic(8);
    renderAll();
  }

  function submitPoint() {
    const r = point(s, ui.picked, gameData);
    s = r.state;
    if (r.fault) {
      const reason = ruleById.get(r.fault.rule).reason;
      ui.presetReason = reason;
      ui.log.push({ kind: 'found', text: `불일치 확인: ${reason}` });
      toast(`불일치 확인: ${reason}`, 'success');
      haptic([20, 30, 20]);
    } else {
      ui.log.push({ kind: 'system', text: `지적한 두 항목에서 규정 위반을 찾지 못했습니다. ${balance.actions.wrongPointCostSec}초가 지났습니다.` });
      toast('불일치를 찾지 못했습니다.', 'info');
    }
    ui.pickMode = false;
    ui.picked = [];
    renderAll();
    scrollLogToEnd();
    if (ui.tab !== 'visitor' && r.fault) selectTab('visitor');
    verdictBar.querySelector('[data-fid="point"]')?.focus({ preventScroll: true });
  }

  function disarm() {
    clearTimeout(ui.armTimer);
    ui.armed = null;
  }

  // 승인·격리: 확인 단계가 켜져 있으면 두 번 눌러야 확정
  function onArmable(kind) {
    if (confirmVerdictEnabled() && ui.armed !== kind) {
      ui.armed = kind;
      clearTimeout(ui.armTimer);
      ui.armTimer = setTimeout(() => {
        ui.armed = null;
        renderVerdict();
      }, ARM_MS);
      renderVerdict();
      verdictBar.querySelector(`[data-fid="${kind}"]`)?.focus({ preventScroll: true });
      announce(`한 번 더 누르면 ${VERDICT_TEXT[kind]}합니다.`);
      return;
    }
    commit(kind, null);
  }

  function openReasonSheet() {
    disarm();
    renderVerdict();
    const reasons = denyReasons(s);
    let selected = ui.presetReason;
    const confirmBtn = el('button', {
      className: 'btn verdict-btn verdict-btn--deny btn--block',
      text: '거부 도장 찍기',
      attrs: { type: 'button', disabled: !selected },
    });

    const options = reasons.map((reason, i) => {
      const id = `deny-reason-${i}`;
      return el('label', { className: 'reason-opt', attrs: { for: id } }, [
        el('input', {
          attrs: { type: 'radio', name: 'deny-reason', id, checked: reason === selected },
          on: {
            change: () => {
              selected = reason;
              confirmBtn.disabled = false;
            },
          },
        }),
        el('span', { text: reason }),
        reason === ui.presetReason ? el('span', { className: 'badge--found', text: '지적함' }) : null,
      ]);
    });

    const sheet = openSheet({
      title: '거부 사유',
      body: [
        el('p', {
          className: 'hint',
          text: ui.presetReason ? `지적한 불일치는 '${ui.presetReason}'입니다.` : '지적한 불일치가 없습니다. 사유를 직접 고르세요.',
        }),
        el('fieldset', { className: 'reason-list' }, [el('legend', { className: 'sr-only', text: '거부 사유' }), ...options]),
      ],
      actions: [confirmBtn],
      onClose: () => (ui.sheet = null),
    });
    ui.sheet = sheet;
    confirmBtn.addEventListener('click', () => {
      sheet.close();
      commit('deny', selected);
    });
  }

  function commit(verdict, reason) {
    const v = currentVisitor(s);
    if (!v) return;
    const r = decide(s, verdict, reason);
    if (!r.judgement) {
      toast(verdict === 'quarantine' ? '격리실 자리가 모자랍니다.' : '수용 인원이 부족해 승인할 수 없습니다.', 'warning');
      return;
    }
    s = r.state;
    disarm();
    ui.presetReason = null;
    ui.pickMode = false;
    ui.picked = [];
    ui.recheckPending = false;
    stampFlash(verdict);

    const j = r.judgement;
    const verdictText = verdict === 'deny' ? `거부 (${reason})` : VERDICT_TEXT[verdict];
    if (j.correct) {
      haptic(15);
    } else if (MAJOR_KINDS.has(j.kind)) {
      toast('중대 오심입니다. 격리 대상을 들여보냈습니다. 경고 없이 벌점이 붙습니다.', 'error', { duration: 4200 });
      haptic([80, 60, 80]);
    } else {
      ui.mistakes++;
      const label = ui.mistakes <= freeWarnings ? `경고 ${ui.mistakes}/${freeWarnings}` : '벌점';
      toast(`${label}. 규정에 맞지 않는 처리입니다. 해설은 근무 보고서에 있습니다.`, 'warning', { duration: 3600 });
      haptic([40, 60, 40]);
    }
    const prev = { kind: j.correct ? 'ok' : 'bad', text: `앞사람 ${j.name}: ${verdictText}${j.correct ? '' : ', 규정 위반'}` };

    if (s.ended) {
      timer.stop();
      ui.log = [prev];
      showEnd('done');
      return;
    }
    startVisitorLog(prev);
    selectTab('visitor');
    renderAll();
    panelVisitor.scrollTo?.({ top: 0 });
  }

  function showEnd(reason) {
    ui.endReason = reason;
    ui.overlay = 'end';
    ui.sheet?.close();
    renderAll();
    renderOverlay();
  }

  function pause(auto) {
    if (ui.overlay) return;
    timer.pause();
    ui.sheet?.close();
    disarm();
    ui.overlay = 'pause';
    ui.pauseAuto = auto;
    ui.finishArmed = false;
    ui.quitArmed = false;
    renderAll();
    renderOverlay();
  }

  function resume() {
    if (ui.overlay !== 'pause') return;
    ui.overlay = null;
    renderOverlay();
    renderAll();
    timer.start();
    pauseBtn.focus();
  }

  // ───────── 타이머 ─────────
  function onTick(elapsed) {
    const remaining = limitSec - elapsed - s.penaltySec;
    clock.textContent = formatClock(remaining);
    clock.classList.toggle('is-low', remaining <= 30);
    updateRecheckButton();
    for (const mark of [60, 30, 10]) {
      if (remaining <= mark && remaining > 0 && !ui.announced.has(mark)) {
        ui.announced.add(mark);
        announce(`남은 시간 ${mark}초`, { assertive: mark === 10 });
      }
    }
    if (remaining <= 0 && !s.ended) {
      s = endDay(s);
      timer.stop();
      showEnd('time');
    }
  }
  const timer = createTimer({ onTick });

  function onVisibility() {
    if (document.visibilityState === 'hidden' && timer.running) pause(true);
  }
  document.addEventListener('visibilitychange', onVisibility);

  // ───────── 조립 ─────────
  const root = el('div', { className: 'screen inspection' }, [stationBar, tabs, desk, pickBar, verdictBar, stampHost, overlayHost]);

  selectTab('visitor');
  startVisitorLog(null);
  renderAll();
  onTick(0);
  timer.start();

  return {
    el: root,
    title: `${s.day}일차 출입 심사`,
    cleanup() {
      timer.stop();
      disarm();
      releaseOverlay?.();
      ui.sheet?.close();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
