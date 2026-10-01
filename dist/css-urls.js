/** Every address in a stylesheet: `url(...)` and `@import "..."`. `map` returns the replacement. */
export function mapCssUrls(css, map) {
    return css
        .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, url) => {
        const out = map(url.trim());
        return out === url.trim() ? match : `url(${quote || '"'}${out}${quote || '"'})`;
    })
        .replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, url) => {
        const out = map(url);
        return out === url ? match : `@import ${quote}${out}${quote}`;
    });
}
//# sourceMappingURL=css-urls.js.map