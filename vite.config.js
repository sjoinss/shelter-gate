import { defineConfig } from 'vite';

// 빌드 결과에만 적용하는 CSP (19-2장 ③).
// 개발 서버는 HMR용 인라인 스크립트를 쓰므로 빌드 시에만 주입한다.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// 외부 플러그인 없이 transformIndexHtml 훅만 사용하는 인라인 플러그인
function injectCsp() {
  return {
    name: 'shelter-gate:inject-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  // 상대 경로: GitHub Pages(/shelter-gate/) 같은 하위 경로에서도 그대로 동작
  base: './',
  plugins: [injectCsp()],
  build: {
    sourcemap: false,
    // 작은 에셋을 data: URI로 인라인하지 않는다 (CSP 단순화, 이미지 슬롯은 파일로만 로드)
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // 프로덕션 빌드에서 console/debugger 제거 (Vite 8의 Oxc 미니파이어)
        minify: {
          compress: { dropConsole: true, dropDebugger: true },
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // 공정성 검사(14일 × 시드 300개)는 CI 러너에서 5초를 넘을 수 있다
    testTimeout: 30_000,
  },
});
