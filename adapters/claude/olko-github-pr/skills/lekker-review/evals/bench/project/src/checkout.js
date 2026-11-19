import { total } from './cart.js'
import { applyDiscount } from './discount.js'

export function checkout(items, pct) {
  return applyDiscount(total(items), pct)
}
