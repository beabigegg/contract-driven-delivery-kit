/**
 * Shared change-id safety validation. A change id is joined into a filesystem
 * path (`specs/changes/<id>`), so an unvalidated value such as `../../src` could
 * escape the changes tree. `new` (SAFE_NAME) and `test run`/`test select`
 * (SAFE_CHANGE_ID) already guard their entry points with the same pattern; this
 * is the single source of truth so `gate` and any future command reuse it rather
 * than re-declaring the regex (ADR 0005 §4).
 */
export const SAFE_CHANGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** True when `id` is a safe, path-traversal-free change id. */
export function isSafeChangeId(id: string): boolean {
  return SAFE_CHANGE_ID.test(id);
}
