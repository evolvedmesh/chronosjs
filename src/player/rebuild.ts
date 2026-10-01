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

export interface BuilderOptions {
  /** Inlined stylesheets from the replay, by URL. */
  assets?: Record<string, string>;
  /**
   * A document that renders (the player's iframe): CSSOM rules and scroll
   * positions are applied. Off for the detached document used to label actions.
   */
  live: boolean;
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

  constructor(
    readonly doc: Document,
    readonly options: BuilderOptions,
  ) {}

  /** Replace the document's content with a snapshot of the page at `href`. */
  snapshot(tree: SElement, href: string, scrollX = 0, scrollY = 0): void {
    const doc = this.doc;
    this.nodes = [];
    this.next = 1;
    // The <base> goes in before any element exists, so every relative URL
    // (images, stylesheets, srcset) resolves against the recorded page.
    const html = doc.createElement("html");
    const head = doc.createElement("head");
    const base = doc.createElement("base");
    base.setAttribute("href", href);
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
        for (const grandchild of childrenOf(child)) head.appendChild(this.create(grandchild, false));
      } else {
        html.appendChild(this.create(child, false));
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
      const node = this.create(serialized, parent ? inSvg(parent) : false);
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
      if (node && (node.nodeType === 3 || node.nodeType === 4 || node.nodeType === 8))
        (node as CharacterData).data = text;
      else if (node) node.textContent = text;
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
      else sheet.insertRule(rule, Math.min(index, sheet.cssRules.length));
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
    this.nodes[this.next++] = node;
  }

  private create(serialized: SNode, svg: boolean): Node {
    const doc = this.doc;
    if (typeof serialized === "string") {
      const text = doc.createTextNode(serialized);
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
    if (asset !== undefined) {
      el = doc.createElement("style");
      el.textContent = asset;
    } else {
      try {
        el = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
      } catch {
        el = doc.createElement("div");
      }
    }
    this.assign(el);
    if (asset === undefined) this.setAttrs(el, attrs, true);
    const childSvg = isSvg && tag !== "foreignObject";
    for (const child of childrenOf(serialized)) el.appendChild(this.create(child, childSvg));
    // Values go in once the element has its children (a <select>'s options).
    if (attrs && ("$v" in attrs || "$c" in attrs)) this.setAttrs(el, { $v: attrs.$v ?? null, $c: attrs.$c ?? null });
    return el;
  }

  private asset(href: string): string | undefined {
    const assets = this.options.assets;
    if (!assets) return undefined;
    try {
      return assets[new URL(href, this.doc.baseURI).href];
    } catch {
      return undefined;
    }
  }

  private setAttrs(el: Element, attrs: SAttrs | undefined, creating = false): void {
    if (!attrs) return;
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith("$")) {
        this.setState(el, name, value, creating);
        continue;
      }
      try {
        if (value === null) el.removeAttribute(name);
        else if (name.startsWith("xlink:")) el.setAttributeNS(XLINK_NS, name, String(value));
        else el.setAttribute(name, String(value));
      } catch {
        // An attribute name the DOM refuses.
      }
    }
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
                sheet.insertRule(rule, sheet.cssRules.length);
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
