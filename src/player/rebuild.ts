import { mapCssUrls } from "../css-urls.js";
import {
  attrsOf,
  childrenOf,
  isElement,
  type SAdd,
  type SAttrChange,
  type SAttrs,
  type SElement,
  type SNode,
  type STextChange,
} from "../format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * A replay is untrusted input: anyone with the app's (public) ingestion key
 * can send one. These elements are never built from a replay; an inert
 * placeholder takes their place so node ids stay in step.
 */
const INERT_TAGS = new Set(["script", "base", "meta", "object", "embed", "applet", "frame", "frameset", "portal"]);
/** Attributes holding one address. */
const URL_ATTRS = new Set([
  "src",
  "href",
  "poster",
  "xlink:href",
  "background",
  "data",
  "action",
  "formaction",
  "cite",
]);
/** Attributes never set from a replay. */
const DROPPED_ATTRS = new Set(["srcdoc", "ping", "http-equiv", "formaction", "action", "integrity", "nonce"]);
const UNSAFE_URL = /^\s*(javascript|vbscript|data:text\/html|data:application|data:image\/svg)/i;

export interface BuilderOptions {
  /** Inlined stylesheets from the replay, by URL. */
  assets?: Record<string, string>;
  /**
   * A document that renders (the player's iframe): CSSOM rules and scroll
   * positions are applied. Off for the detached document used to label actions.
   */
  live: boolean;
  /**
   * Where to load an address of the recorded page from (images, stylesheets,
   * fonts, backgrounds). Gets the absolute URL; return another (a proxy on
   * your own origin, say). Default: the URL itself.
   */
  resolveUrl?: (url: string) => string;
  /** Nodes one snapshot and its changes may create, at most. Default 500,000. */
  maxNodes?: number;
}

/**
 * Rebuilds a recorded page in a document. Node ids are assigned in the same
 * order the recorder assigned them: document order within a snapshot, then
 * counting up from `firstNewId` for each mutation.
 */
export class DomBuilder {
  nodes: (Node | undefined)[] = [];
  private next = 1;
  private deferred: (() => void)[] = [];
  /** The document scroll position last applied, re-applied when stylesheets load. */
  private docScroll: [number, number] = [0, 0];
  /** The recorded page's address, which relative addresses resolve against. */
  private base = "about:blank";

  constructor(
    readonly doc: Document,
    readonly options: BuilderOptions,
  ) {}

  /** Replace the document's content with a snapshot of the page at `href`. */
  snapshot(tree: SElement, href: string, scrollX = 0, scrollY = 0): void {
    const doc = this.doc;
    this.nodes = [];
    this.next = 1;
    this.base = safeHref(href);
    // The <base> goes in before any element exists, so every relative URL
    // (images, stylesheets, srcset) resolves against the recorded page.
    const html = doc.createElement("html");
    const head = doc.createElement("head");
    const base = doc.createElement("base");
    base.setAttribute("href", this.options.resolveUrl ? "about:blank" : this.base);
    head.appendChild(base);
    html.appendChild(head);
    doc.replaceChild(html, doc.documentElement);

    this.assign(html);
    this.setAttrs(html, attrsOf(tree));
    let headUsed = false;
    for (const child of childrenOf(tree)) {
      if (!headUsed && isElement(child) && child[0] === "head") {
        headUsed = true;
        this.assign(head);
        this.setAttrs(head, attrsOf(child));
        for (const grandchild of childrenOf(child)) head.appendChild(this.create(grandchild, false, "head"));
      } else {
        html.appendChild(this.create(child, false, "html"));
      }
    }
    this.docScroll = [scrollX, scrollY];
    this.runDeferred();
    this.scrollDocument(scrollX, scrollY);
  }

  mutate(
    firstNewId: number,
    removes: number[] = [],
    adds: SAdd[] = [],
    attrs: SAttrChange[] = [],
    texts: STextChange[] = [],
  ): void {
    this.next = firstNewId;
    for (const id of removes) {
      const node = this.nodes[id];
      node?.parentNode?.removeChild(node);
    }
    for (const [parentId, previousId, serialized] of adds) {
      const parent = this.nodes[parentId];
      // Built even without a parent, so the ids that follow stay in step.
      const node = this.create(
        serialized,
        parent ? inSvg(parent) : false,
        parent?.nodeType === 1 ? (parent as Element).localName : "",
      );
      if (!parent) continue;
      let ref: Node | null = parent.firstChild;
      if (previousId) {
        const previous = this.nodes[previousId];
        ref = previous && previous.parentNode === parent ? previous.nextSibling : null;
      }
      try {
        parent.insertBefore(node, ref);
      } catch {
        // A node that can't go there (e.g. text in the document itself).
      }
    }
    for (const [id, change] of attrs) {
      const node = this.nodes[id];
      // Nodes live in the iframe's realm: test nodeType, never instanceof.
      if (node?.nodeType === 1) this.setAttrs(node as Element, change);
    }
    for (const [id, text] of texts) {
      const node = this.nodes[id];
      const css = node?.parentNode?.nodeType === 1 && (node.parentNode as Element).localName === "style";
      const value = css ? this.css(text) : text;
      if (node && (node.nodeType === 3 || node.nodeType === 4 || node.nodeType === 8))
        (node as CharacterData).data = value;
      else if (node?.nodeType === 1 && !INERT_TAGS.has((node as Element).localName)) node.textContent = value;
    }
    this.runDeferred();
  }

