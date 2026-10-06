/** Frontend hot reload can outpace a running native binary in development. */
export function isMissingUpdaterCommand(error: unknown): boolean {
  return /\bCommand\s+update_(?:platform|download|install)\s+not found\b/.test(String(error));
}
