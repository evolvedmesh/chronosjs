import { encodeReplay } from "../codec.js";
import {
  deltaEvents,
  E,
  FORMAT_VERSION,
  newReplayId,
  type Replay,
  type ReplayEvent,
  type ReplayMeta,
  type SAdd,
  type SAttrChange,
  type SAttrs,
  type STextChange,
} from "../format.js";
import type { Transport } from "../transports/types.js";
import { DEFAULT_PRIVACY, inSvg, maskText, type PrivacyOptions, Serializer } from "./serialize.js";

export interface RecorderOptions {
  /** Where replays are sent. Every transport gets every replay. */
  transports: Transport[];
  meta?: ReplayMeta;
  /** History a replay keeps before the error, at least. Default 60 s. */
  bufferMs?: number;
  /** Recording kept after the error, so the replay shows how the page reacted. Default 1500 ms. */
  tailMs?: number;
  /** Replays sent per page load at most. Default 5. */
  maxReplays?: number;
  privacy?: Partial<PrivacyOptions>;
  /**
   * Copy same-origin stylesheets into the replay. Off by default: replays stay
   * small and the player loads the CSS from the app, which works until a
   * deployment removes the old files. Turn it on when replays must outlive
   * deployments.
   */
  inlineStylesheets?: boolean;
  /** Whether a response is an error worth a replay. Default: status 500 and up. */
  httpError?: (status: number, url: string) => boolean;
  /** Treat `console.error` as an error. Default false (frameworks log warnings there). */
  captureConsoleErrors?: boolean;
  /** Errors whose message matches are recorded but never trigger a replay. */
  ignoreErrors?: (string | RegExp)[];
  /** Keep the buffer across full page loads in the same tab (sessionStorage). Default true. */
  persist?: boolean;
  /** Last chance to change or drop (return null) a replay before it is sent. */
  beforeSend?: (replay: Replay) => Replay | null;
  /** Called after a replay was handed to the transports. */
  onReplay?: (replay: Replay, bytes: number) => void;
}

const STORAGE_KEY = "chronos:buffer";
const KEYS = new Set(["Enter", "Escape", "Tab"]);

type Restore = () => void;

export class ChronosRecorder {
  private events: ReplayEvent[] = [];
  /** Indexes of `Meta` events that start a snapshot. */
  private checkpoints: number[] = [];
  private readonly serializer: Serializer;
  private observer?: MutationObserver;
  private restores: Restore[] = [];
  private lastSnapshotAt = 0;
  private pending?: { reason: { kind: string; message: string }; timer: ReturnType<typeof setTimeout> };
  private sent = 0;
  private recentErrors = new Map<string, number>();
  private assets = new Map<string, string>();
  private scrollTimers = new Map<EventTarget, ReturnType<typeof setTimeout>>();
  private lastScroll = new WeakMap<EventTarget, number>();
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private lastPath = "";
  /** Where the mouse last rested, and the timer that notices it resting again. */
  private pointer?: { x: number; y: number; moving: boolean; timer?: ReturnType<typeof setTimeout> };
  private readonly bufferMs: number;
  private readonly tailMs: number;
  private readonly maxReplays: number;
  running = false;

  constructor(readonly options: RecorderOptions) {
    this.bufferMs = options.bufferMs ?? 60_000;
    this.tailMs = options.tailMs ?? 1500;
    this.maxReplays = options.maxReplays ?? 5;
    this.serializer = new Serializer(
      { ...DEFAULT_PRIVACY, ...options.privacy },
      options.inlineStylesheets ? (link) => this.inlineStylesheet(link) : undefined,
    );
  }

  start(): void {
    if (this.running || typeof document === "undefined") return;
    this.running = true;
    this.restore();
    this.snapshot();
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    this.listen();
    this.patch();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer?.disconnect();
    for (const restore of this.restores.splice(0)) restore();
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
    for (const timer of this.scrollTimers.values()) clearTimeout(timer);
    clearTimeout(this.pointer?.timer);
    this.scrollTimers.clear();
  }

  /** Report an error the app caught itself (an error boundary, a failed action). */
  captureError(error: unknown, kind = "captured"): void {
    const { message, stack } = describe(error);
    this.error(kind, message, stack);
  }