  input(id: number, value: string | number): void {
    const el = this.nodes[id];
    if (!el) return;
    setValue(el, value);
  }

  scroll(id: number, x: number, y: number): void {
    if (!this.options.live) return;
    if (id === 0) {
      this.docScroll = [x, y];
      this.scrollDocument(x, y);
      return;
    }
    const el = this.nodes[id];
    if (el?.nodeType === 1) {
      (el as Element).scrollLeft = x;
      (el as Element).scrollTop = y;
    }
  }

  cssRule(id: number, index: number, rule?: string): void {
    if (!this.options.live) return;
    const sheet = (this.nodes[id] as HTMLStyleElement | undefined)?.sheet;
    if (!sheet) return;
    try {
      if (rule === undefined) sheet.deleteRule(index);
      else sheet.insertRule(this.css(rule), Math.min(index, sheet.cssRules.length));
    } catch {
      // A rule this browser doesn't understand.
    }
  }

  /** Where the page is scrolled to, for re-applying once styles have loaded. */
  restoreScroll(): void {
    this.scrollDocument(...this.docScroll);
  }

  private view(): (Window & typeof globalThis) | null {
    return this.doc.defaultView as (Window & typeof globalThis) | null;
  }

  private scrollDocument(x: number, y: number): void {
    if (this.options.live) this.view()?.scrollTo(x, y);
  }

  private assign(node: Node): void {
    if (this.next > (this.options.maxNodes ?? 500_000)) throw new Error("chronosjs: the replay is too large to show");
    this.nodes[this.next++] = node;
  }

