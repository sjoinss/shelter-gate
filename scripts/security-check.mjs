#!/usr/bin/env node
// 금지 API · 비밀값 · 외부 리소스 패턴 검사 (19-2장 ⑦)
// 의존성 없는 Node 스크립트. 하나라도 발견되면 exit 1.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 검사 대상: 소스, 정적 파일, 엔트리 HTML, 빌드 결과(있으면)
const TARGETS = ['src', 'public', 'index.html', 'vite.config.js', 'dist'];
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.txt', '.xml']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

// [이름, 정규식, 적용 범위(선택)]
const RULES = [
  // ② 금지 API
  ['금지 API: innerHTML', /\binnerHTML\b/],
  ['금지 API: outerHTML', /\bouterHTML\b/],
  ['금지 API: insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['금지 API: document.write', /\bdocument\s*\.\s*write(ln)?\s*\(/],
  ['금지 API: eval(', /(^|[^.\w$])eval\s*\(/],
  ['금지 API: new Function', /\bnew\s+Function\s*\(/],
  ['금지 API: 문자열 setTimeout/setInterval', /\bset(Timeout|Interval)\s*\(\s*['"`]/],

  // ① 비밀값 패턴
  ['비밀값: AWS 액세스 키', /AKIA[0-9A-Z]{16}/],
  ['비밀값: sk- 형식 키', /sk-[A-Za-z0-9]{20,}/],
  ['비밀값: Google API 키', /AIza[0-9A-Za-z_-]{35}/],
  ['비밀값: GitHub 토큰', /gh[pousr]_[A-Za-z0-9]{36}/],
  ['비밀값: 개인 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['비밀값: 키/비밀번호 할당', /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]+['"]/i],

  // ④ 외부 리소스 로드
  ['외부 스크립트', /<script[^>]*\ssrc\s*=\s*["']?(https?:)?\/\//i, ['.html']],
  ['외부 link', /<link[^>]*\shref\s*=\s*["']?(https?:)?\/\//i, ['.html']],
  ['CDN/외부 폰트 도메인', /(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|googletagmanager\.com|google-analytics\.com)/i],
  ['CSS 외부 import/url', /(@import\s+(url\()?\s*["']?https?:|url\(\s*["']?https?:)/i, ['.css', '.html']],

  // ③ CSP 위반 마크업 (인라인 스크립트/스타일/이벤트 핸들러)
  ['인라인 <script> (src 없음)', /<script(?![^>]*\ssrc=)[^>]*>\s*\S/i, ['.html']],
  ['인라인 <style>', /<style[\s>]/i, ['.html']],
  ['style 속성', /<[a-z][^>]*\sstyle\s*=/i, ['.html']],
  ['인라인 이벤트 핸들러', /<[a-z][^>]*\son[a-z]+\s*=/i, ['.html']],
];

const findings = [];

function walk(path) {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return;
    for (const name of readdirSync(path)) walk(join(path, name));
    return;
  }
  const rel = relative(ROOT, path).replaceAll('\\', '/');
  const ext = extname(path).toLowerCase();

  // 빌드 결과에 소스맵이 있으면 실패
  if (rel.startsWith('dist/') && ext === '.map') {
    findings.push({ file: rel, line: 0, rule: '빌드 결과에 소스맵 포함', text: '' });
    return;
  }
  if (!TEXT_EXT.has(ext)) return;

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [name, re, exts] of RULES) {
      if (exts && !exts.includes(ext)) continue;
      if (re.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: name, text: line.trim().slice(0, 120) });
      }
    }
  });
}

// .env* 파일은 이 프로젝트에 존재하면 안 된다 (19-2장 ①)
for (const name of readdirSync(ROOT)) {
  if (name === '.env' || name.startsWith('.env.')) {
    findings.push({ file: name, line: 0, rule: '.env 파일 존재', text: '' });
  }
}

for (const t of TARGETS) walk(join(ROOT, t));

const scanned = TARGETS.filter((t) => existsSync(join(ROOT, t)));
if (findings.length === 0) {
  console.log(`✓ 보안 점검 통과 (검사 대상: ${scanned.join(', ')})`);
  if (!scanned.includes('dist')) console.log('  참고: dist/가 없어 빌드 결과는 검사하지 않았습니다. npm run build 후 다시 실행하세요.');
  process.exit(0);
}

console.error(`✕ 보안 점검 실패: ${findings.length}건`);
for (const f of findings) {
  console.error(`  - [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ''}${f.text ? `  ${f.text}` : ''}`);
}
process.exit(1);
