/** Every address in a stylesheet: `url(...)` and `@import "..."`. `map` returns the replacement. */
export declare function mapCssUrls(css: string, map: (url: string) => string): string;