  /** The replay as it would be sent now, without sending it. For tests and tools. */
  takeReplay(reason?: { kind: string; message: string }): Replay {
    this.flush();
    const start = this.checkpoints[0] ?? 0;
    const { ts, e } = deltaEvents(this.events.slice(start));
    const replay: Replay = {
      v: FORMAT_VERSION,
      id: newReplayId(),
      ts,
      meta: { userAgent: navigator.userAgent, ...this.options.meta },
      e,
    };
    if (reason) replay.reason = reason;
    if (this.assets.size) replay.assets = Object.fromEntries(this.assets);
    return replay;
  }

  // ── events ──────────────────────────────────────────────────────────────

  private now(): number {
    return Math.round(performance.timeOrigin + performance.now());
  }

  /** Record an event, after any DOM change that happened before it. */
  private push(type: number, ...payload: unknown[]): void {
    if (!this.running) return;
    this.prepare();
    this.events.push([this.now(), type, ...payload]);
  }

  /**
   * Report earlier DOM changes and take a due snapshot. Called before a change
   * that is not idempotent (a CSSOM rule), so a snapshot never includes the
   * change its event is about to replay again.
   */
  private prepare(): void {
    this.flush();
    if (this.checkoutDue()) this.snapshot();
  }

  private checkoutDue(): boolean {
    return this.now() - this.lastSnapshotAt >= this.bufferMs / 2;
  }

  /** A new starting point: a full snapshot. Older history is dropped once it is not needed. */
  private snapshot(): void {
    this.observer?.takeRecords(); // the snapshot already shows those changes
    const now = this.now();
    this.lastSnapshotAt = now;
    this.checkpoints.push(this.events.length);
    const env = browserEnv();
    this.events.push(
      env
        ? [now, E.Meta, pageHref(), innerWidth, innerHeight, env]
        : [now, E.Meta, pageHref(), innerWidth, innerHeight],
    );
    const tree = this.serializer.snapshot(document);
    this.events.push([now, E.Snapshot, tree, Math.round(scrollX), Math.round(scrollY)]);
    const focused = document.activeElement;
    if (focused && focused !== document.body) {
      const id = this.serializer.mirror.id(focused);
      if (id !== undefined) this.events.push([now, E.Focus, id, focused.matches(":focus-visible") ? 1 : 0]);
    }
    this.trim(now);
  }

  /** Keep the newest checkpoint that is at least `bufferMs` old, and everything after it. */
  private trim(now: number): void {
    let drop = 0;
    while (drop + 1 < this.checkpoints.length && this.events[this.checkpoints[drop + 1]][0] <= now - this.bufferMs) {
      drop++;
    }
    if (!drop) return;
    const cut = this.checkpoints[drop];
    this.events = this.events.slice(cut);
    this.checkpoints = this.checkpoints.slice(drop).map((index) => index - cut);
  }

  private flush(): void {
    const records = this.observer?.takeRecords();
    if (records?.length) this.onMutations(records);
  }