  /** An address of the recorded page as the player loads it, or null when it must not be loaded. */
  url(value: string): string | null {
    const trimmed = value.trim();
    if (UNSAFE_URL.test(trimmed)) return null;
    if (/^(#|data:|blob:|about:)/i.test(trimmed) || trimmed === "") return trimmed;
    let absolute: string;
    try {
      absolute = new URL(trimmed, this.base).href;
    } catch {
      return null;
    }
    if (!/^https?:/i.test(absolute)) return null;
    return this.options.resolveUrl ? this.options.resolveUrl(absolute) : absolute;
  }

  /** A stylesheet with its addresses resolved. */
  css(text: string): string {
    if (!this.options.resolveUrl && !/javascript:|vbscript:/i.test(text)) return text;
    return mapCssUrls(text, (url) => this.url(url) ?? "about:blank");
  }

  private srcset(value: string): string {
    return value
      .split(",")
      .map((candidate) => {
        const [url, ...descriptor] = candidate.trim().split(/\s+/);
        const resolved = url ? this.url(url) : null;
        return resolved ? [resolved, ...descriptor].join(" ") : "";
      })
      .filter(Boolean)
      .join(", ");
  }

  private create(serialized: SNode, svg: boolean, parentTag: string): Node {
    const doc = this.doc;
    if (typeof serialized === "string") {
      if (INERT_TAGS.has(parentTag)) {
        const comment = doc.createComment("");
        this.assign(comment);
        return comment;
      }
      const text = doc.createTextNode(parentTag === "style" ? this.css(serialized) : serialized);
      this.assign(text);
      return text;
    }
    if (serialized === 0) {
      const comment = doc.createComment("");
      this.assign(comment);
      return comment;
    }
    const tag = serialized[0];
    const attrs = attrsOf(serialized);
    const isSvg = attrs?.$ns ? attrs.$ns === "s" : svg || tag === "svg";
    let el: Element;
    const asset = tag === "link" && typeof attrs?.href === "string" ? this.asset(attrs.href) : undefined;
    const inert = INERT_TAGS.has(tag.toLowerCase());
    if (asset !== undefined) {
      el = doc.createElement("style");
      el.textContent = this.css(asset);
    } else if (inert) {
      el = doc.createElement(`chronos-${tag.toLowerCase()}`);
      el.setAttribute("hidden", "");
    } else {
      try {
        el = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
      } catch {
        el = doc.createElement("div");
      }
    }
    this.assign(el);
    if (asset === undefined && !inert) this.setAttrs(el, attrs, true);
    const childSvg = isSvg && tag !== "foreignObject";
    for (const child of childrenOf(serialized)) el.appendChild(this.create(child, childSvg, inert ? "script" : tag));
    // Values go in once the element has its children (a <select>'s options).
    if (attrs && ("$v" in attrs || "$c" in attrs)) this.setAttrs(el, { $v: attrs.$v ?? null, $c: attrs.$c ?? null });
    return el;
  }

  private asset(href: string): string | undefined {
    const assets = this.options.assets;
    if (!assets) return undefined;
    try {
      return assets[new URL(href, this.base).href];
    } catch {
      return undefined;
    }
  }

  private setAttrs(el: Element, attrs: SAttrs | undefined, creating = false): void {
    if (!attrs) return;
    const tag = el.localName;
    if (tag.startsWith("chronos-")) return; // an inert placeholder
    for (const [name, raw] of Object.entries(attrs)) {
      if (name.startsWith("$")) {
        this.setState(el, name, raw, creating);
        continue;
      }
      const lower = name.toLowerCase();
      try {
        if (raw === null) {
          el.removeAttribute(name);
          continue;
        }
        let value: string | null = String(raw);
        if (lower.startsWith("on") || DROPPED_ATTRS.has(lower)) continue;
        if ((tag === "iframe" || tag === "frame") && lower === "src") continue;
        if (URL_ATTRS.has(lower)) value = this.url(value);
        else if (lower === "srcset" || lower === "imagesrcset") value = this.srcset(value);
        else if (lower === "style") value = this.css(value);
        if (value === null) continue;
        if (name.startsWith("xlink:")) el.setAttributeNS(XLINK_NS, name, value);
        else el.setAttribute(name, value);
      } catch {
        // An attribute name the DOM refuses.
      }
    }
    // A <link> may only load a stylesheet or an icon.
    if (tag === "link" && !/\b(stylesheet|icon)\b/i.test(el.getAttribute("rel") ?? "")) el.removeAttribute("href");
  }

  private setState(el: Element, name: string, value: SAttrs[string], creating: boolean): void {
    if (value === null) return;
    switch (name) {
      case "$v":
      case "$c":
        if (!creating) setValue(el, value as string | number);
        break;
      case "$css":
        if (this.options.live && Array.isArray(value)) {
          const style = el as HTMLStyleElement;
          this.deferred.push(() => {
            const sheet = style.sheet;
            if (!sheet) return;
            for (const rule of value) {
              try {
                sheet.insertRule(this.css(String(rule)), sheet.cssRules.length);
              } catch {
                // Unknown rule.
              }
            }
          });
        }
        break;
      case "$sx":
      case "$sy":
        if (this.options.live) {
          this.deferred.push(() => {
            if (name === "$sx") el.scrollLeft = Number(value);
            else el.scrollTop = Number(value);
          });
        }
        break;
      case "$w":
      case "$h": {
        const style = (el as HTMLElement).style;
        if (!style) return;
        if (name === "$w") style.width = `${value}px`;
        else style.height = `${value}px`;
        style.display = style.display || "inline-block";
        style.background = "repeating-linear-gradient(45deg,#d0d4da 0 8px,#e4e7eb 8px 16px)";
        break;
      }
    }
  }

  private runDeferred(): void {
    const tasks = this.deferred;
    this.deferred = [];
    for (const task of tasks) task();
  }
}

/** A recorded page address the <base> may use: http(s) only. */
function safeHref(href: string): string {
  try {
    const url = new URL(href);
    return /^https?:$/.test(url.protocol) ? url.href : "about:blank";
  } catch {
    return "about:blank";
  }
}

function inSvg(parent: Node): boolean {
  return (
    parent.nodeType === 1 &&
    (parent as Element).namespaceURI === SVG_NS &&
    (parent as Element).localName !== "foreignObject"
  );
}

/** Apply a recorded form value (see `E.Input`). */
function setValue(node: Node, value: string | number): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  switch (el.localName) {
    case "input": {
      const input = el as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") input.checked = value === 1;
      else input.value = String(value);
      break;
    }
    case "textarea":
      (el as HTMLTextAreaElement).value = String(value);
      break;
    case "select":
      if (typeof value === "number") (el as HTMLSelectElement).selectedIndex = value;
      else (el as HTMLSelectElement).value = value;
      break;
  }
}
