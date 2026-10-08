// 경과 시간 기반 타이머 (19-1). performance.now() 차이로 계산하고, 일시정지 중 시간은 반영하지 않는다.

export function createTimer({ onTick, intervalMs = 250 }) {
  let elapsedMs = 0;
  let startedAt = null; // 실행 중이면 performance.now() 기준 시각
  let handle = null;

  function current() {
    return elapsedMs + (startedAt === null ? 0 : performance.now() - startedAt);
  }

  function tick() {
    onTick(current() / 1000);
  }

  return {
    start() {
      if (startedAt !== null) return;
      startedAt = performance.now();
      handle = setInterval(tick, intervalMs);
      tick();
    },
    pause() {
      if (startedAt === null) return;
      elapsedMs = current();
      startedAt = null;
      clearInterval(handle);
      handle = null;
    },
    get running() {
      return startedAt !== null;
    },
    get elapsedSec() {
      return current() / 1000;
    },
    stop() {
      this.pause();
    },
  };
}

export function formatClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
