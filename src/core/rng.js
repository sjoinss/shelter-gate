// 시드 기반 난수 (mulberry32). UI 비의존 — Node에서 단독 테스트 가능.
// 같은 시드 → 항상 같은 수열 (18장 재현성 원칙)

/** 일차별 시드 = baseSeed + dayNumber (6장) */
export function daySeed(baseSeed, day) {
  return (baseSeed + day) >>> 0;
}

export function createRng(seed) {
  let a = seed >>> 0;

  /** [0, 1) 균등 분포 */
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** [min, max] 정수 (양 끝 포함) */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** 확률 p로 true */
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      if (arr.length === 0) throw new Error('빈 배열에서 pick할 수 없습니다');
      return arr[Math.floor(next() * arr.length)];
    },
    /** 새 배열을 반환하는 Fisher–Yates 셔플 */
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** [[value, weight], ...] 에서 가중치 선택 */
    weighted(entries) {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) {
        r -= w;
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}