  private onMutations(records: MutationRecord[]): void {
    if (!this.running) return;
    if (this.checkoutDue()) {
      this.snapshot();
      return;
    }
    const s = this.serializer;
    const m = s.mirror;
    const firstNewId = m.next;
    const removes = new Set<number>();
    const added = new Set<Node>();
    const attrTargets = new Map<Element, Set<string>>();
    const textTargets = new Set<Node>();

    // Controls whose state a DOM change may have moved (a select whose options
    // changed, a checkbox whose `checked` attribute changed while not dirty).
    const controls = new Set<Element>();
    for (const record of records) {
      const control = affectedControl(record);
      if (control) controls.add(control);
      if (record.type === "childList") {
        if (s.opaque.has(record.target) || m.id(record.target) === undefined) continue;
        for (const node of Array.from(record.removedNodes)) {
          const id = m.id(node);
          if (id !== undefined) removes.add(id);
        }
        for (const node of Array.from(record.addedNodes)) added.add(node);
      } else if (record.type === "attributes") {
        const el = record.target as Element;
        if (m.id(el) === undefined || !record.attributeName) continue;
        const names = attrTargets.get(el) ?? new Set<string>();
        attrTargets.set(el, names);
        names.add(record.attributeName);
      } else {
        textTargets.add(record.target);
      }
    }

    // Added nodes, outermost only, in document order; each is placed after
    // its final previous sibling, so the player can insert them in turn.
    const tops: Node[] = [];
    for (const node of added) {
      const parent = node.parentNode;
      if (!parent || !node.isConnected || node.getRootNode() !== document) continue;
      if (hasAddedAncestor(node, added)) continue; // serialized with that ancestor
      if (m.id(parent) === undefined || s.opaque.has(parent)) continue;
      tops.push(node);
    }
    tops.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const adds: SAdd[] = [];
    for (const node of tops) {
      const parent = node.parentNode as Node;
      const parentId = m.id(parent);
      if (parentId === undefined) continue;
      let previous = node.previousSibling;
      while (previous && m.id(previous) === undefined) previous = previous.previousSibling;
      const previousId = previous ? (m.id(previous) as number) : 0;
      const serialized = s.node(node, s.masked(parent), inSvg(parent));
      if (serialized !== null) adds.push([parentId, previousId, serialized]);
    }

    const attrs: SAttrChange[] = [];
    for (const [el, names] of attrTargets) {
      const id = m.id(el) as number;
      if (id >= firstNewId || !el.isConnected) continue;
      const tag = el.localName;
      const change: SAttrs = {};
      let any = false;
      for (const name of names) {
        const value = el.getAttribute(name);
        const recorded = s.attribute(el, tag, name, value ?? "");
        if (recorded === null) continue;
        change[name] = value === null ? null : recorded;
        any = true;
      }
      if (any) attrs.push([id, change]);
    }

    const texts: STextChange[] = [];
    for (const node of textTargets) {
      const id = m.id(node);
      if (id === undefined || id >= firstNewId || !node.isConnected) continue;
      if (node.parentNode && s.opaque.has(node.parentNode)) continue;
      const data = (node as CharacterData).data;
      texts.push([id, s.masked(node.parentNode) ? maskText(data) : data]);
    }

    const now = this.now();
    if (removes.size || adds.length || attrs.length || texts.length) {
      const payload: unknown[] = [firstNewId, [...removes], adds, attrs, texts];
      while (payload.length > 1 && (payload[payload.length - 1] as unknown[]).length === 0) payload.pop();
      this.events.push([now, E.Mutation, ...payload]);
    }
    for (const control of controls) {
      const id = m.id(control);
      if (id === undefined || id >= firstNewId || !control.isConnected) continue;
      const value = s.formValue(control);
      // React sets the value attribute again on every render: only real changes count.
      if (value === undefined || s.values.get(control) === value) continue;
      s.values.set(control, value);
      this.events.push([now, E.Input, id, value]);
    }
  }

  // ── listeners ───────────────────────────────────────────────────────────

  private on<T extends Event>(target: EventTarget, type: string, handler: (event: T) => void, capture = true): void {
    const wrapped = (event: Event) => {
      try {
        handler(event as T);
      } catch {
        // Recording must never break the page.
      }
    };
    target.addEventListener(type, wrapped, { capture, passive: true });
    this.restores.push(() => target.removeEventListener(type, wrapped, { capture }));
  }

  /** The id of a node, or of its nearest recorded ancestor. */
  private idOf(node: EventTarget | null): number {
    for (let n = node as Node | null; n; n = n.parentNode) {
      const id = this.serializer.mirror.id(n);
      if (id !== undefined) return id;
    }
    return 0;
  }

