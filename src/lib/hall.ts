/**
 * The one shared classroom. Creation was removed from the product — every
 * student on Earth enters the same Hall through this code. The join code uses
 * the classroom alphabet (no I/L/O/0/1); it is seeded by migration 0006.
 */
export const HALL_CODE = (import.meta.env.VITE_HALL_CODE as string | undefined) ?? 'STUDY9'
