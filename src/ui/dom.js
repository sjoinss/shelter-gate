// 안전한 DOM 생성 헬퍼 (19-2장 ②)
// - 문자열은 항상 textContent / 텍스트 노드로만 넣는다.
// - 이벤트 핸들러 속성(on*)과 style 속성은 막는다. 이벤트는 `on`, 동적 스타일은 CSSOM으로.

const BLOCKED_ATTR = /^(on|style$|srcdoc$)/i;
const URL_ATTR = /^(href|src|action|formaction|xlink:href)$/i;
const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;

function applyAttrs(node, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (BLOCKED_ATTR.test(name)) throw new Error(`허용되지 않는 속성: ${name}`);
    if (value === false || value == null) continue;
    const str = value === true ? '' : String(value);
    if (URL_ATTR.test(name) && UNSAFE_URL.test(str)) throw new Error(`허용되지 않는 URL: ${name}`);
    node.setAttribute(name, str);
  }
}

function appendChildren(node, children) {
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    // append(string)은 텍스트 노드로 삽입된다 (HTML 해석 없음)
    node.append(child instanceof Node ? child : String(child));
  }
}

/**
 * el('button', { className: 'btn', text: '승인', attrs: { type: 'button' }, on: { click } })
 */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, attrs, dataset, on } = opts;
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  if (attrs) applyAttrs(node, attrs);
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = String(v);
  if (on) for (const [evt, fn] of Object.entries(on)) node.addEventListener(evt, fn);
  appendChildren(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 요소 생성. 속성 값은 숫자 또는 화이트리스트 문자열만 넘길 것. */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}
