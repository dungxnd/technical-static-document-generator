/**
 * Reads a design token off the document root.
 *
 * Some third-party renderers (Mermaid) need concrete colour values at call
 * time rather than CSS variables, so components read the resolved token here
 * instead of hardcoding a palette that would drift from the theme.
 */
export function readToken(name: string, fallback = ''): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readTokens(names: string[]): string[] {
  const styles = getComputedStyle(document.documentElement);
  return names.map((name) => styles.getPropertyValue(name).trim());
}
