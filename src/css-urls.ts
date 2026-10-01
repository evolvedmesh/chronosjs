/** Every address in a stylesheet: `url(...)` and `@import "..."`. `map` returns the replacement. */
export function mapCssUrls(css: string, map: (url: string) => string): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote: string, url: string) => {
      const out = map(url.trim());
      return out === url.trim() ? match : `url(${quote || '"'}${out}${quote || '"'})`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, url: string) => {
      const out = map(url);
      return out === url ? match : `@import ${quote}${out}${quote}`;
    });
}
