// Test-only helpers for the lookout suites. Imported by *.test.ts files, never by production code.

// Matches a rendered action button by its visible label, so a server-rendered panel can be asserted
// on the label the navigator reads rather than on markup order.
export const ACTION_BUTTON = (label: string): RegExp =>
  new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`);
