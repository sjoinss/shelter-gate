// 보급 배분 (11장). 보급 포인트로 식량/의약품/필터/키트를 산다. 모두 채울 수는 없게 설계.

/** order: { food: 묶음 수, medicine: …, … } → 필요한 포인트 */
export function orderCost(order, balance) {
  return Object.entries(order).reduce((sum, [key, packs]) => sum + (balance.shop.items[key]?.price ?? 0) * packs, 0);
}

/** 주문 적용 → { ok, shelter } (포인트가 모자라거나 잘못된 주문이면 ok: false) */
export function buySupplies(shelter, order, balance) {
  const items = balance.shop.items;
  for (const [key, packs] of Object.entries(order)) {
    if (!items[key] || !Number.isInteger(packs) || packs < 0) return { ok: false, shelter };
  }
  const cost = orderCost(order, balance);
  if (cost > shelter.supplyPoints) return { ok: false, shelter };
  const next = { ...shelter, supplyPoints: shelter.supplyPoints - cost };
  for (const [key, packs] of Object.entries(order)) next[key] += packs * items[key].amount;
  return { ok: true, shelter: next };
}
