export const MAX_PCT = 50

export function applyDiscount(amount, pct) {
  const capped = Math.min(pct, MAX_PCT)
  return amount - (amount * capped) / 100
}
