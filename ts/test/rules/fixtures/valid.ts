// This is a regular explanatory comment
// describing the business logic below

/**
 * JSDoc for the calculateTotal function.
 * @param items - Array of prices
 * @returns The sum of all prices
 */
export function calculateTotal(items: number[]): number {
  // Add up all items using reduce
  return items.reduce((sum, item) => sum + item, 0);
}

// Note: this function assumes all items are non-negative
export function applyDiscount(total: number, percent: number): number {
  // The discount formula: total * (1 - percent/100)
  const discount = total * (1 - percent / 100);
  return Math.round(discount * 100) / 100;
}

/*
 * Multi-line comment explaining the architecture:
 * We use a layered approach where each layer
 * handles one concern. See docs/architecture.md
 * for details.
 */
export function processOrder(): void {
  /* intentional empty block */
}
