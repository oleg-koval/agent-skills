export function page(list, n, size) {
  return list.slice((n - 1) * size, n * size)
}
