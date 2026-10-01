/**
 * What the DOM doesn't hold but the user saw: hover, press and focus states,
 * and media queries that answered for the user's browser (dark mode, reduced
 * motion, touch). The player's iframe can't be hovered or focused and asks
 * the viewer's browser for its preferences, so the page's CSS is adapted:
 *
 * - each rule using `:hover`, `:active`, `:focus`, `:focus-visible` or
 *   `:focus-within` also gets a selector where the pseudo-class is a
 *   `[data-chronos-…]` attribute, and the player sets those attributes on the
 *   elements that were in that state. The rule keeps its place, so the cascade
 *   is unchanged;
 * - media queries on the user's preferences are rewritten to always or never
 *   match, as they did for the user.
 *
 * Only stylesheets the viewer may read are adapted: inline styles, CSS-in-JS
 * rules, inlined stylesheets and same-origin (or CORS-enabled) files.
 */
export const STATE_ATTRIBUTE = "data-chronos-";
const PSEUDO = /:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g;
const HAS_PSEUDO = /:(hover|active|focus)/;
const ALWAYS = "(min-width: 0px)";
const NEVER = "(max-width: 0px)";
export function parseEnv(flags) {
    const text = typeof flags === "string" ? flags : "";
    return {
        dark: text.includes("d"),
        reducedMotion: text.includes("m"),
        coarse: text.includes("c"),
        noHover: text.includes("n"),
    };
}
const FEATURES = [
    [/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, (env) => env.dark],
    [/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, (env) => !env.dark],
    [/\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/gi, (env) => env.reducedMotion],
    [/\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/gi, (env) => !env.reducedMotion],
    [/\(\s*(?:any-)?pointer\s*:\s*coarse\s*\)/gi, (env) => env.coarse],
    [/\(\s*(?:any-)?pointer\s*:\s*fine\s*\)/gi, (env) => !env.coarse],
    [/\(\s*(?:any-)?hover\s*:\s*hover\s*\)/gi, (env) => !env.noHover],
    [/\(\s*(?:any-)?hover\s*:\s*none\s*\)/gi, (env) => env.noHover],
];
/** A media query as it answered in the user's browser. */
export function rewriteMedia(media, env) {
    let out = media;
    for (const [pattern, matches] of FEATURES)
        out = out.replace(pattern, () => (matches(env) ? ALWAYS : NEVER));
    return out;
}
/** The selector list plus a copy where state pseudo-classes are attributes. */
export function rewriteSelector(selector) {
    if (!HAS_PSEUDO.test(selector))
        return undefined;
    const copy = selector.replace(PSEUDO, (_, state) => `[${STATE_ATTRIBUTE}${state}]`);
    return copy === selector ? undefined : `${selector}, ${copy}`;
}
export class Emulator {
    doc;
    seen = new WeakSet();
    states = new Map();
    env = parseEnv("");
    override;
    /** Set when the page's styles may have changed; `refresh()` clears it. */
    dirty = true;
    constructor(doc) {
        this.doc = doc;
    }
    /** A new snapshot: new nodes and stylesheets, maybe another browser. */
    reset(env) {
        this.env = env;
        this.seen = new WeakSet();
        this.states.clear();
        this.dirty = true;
    }
    /** Adapt stylesheets the page gained since the last call. */
    refresh() {
        if (!this.dirty)
            return;
        this.dirty = false;
        for (const sheet of Array.from(this.doc.styleSheets)) {
            if (!this.seen.has(sheet.media)) {
                this.seen.add(sheet.media);
                this.media(sheet.media);
            }
            let rules;
            try {
                rules = sheet.cssRules;
            }
            catch {
                continue; // A cross-origin stylesheet the viewer may not read.
            }
            this.rules(rules);
        }
        this.colorScheme();
    }
    /** Put a state on these elements (and take it off the others). */
    set(state, elements) {
        const previous = this.states.get(state) ?? [];
        const name = STATE_ATTRIBUTE + state;
        for (const el of previous)
            if (!elements.includes(el))
                el.removeAttribute(name);
        for (const el of elements)
            if (!el.hasAttribute(name))
                el.setAttribute(name, "");
        this.states.set(state, elements);
    }
    rules(list) {
        for (const rule of Array.from(list)) {
            const fresh = !this.seen.has(rule);
            if (fresh)
                this.seen.add(rule);
            if (fresh && "selectorText" in rule) {
                const style = rule;
                const selector = rewriteSelector(style.selectorText);
                // An invalid copy (a pseudo-element before the state) is ignored by the setter.
                if (selector)
                    style.selectorText = selector;
            }
            if (fresh && "media" in rule && rule.media && "conditionText" in rule) {
                this.media(rule.media);
            }
            if ("styleSheet" in rule && rule.styleSheet) {
                try {
                    this.rules(rule.styleSheet?.cssRules);
                }
                catch {
                    // Imported from another origin.
                }
            }
            // Grouping rules (@media, @supports, @layer, nesting) can gain rules later.
            if ("cssRules" in rule && rule.cssRules)
                this.rules(rule.cssRules);
        }
    }
    media(media) {
        const text = media.mediaText;
        if (!text)
            return;
        const rewritten = rewriteMedia(text, this.env);
        if (rewritten !== text)
            media.mediaText = rewritten;
    }
    /**
     * A page that declares `color-scheme: light dark` renders in the scheme the
     * browser prefers: give it the user's, not the viewer's.
     */
    colorScheme() {
        const view = this.doc.defaultView;
        const root = this.doc.documentElement;
        if (!view || !root || !("adoptedStyleSheets" in this.doc))
            return;
        this.doc.adoptedStyleSheets = this.doc.adoptedStyleSheets.filter((sheet) => sheet !== this.override);
        const declared = view.getComputedStyle(root).colorScheme;
        const wanted = this.env.dark ? "dark" : "light";
        if (!declared.includes(wanted) || declared === wanted)
            return;
        this.override ??= new view.CSSStyleSheet();
        this.override.replaceSync(`:root { color-scheme: ${wanted} !important; }`);
        this.doc.adoptedStyleSheets = [...this.doc.adoptedStyleSheets, this.override];
    }
}
/** The element and its ancestors, as `:hover`, `:active` and `:focus-within` apply. */
export function withAncestors(el) {
    const out = [];
    for (let node = el; node; node = node.parentElement)
        out.push(node);
    return out;
}
//# sourceMappingURL=emulate.js.map