  private listen(): void {
    this.on(document, "click", (event: MouseEvent) => {
      const id = this.idOf(event.target);
      if (event.detail > 0 || event.clientX || event.clientY) {
        this.push(E.Click, id, Math.round(event.clientX), Math.round(event.clientY));
      } else {
        this.push(E.Click, id);
      }
    });
    this.on(document, "input", (event: Event) => this.recordValue(event.target as Element));
    this.on(document, "change", (event: Event) => this.recordValue(event.target as Element));
    this.on(document, "keydown", (event: KeyboardEvent) => {
      if (KEYS.has(event.key)) this.push(E.Key, this.idOf(event.target), event.key);
    });
    this.on(document, "scroll", (event: Event) => this.onScroll(event.target));
    this.on(window, "resize", () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.push(E.Resize, innerWidth, innerHeight), 150);
    });
    this.on(document, "visibilitychange", () => this.push(E.Visibility, document.hidden ? 1 : 0));
    this.on(document, "focusin", (event: FocusEvent) => {
      const target = event.target as Element;
      this.push(E.Focus, this.idOf(target), target.matches?.(":focus-visible") ? 1 : 0);
    });
    this.on(document, "focusout", (event: FocusEvent) => {
      if (!event.relatedTarget) this.push(E.Focus, 0, 0);
    });
    this.on(document, "pointermove", (event: PointerEvent) => this.onPointerMove(event));
    this.on(window, "popstate", () => this.onNavigate());
    this.on(window, "pagehide", () => this.onPageHide());
    this.on(window, "error", (event: ErrorEvent) => {
      if (!(event instanceof ErrorEvent)) return; // a resource that failed to load
      const { message, stack } = describe(event.error ?? event.message);
      this.error("error", message || event.message, stack);
    });
    this.on(window, "unhandledrejection", (event: PromiseRejectionEvent) => {
      const { message, stack } = describe(event.reason);
      this.error("unhandledrejection", message, stack);
    });
  }

  /**
   * Scroll positions at most every 50 ms per scroller: the first at once, the
   * last within 50 ms of the scroll ending (smooth scrolling keeps going after
   * the wheel event), so the replay never lags the page by more than that.
   */
  private onScroll(target: EventTarget | null): void {
    if (!target) return;
    const record = () => {
      this.scrollTimers.delete(target);
      this.lastScroll.set(target, this.now());
      if (target === document || target === document.scrollingElement) {
        this.push(E.Scroll, 0, Math.round(scrollX), Math.round(scrollY));
      } else if (target instanceof Element) {
        const id = this.serializer.mirror.id(target);
        if (id !== undefined) this.push(E.Scroll, id, Math.round(target.scrollLeft), Math.round(target.scrollTop));
      }
    };
    clearTimeout(this.scrollTimers.get(target));
    const since = this.now() - (this.lastScroll.get(target) ?? 0);
    if (since >= 50) record();
    else this.scrollTimers.set(target, setTimeout(record, 50 - since));
  }

  /**
   * Mouse movement is not recorded, only its ends: the last resting point
   * when it starts moving, and the new one when it stops for 150 ms. That
   * pins where the cursor was (and what it hovered) at almost no cost.
   */
  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType !== "mouse") return;
    const x = Math.round(event.clientX);
    const y = Math.round(event.clientY);
    const pointer = this.pointer;
    // Where it left from, or (the first time) where it first appeared.
    if (!pointer) this.push(E.Pointer, x, y);
    else if (!pointer.moving) this.push(E.Pointer, pointer.x, pointer.y);
    clearTimeout(pointer?.timer);
    const next: NonNullable<typeof this.pointer> = { x, y, moving: true };
    next.timer = setTimeout(() => {
      next.moving = false;
      this.push(E.Pointer, x, y);
    }, 150);
    this.pointer = next;
  }

  private recordValue(el: Element | null): void {
    if (!el || !this.running) return;
    const id = this.serializer.mirror.id(el);
    if (id === undefined || !el.isConnected) return;
    const value = this.serializer.formValue(el);
    if (value === undefined || this.serializer.values.get(el) === value) return;
    this.serializer.values.set(el, value);
    this.push(E.Input, id, value);
  }

  private onNavigate(): void {
    const path = location.pathname;
    if (path === this.lastPath) return;
    this.lastPath = path;
    this.push(E.Nav, path);
  }

  private onPageHide(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const { reason } = this.pending;
      this.pending = undefined;
      void this.send(reason, true);
    }
    if (this.options.persist === false) return;
    this.flush();
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ at: this.now(), events: this.events.slice(this.checkpoints[0] ?? 0) }),
      );
    } catch {
      // Storage full or blocked: the next page starts without history.
    }
  }

  /** History from earlier pages in this tab. */
  private restore(): void {
    this.lastPath = location.pathname;
    if (this.options.persist === false) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { at: number; events: ReplayEvent[] };
      if (this.now() - saved.at > this.bufferMs || !Array.isArray(saved.events)) return;
      this.events = saved.events;
      this.checkpoints = [];
      saved.events.forEach((event, index) => {
        if (event[1] === E.Meta) this.checkpoints.push(index);
      });
    } catch {
      this.events = [];
      this.checkpoints = [];
    }
  }

  // ── patches ─────────────────────────────────────────────────────────────

  private patch(): void {
    const recorder = this;

    // History API: client-side navigations (Next.js, React Router, …).
    for (const name of ["pushState", "replaceState"] as const) {
      const original = history[name];
      history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        recorder.onNavigate();
        return result;
      };
      this.restores.push(() => {
        history[name] = original;
      });
    }

    // Values set from code (controlled inputs, form resets) fire no event.
    const valueProps: [object, string][] = [
      [HTMLInputElement.prototype, "value"],
      [HTMLInputElement.prototype, "checked"],
      [HTMLTextAreaElement.prototype, "value"],
      [HTMLSelectElement.prototype, "value"],
      [HTMLSelectElement.prototype, "selectedIndex"],
    ];
    for (const [proto, prop] of valueProps) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
      if (!descriptor?.set) continue;
      const set = descriptor.set;
      Object.defineProperty(proto, prop, {
        ...descriptor,
        set(this: Element, value: unknown) {
          set.call(this, value);
          if (recorder.running) queueMicrotask(() => recorder.recordValue(this));
        },
      });
      this.restores.push(() => Object.defineProperty(proto, prop, descriptor));
    }

    // CSS-in-JS rules that only live in the CSSOM.
    const sheet = CSSStyleSheet.prototype;
    const insertRule = sheet.insertRule;
    const deleteRule = sheet.deleteRule;
    sheet.insertRule = function (this: CSSStyleSheet, rule: string, index?: number) {
      if (recorder.running) recorder.prepare();
      const at = insertRule.call(this, rule, index);
      const id = recorder.serializer.mirror.id(this.ownerNode);
      if (id !== undefined && recorder.running) recorder.events.push([recorder.now(), E.CssRule, id, at, rule]);
      return at;
    };
    sheet.deleteRule = function (this: CSSStyleSheet, index: number) {
      if (recorder.running) recorder.prepare();
      deleteRule.call(this, index);
      const id = recorder.serializer.mirror.id(this.ownerNode);
      if (id !== undefined && recorder.running) recorder.events.push([recorder.now(), E.CssRule, id, index]);
    };
    this.restores.push(() => {
      sheet.insertRule = insertRule;
      sheet.deleteRule = deleteRule;
    });

    // Network calls: what the user waited for, and server errors.
    const originalFetch = window.fetch;
    window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (recorder.ignored(url)) return originalFetch.call(this, input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const started = performance.now();
      try {
        const response = await originalFetch.call(this, input, init);
        recorder.http(method, url, response.status, performance.now() - started);
        return response;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          recorder.http(method, url, 0, performance.now() - started);
        }
        throw error;
      }
    } as typeof fetch;
    this.restores.push(() => {
      window.fetch = originalFetch;
    });

    const xhr = XMLHttpRequest.prototype;
    const open = xhr.open;
    const send = xhr.send;
    const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      requests.set(this, { method: method.toUpperCase(), url: String(url) });
      return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof xhr.open;
    xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const request = requests.get(this);
      if (request && !recorder.ignored(request.url)) {
        const started = performance.now();
        this.addEventListener("loadend", () =>
          recorder.http(request.method, request.url, this.status, performance.now() - started),
        );
      }
      return send.call(this, body);
    };
    this.restores.push(() => {
      xhr.open = open;
      xhr.send = send;
    });

    if (this.options.captureConsoleErrors) {
      const consoleError = console.error;
      console.error = function (...args: unknown[]) {
        consoleError.apply(this, args);
        const error = args.find((arg) => arg instanceof Error);
        const { message, stack } = describe(error ?? args.map(String).join(" "));
        recorder.error("console", message, stack);
      };
      this.restores.push(() => {
        console.error = consoleError;
      });
    }
  }

  private ignored(url: string): boolean {
    return this.options.transports.some((transport) => transport.ignores?.(url));
  }

  private http(method: string, url: string, status: number, ms: number): void {
    const path = shortUrl(url);
    this.push(E.Http, method, path, status, Math.round(ms));
    const isError = this.options.httpError ?? ((code: number) => code >= 500);
    if (isError(status, url)) this.error("http", `${method} ${path} failed with ${status || "a network error"}`);
  }

  // ── errors and sending ──────────────────────────────────────────────────

  private error(kind: string, message: string, stack?: string): void {
    if (!this.running) return;
    const event: unknown[] = [kind, message.slice(0, 1000)];
    if (stack) event.push(stack.slice(0, 4000));
    this.push(E.Error, ...event);
    const ignored = this.options.ignoreErrors?.some((pattern) =>
      typeof pattern === "string" ? message.includes(pattern) : pattern.test(message),
    );
    if (!ignored) this.trigger(kind, message);
  }

  private trigger(kind: string, message: string): void {
    if (this.pending || this.sent >= this.maxReplays) return;
    const now = this.now();
    const key = `${kind}:${message}`;
    const last = this.recentErrors.get(key);
    if (last !== undefined && now - last < 30_000) return;
    this.recentErrors.set(key, now);
    const reason = { kind, message: message.slice(0, 300) };
    this.pending = {
      reason,
      timer: setTimeout(() => {
        this.pending = undefined;
        void this.send(reason, false);
      }, this.tailMs),
    };
  }

  private async send(reason: { kind: string; message: string }, unloading: boolean): Promise<void> {
    this.sent++;
    let replay: Replay | null = this.takeReplay(reason);
    if (this.options.beforeSend) replay = this.options.beforeSend(replay);
    if (!replay) return;
    try {
      const encoded = await encodeReplay(replay);
      await Promise.all(
        this.options.transports.map((transport) =>
          transport.send(replay, encoded, { unloading }).catch(() => {
            // A failed upload loses this replay, never the page.
          }),
        ),
      );
      this.options.onReplay?.(replay, encoded.bytes.length);
    } catch {
      // Encoding failed: nothing to send.
    }
  }

  private inlineStylesheet(link: HTMLLinkElement): void {
    const href = link.href;
    if (!href || this.assets.has(href)) return;
    try {
      const rules = link.sheet?.cssRules;
      if (!rules) return;
      const css = Array.from(rules, (rule) => rule.cssText).join("\n");
      this.assets.set(href, rebaseCssUrls(css, href));
    } catch {
      // Cross-origin stylesheet: the player loads it by URL.
    }
  }
}

