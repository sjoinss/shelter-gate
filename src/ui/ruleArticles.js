// 규정을 "제n조 (제목)" 조항으로. 조항 번호는 rules.json 순서를 따른다.
// 오늘 처음 생긴 조항은 '신설', 문구가 바뀐 조항은 '개정'.

export function ruleArticles(activeRules, allRules, day) {
  const order = new Map();
  for (const r of allRules) if (!order.has(r.id)) order.set(r.id, order.size);
  return [...activeRules]
    .sort((a, b) => order.get(a.id) - order.get(b.id))
    .map((r, i) => {
      let mark = null;
      if (r.since === day) {
        const existedBefore = allRules.some((x) => x.id === r.id && x.since < day);
        mark = existedBefore ? '개정' : '신설';
      }
      return { rule: r, no: i + 1, title: r.reason, text: r.text, mark };
    });
}