/** The form control whose state a mutation may have changed, if any. */
function affectedControl(record: MutationRecord): Element | undefined {
  const target = record.target;
  if (record.type === "attributes") {
    const el = target as Element;
    const name = record.attributeName;
    if (el.localName === "input" && (name === "value" || name === "checked" || name === "type")) return el;
    if (el.localName === "option" && (name === "selected" || name === "value"))
      return el.closest("select") ?? undefined;
    return undefined;
  }
  const el = record.type === "characterData" ? target.parentElement : (target as Element);
  if (el?.nodeType !== 1) return undefined;
  if (el.localName === "textarea") return el;
  if (el.localName === "select" || el.localName === "optgroup" || el.localName === "option") {
    return el.closest("select") ?? undefined;
  }
  return undefined;
}

function hasAddedAncestor(node: Node, added: Set<Node>): boolean {
  for (let p = node.parentNode; p; p = p.parentNode) if (added.has(p)) return true;
  return false;
}

/** What the browser prefers, as `E.Meta` env letters, or undefined when nothing is unusual. */
function browserEnv(): string | undefined {
  const match = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  let env = "";
  if (match("(prefers-color-scheme: dark)")) env += "d";
  if (match("(prefers-reduced-motion: reduce)")) env += "m";
  if (match("(pointer: coarse)")) env += "c";
  if (match("(hover: none)")) env += "n";
  return env || undefined;
}

/** The page URL without query string or fragment (they may hold personal data). */
function pageHref(): string {
  return location.origin + location.pathname;
}

/** A request URL as recorded: path only for same-origin, no query string. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin ? parsed.pathname : parsed.origin + parsed.pathname;
  } catch {
    return url.split("?")[0];
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/** Make relative `url()`s in an inlined stylesheet absolute. */
export function rebaseCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, url: string) => {
    if (/^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return match;
    try {
      return `url(${quote}${new URL(url, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}
