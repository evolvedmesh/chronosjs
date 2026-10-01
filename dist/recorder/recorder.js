import { encodeReplay } from "../codec.js";
import { deltaEvents, E, FORMAT_VERSION, newReplayId, } from "../format.js";
import { DEFAULT_PRIVACY, inSvg, maskText, Serializer } from "./serialize.js";
const STORAGE_KEY = "chronos:buffer";
const KEYS = new Set(["Enter", "Escape", "Tab"]);
export class ChronosRecorder {
    options;
    events = [];
    /** Indexes of `Meta` events that start a snapshot. */
    checkpoints = [];
    serializer;
    observer;
    restores = [];
    lastSnapshotAt = 0;
    pending;
    sent = 0;
    recentErrors = new Map();
    assets = new Map();
    scrollTimers = new Map();
    lastScroll = new WeakMap();
    resizeTimer;
    lastPath = "";
    /** Why recording is paused: by the app (`pause()`), or by `pauseOn` for the page shown. */
    paused;
    resumeTimer;
    /** Where the mouse last rested, and the timer that notices it resting again. */
    pointer;
    bufferMs;
    tailMs;
    maxReplays;
    running = false;
    constructor(options) {
        this.options = options;
        this.bufferMs = options.bufferMs ?? 60_000;
        this.tailMs = options.tailMs ?? 1500;
        this.maxReplays = options.maxReplays ?? 5;
        this.serializer = new Serializer({ ...DEFAULT_PRIVACY, ...options.privacy }, options.inlineStylesheets ? (link) => this.inlineStylesheet(link) : undefined);
    }
    start() {
        if (this.running || typeof document === "undefined")
            return;
        this.running = true;
        this.restore();
        if (this.options.pauseOn?.(location.pathname))
            this.pause("page");
        else
            this.snapshot();
        this.observer = new MutationObserver((records) => this.onMutations(records));
        this.observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
        this.listen();
        this.patch();
    }
    /**
     * Stop recording and discard everything recorded so far (nothing from
     * before is ever sent). `resume()` starts again from a fresh snapshot.
     */
    pause(by = "app") {
        clearTimeout(this.resumeTimer);
        this.resumeTimer = undefined;
        if (this.paused) {
            if (by === "app")
                this.paused = "app";
            return;
        }
        this.paused = by;
        this.observer?.takeRecords();
        this.events = [];
        this.checkpoints = [];
        if (this.pending)
            clearTimeout(this.pending.timer);
        this.pending = undefined;
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        }
        catch {
            // Storage blocked: there is nothing in it either.
        }
    }
    /**
     * Record again, from a fresh snapshot taken after `delayMs` (give a page
     * that is still being replaced time to render, so the snapshot never holds
     * what was paused).
     */
    resume(delayMs = 0) {
        if (!this.paused || !this.running)
            return;
        clearTimeout(this.resumeTimer);
        const go = () => {
            this.resumeTimer = undefined;
            if (!this.paused || this.options.pauseOn?.(location.pathname))
                return;
            this.paused = undefined;
            this.observer?.takeRecords();
            this.snapshot();
        };
        if (delayMs > 0)
            this.resumeTimer = setTimeout(go, delayMs);
        else
            go();
    }
    get isPaused() {
        return !!this.paused;
    }
    stop() {
        if (!this.running)
            return;
        clearTimeout(this.resumeTimer);
        this.running = false;
        this.observer?.disconnect();
        for (const restore of this.restores.splice(0))
            restore();
        if (this.pending)
            clearTimeout(this.pending.timer);
        this.pending = undefined;
        for (const timer of this.scrollTimers.values())
            clearTimeout(timer);
        clearTimeout(this.pointer?.timer);
        this.scrollTimers.clear();
    }
    /** Report an error the app caught itself (an error boundary, a failed action). */
    captureError(error, kind = "captured") {
        const { message, stack } = describe(error);
        this.error(kind, message, stack);
    }
    /** The replay as it would be sent now, without sending it. For tests and tools. */
    takeReplay(reason) {
        this.flush();
        const start = this.checkpoints[0] ?? 0;
        const { ts, e } = deltaEvents(this.events.slice(start));
        const replay = {
            v: FORMAT_VERSION,
            id: newReplayId(),
            ts,
            meta: { userAgent: navigator.userAgent, ...this.options.meta },
            e,
        };
        if (reason)
            replay.reason = reason;
        if (this.assets.size)
            replay.assets = Object.fromEntries(this.assets);
        return replay;
    }
    // ── events ──────────────────────────────────────────────────────────────
    now() {
        return Math.round(performance.timeOrigin + performance.now());
    }
    /** Record an event, after any DOM change that happened before it. */
    push(type, ...payload) {
        if (!this.running || this.paused)
            return;
        this.prepare();
        this.events.push([this.now(), type, ...payload]);
    }
    /**
     * Report earlier DOM changes and take a due snapshot. Called before a change
     * that is not idempotent (a CSSOM rule), so a snapshot never includes the
     * change its event is about to replay again.
     */
    prepare() {
        this.flush();
        if (this.checkoutDue())
            this.snapshot();
    }
    checkoutDue() {
        return this.now() - this.lastSnapshotAt >= this.bufferMs / 2;
    }
    /** A new starting point: a full snapshot. Older history is dropped once it is not needed. */
    snapshot() {
        this.observer?.takeRecords(); // the snapshot already shows those changes
        const now = this.now();
        this.lastSnapshotAt = now;
        this.checkpoints.push(this.events.length);
        const env = browserEnv();
        this.events.push(env
            ? [now, E.Meta, pageHref(), innerWidth, innerHeight, env]
            : [now, E.Meta, pageHref(), innerWidth, innerHeight]);
        const tree = this.serializer.snapshot(document);
        this.events.push([now, E.Snapshot, tree, Math.round(scrollX), Math.round(scrollY)]);
        const focused = document.activeElement;
        if (focused && focused !== document.body) {
            const id = this.serializer.mirror.id(focused);
            if (id !== undefined)
                this.events.push([now, E.Focus, id, focused.matches(":focus-visible") ? 1 : 0]);
        }
        this.trim(now);
    }
    /** Keep the newest checkpoint that is at least `bufferMs` old, and everything after it. */
    trim(now) {
        let drop = 0;
        while (drop + 1 < this.checkpoints.length && this.events[this.checkpoints[drop + 1]][0] <= now - this.bufferMs) {
            drop++;
        }
        if (!drop)
            return;
        const cut = this.checkpoints[drop];
        this.events = this.events.slice(cut);
        this.checkpoints = this.checkpoints.slice(drop).map((index) => index - cut);
    }
    flush() {
        const records = this.observer?.takeRecords();
        if (records?.length)
            this.onMutations(records);
    }
    onMutations(records) {
        if (!this.running || this.paused)
            return;
        if (this.checkoutDue()) {
            this.snapshot();
            return;
        }
        const s = this.serializer;
        const m = s.mirror;
        const firstNewId = m.next;
        const removes = new Set();
        const added = new Set();
        const attrTargets = new Map();
        const textTargets = new Set();
        // Controls whose state a DOM change may have moved (a select whose options
        // changed, a checkbox whose `checked` attribute changed while not dirty).
        const controls = new Set();
        for (const record of records) {
            const control = affectedControl(record);
            if (control)
                controls.add(control);
            if (record.type === "childList") {
                if (s.opaque.has(record.target) || m.id(record.target) === undefined)
                    continue;
                for (const node of Array.from(record.removedNodes)) {
                    const id = m.id(node);
                    if (id !== undefined)
                        removes.add(id);
                }
                for (const node of Array.from(record.addedNodes))
                    added.add(node);
            }
            else if (record.type === "attributes") {
                const el = record.target;
                if (m.id(el) === undefined || !record.attributeName)
                    continue;
                const names = attrTargets.get(el) ?? new Set();
                attrTargets.set(el, names);
                names.add(record.attributeName);
            }
            else {
                textTargets.add(record.target);
            }
        }
        // Added nodes, outermost only, in document order; each is placed after
        // its final previous sibling, so the player can insert them in turn.
        const tops = [];
        for (const node of added) {
            const parent = node.parentNode;
            if (!parent || !node.isConnected || node.getRootNode() !== document)
                continue;
            if (hasAddedAncestor(node, added))
                continue; // serialized with that ancestor
            if (m.id(parent) === undefined || s.opaque.has(parent))
                continue;
            tops.push(node);
        }
        tops.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        const adds = [];
        for (const node of tops) {
            const parent = node.parentNode;
            const parentId = m.id(parent);
            if (parentId === undefined)
                continue;
            let previous = node.previousSibling;
            while (previous && m.id(previous) === undefined)
                previous = previous.previousSibling;
            const previousId = previous ? m.id(previous) : 0;
            const serialized = s.node(node, s.masked(parent), inSvg(parent));
            if (serialized !== null)
                adds.push([parentId, previousId, serialized]);
        }
        const attrs = [];
        for (const [el, names] of attrTargets) {
            const id = m.id(el);
            if (id >= firstNewId || !el.isConnected)
                continue;
            const tag = el.localName;
            const change = {};
            let any = false;
            for (const name of names) {
                const value = el.getAttribute(name);
                const recorded = s.attribute(el, tag, name, value ?? "");
                if (recorded === null)
                    continue;
                change[name] = value === null ? null : recorded;
                any = true;
            }
            if (any)
                attrs.push([id, change]);
        }
        const texts = [];
        for (const node of textTargets) {
            const id = m.id(node);
            if (id === undefined || id >= firstNewId || !node.isConnected)
                continue;
            if (node.parentNode && s.opaque.has(node.parentNode))
                continue;
            const data = node.data;
            texts.push([id, s.masked(node.parentNode) ? maskText(data) : data]);
        }
        const now = this.now();
        if (removes.size || adds.length || attrs.length || texts.length) {
            const payload = [firstNewId, [...removes], adds, attrs, texts];
            while (payload.length > 1 && payload[payload.length - 1].length === 0)
                payload.pop();
            this.events.push([now, E.Mutation, ...payload]);
        }
        for (const control of controls) {
            const id = m.id(control);
            if (id === undefined || id >= firstNewId || !control.isConnected)
                continue;
            const value = s.formValue(control);
            // React sets the value attribute again on every render: only real changes count.
            if (value === undefined || s.values.get(control) === value)
                continue;
            s.values.set(control, value);
            this.events.push([now, E.Input, id, value]);
        }
    }
    // ── listeners ───────────────────────────────────────────────────────────
    on(target, type, handler, capture = true) {
        const wrapped = (event) => {
            try {
                handler(event);
            }
            catch {
                // Recording must never break the page.
            }
        };
        target.addEventListener(type, wrapped, { capture, passive: true });
        this.restores.push(() => target.removeEventListener(type, wrapped, { capture }));
    }
    /** The id of a node, or of its nearest recorded ancestor. */
    idOf(node) {
        for (let n = node; n; n = n.parentNode) {
            const id = this.serializer.mirror.id(n);
            if (id !== undefined)
                return id;
        }
        return 0;
    }
    listen() {
        this.on(document, "click", (event) => {
            const id = this.idOf(event.target);
            if (event.detail > 0 || event.clientX || event.clientY) {
                this.push(E.Click, id, Math.round(event.clientX), Math.round(event.clientY));
            }
            else {
                this.push(E.Click, id);
            }
        });
        this.on(document, "input", (event) => this.recordValue(event.target));
        this.on(document, "change", (event) => this.recordValue(event.target));
        this.on(document, "keydown", (event) => {
            if (KEYS.has(event.key))
                this.push(E.Key, this.idOf(event.target), event.key);
        });
        this.on(document, "scroll", (event) => this.onScroll(event.target));
        this.on(window, "resize", () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => this.push(E.Resize, innerWidth, innerHeight), 150);
        });
        this.on(document, "visibilitychange", () => this.push(E.Visibility, document.hidden ? 1 : 0));
        this.on(document, "focusin", (event) => {
            const target = event.target;
            this.push(E.Focus, this.idOf(target), target.matches?.(":focus-visible") ? 1 : 0);
        });
        this.on(document, "focusout", (event) => {
            if (!event.relatedTarget)
                this.push(E.Focus, 0, 0);
        });
        this.on(document, "pointermove", (event) => this.onPointerMove(event));
        this.on(window, "popstate", () => this.onNavigate());
        this.on(window, "pagehide", () => this.onPageHide());
        this.on(window, "error", (event) => {
            if (!(event instanceof ErrorEvent))
                return; // a resource that failed to load
            const { message, stack } = describe(event.error ?? event.message);
            this.error("error", message || event.message, stack);
        });
        this.on(window, "unhandledrejection", (event) => {
            const { message, stack } = describe(event.reason);
            this.error("unhandledrejection", message, stack);
        });
    }
    /**
     * Scroll positions at most every 50 ms per scroller: the first at once, the
     * last within 50 ms of the scroll ending (smooth scrolling keeps going after
     * the wheel event), so the replay never lags the page by more than that.
     */
    onScroll(target) {
        if (!target)
            return;
        const record = () => {
            this.scrollTimers.delete(target);
            this.lastScroll.set(target, this.now());
            if (target === document || target === document.scrollingElement) {
                this.push(E.Scroll, 0, Math.round(scrollX), Math.round(scrollY));
            }
            else if (target instanceof Element) {
                const id = this.serializer.mirror.id(target);
                if (id !== undefined)
                    this.push(E.Scroll, id, Math.round(target.scrollLeft), Math.round(target.scrollTop));
            }
        };
        clearTimeout(this.scrollTimers.get(target));
        const since = this.now() - (this.lastScroll.get(target) ?? 0);
        if (since >= 50)
            record();
        else
            this.scrollTimers.set(target, setTimeout(record, 50 - since));
    }
    /**
     * Mouse movement is not recorded, only its ends: the last resting point
     * when it starts moving, and the new one when it stops for 150 ms. That
     * pins where the cursor was (and what it hovered) at almost no cost.
     */
    onPointerMove(event) {
        if (event.pointerType !== "mouse")
            return;
        const x = Math.round(event.clientX);
        const y = Math.round(event.clientY);
        const pointer = this.pointer;
        // Where it left from, or (the first time) where it first appeared.
        if (!pointer)
            this.push(E.Pointer, x, y);
        else if (!pointer.moving)
            this.push(E.Pointer, pointer.x, pointer.y);
        clearTimeout(pointer?.timer);
        const next = { x, y, moving: true };
        next.timer = setTimeout(() => {
            next.moving = false;
            this.push(E.Pointer, x, y);
        }, 150);
        this.pointer = next;
    }
    recordValue(el) {
        if (!el || !this.running)
            return;
        const id = this.serializer.mirror.id(el);
        if (id === undefined || !el.isConnected)
            return;
        const value = this.serializer.formValue(el);
        if (value === undefined || this.serializer.values.get(el) === value)
            return;
        this.serializer.values.set(el, value);
        this.push(E.Input, id, value);
    }
    onNavigate() {
        const path = location.pathname;
        if (path === this.lastPath)
            return;
        this.lastPath = path;
        const pauseOn = this.options.pauseOn;
        if (pauseOn?.(path)) {
            this.pause("page");
            return;
        }
        // Leaving a paused page: the new one may not have rendered yet (a back
        // navigation fires before it does), so wait before the fresh snapshot.
        if (this.paused === "page")
            this.resume(500);
        else
            this.push(E.Nav, path);
    }
    onPageHide() {
        if (this.paused)
            return;
        if (this.pending) {
            clearTimeout(this.pending.timer);
            const { reason } = this.pending;
            this.pending = undefined;
            void this.send(reason, true);
        }
        if (this.options.persist === false)
            return;
        this.flush();
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ at: this.now(), events: this.events.slice(this.checkpoints[0] ?? 0) }));
        }
        catch {
            // Storage full or blocked: the next page starts without history.
        }
    }
    /** History from earlier pages in this tab. */
    restore() {
        this.lastPath = location.pathname;
        if (this.options.persist === false)
            return;
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            sessionStorage.removeItem(STORAGE_KEY);
            if (!raw)
                return;
            const saved = JSON.parse(raw);
            if (this.now() - saved.at > this.bufferMs || !Array.isArray(saved.events))
                return;
            this.events = saved.events;
            this.checkpoints = [];
            saved.events.forEach((event, index) => {
                if (event[1] === E.Meta)
                    this.checkpoints.push(index);
            });
        }
        catch {
            this.events = [];
            this.checkpoints = [];
        }
    }
    // ── patches ─────────────────────────────────────────────────────────────
    patch() {
        const recorder = this;
        // History API: client-side navigations (Next.js, React Router, …).
        for (const name of ["pushState", "replaceState"]) {
            const original = history[name];
            history[name] = function (...args) {
                const result = original.apply(this, args);
                recorder.onNavigate();
                return result;
            };
            this.restores.push(() => {
                history[name] = original;
            });
        }
        // Values set from code (controlled inputs, form resets) fire no event.
        const valueProps = [
            [HTMLInputElement.prototype, "value"],
            [HTMLInputElement.prototype, "checked"],
            [HTMLTextAreaElement.prototype, "value"],
            [HTMLSelectElement.prototype, "value"],
            [HTMLSelectElement.prototype, "selectedIndex"],
        ];
        for (const [proto, prop] of valueProps) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (!descriptor?.set)
                continue;
            const set = descriptor.set;
            Object.defineProperty(proto, prop, {
                ...descriptor,
                set(value) {
                    set.call(this, value);
                    if (recorder.running)
                        queueMicrotask(() => recorder.recordValue(this));
                },
            });
            this.restores.push(() => Object.defineProperty(proto, prop, descriptor));
        }
        // CSS-in-JS rules that only live in the CSSOM.
        const sheet = CSSStyleSheet.prototype;
        const insertRule = sheet.insertRule;
        const deleteRule = sheet.deleteRule;
        sheet.insertRule = function (rule, index) {
            if (recorder.running)
                recorder.prepare();
            const at = insertRule.call(this, rule, index);
            const id = recorder.serializer.mirror.id(this.ownerNode);
            if (id !== undefined && recorder.running)
                recorder.events.push([recorder.now(), E.CssRule, id, at, rule]);
            return at;
        };
        sheet.deleteRule = function (index) {
            if (recorder.running)
                recorder.prepare();
            deleteRule.call(this, index);
            const id = recorder.serializer.mirror.id(this.ownerNode);
            if (id !== undefined && recorder.running)
                recorder.events.push([recorder.now(), E.CssRule, id, index]);
        };
        this.restores.push(() => {
            sheet.insertRule = insertRule;
            sheet.deleteRule = deleteRule;
        });
        // Network calls: what the user waited for, and server errors.
        const originalFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (recorder.ignored(url))
                return originalFetch.call(this, input, init);
            const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
            const started = performance.now();
            try {
                const response = await originalFetch.call(this, input, init);
                recorder.http(method, url, response.status, performance.now() - started);
                return response;
            }
            catch (error) {
                if (!(error instanceof DOMException && error.name === "AbortError")) {
                    recorder.http(method, url, 0, performance.now() - started);
                }
                throw error;
            }
        };
        this.restores.push(() => {
            window.fetch = originalFetch;
        });
        const xhr = XMLHttpRequest.prototype;
        const open = xhr.open;
        const send = xhr.send;
        const requests = new WeakMap();
        xhr.open = function (method, url, ...rest) {
            requests.set(this, { method: method.toUpperCase(), url: String(url) });
            return open.call(this, method, url, ...rest);
        };
        xhr.send = function (body) {
            const request = requests.get(this);
            if (request && !recorder.ignored(request.url)) {
                const started = performance.now();
                this.addEventListener("loadend", () => recorder.http(request.method, request.url, this.status, performance.now() - started));
            }
            return send.call(this, body);
        };
        this.restores.push(() => {
            xhr.open = open;
            xhr.send = send;
        });
        if (this.options.captureConsoleErrors) {
            const consoleError = console.error;
            console.error = function (...args) {
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
    ignored(url) {
        return this.options.transports.some((transport) => transport.ignores?.(url));
    }
    http(method, url, status, ms) {
        const path = shortUrl(url);
        this.push(E.Http, method, path, status, Math.round(ms));
        const isError = this.options.httpError ?? ((code) => code >= 500);
        if (isError(status, url))
            this.error("http", `${method} ${path} failed with ${status || "a network error"}`);
    }
    // ── errors and sending ──────────────────────────────────────────────────
    error(kind, message, stack) {
        if (this.paused)
            return;
        if (!this.running)
            return;
        const event = [kind, message.slice(0, 1000)];
        if (stack)
            event.push(stack.slice(0, 4000));
        this.push(E.Error, ...event);
        const ignored = this.options.ignoreErrors?.some((pattern) => typeof pattern === "string" ? message.includes(pattern) : pattern.test(message));
        if (!ignored)
            this.trigger(kind, message);
    }
    trigger(kind, message) {
        if (this.pending || this.sent >= this.maxReplays)
            return;
        const now = this.now();
        const key = `${kind}:${message}`;
        const last = this.recentErrors.get(key);
        if (last !== undefined && now - last < 30_000)
            return;
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
    async send(reason, unloading) {
        this.sent++;
        let replay = this.takeReplay(reason);
        if (this.options.beforeSend)
            replay = this.options.beforeSend(replay);
        if (!replay)
            return;
        try {
            const encoded = await encodeReplay(replay);
            await Promise.all(this.options.transports.map((transport) => transport.send(replay, encoded, { unloading }).catch(() => {
                // A failed upload loses this replay, never the page.
            })));
            this.options.onReplay?.(replay, encoded.bytes.length);
        }
        catch {
            // Encoding failed: nothing to send.
        }
    }
    inlineStylesheet(link) {
        const href = link.href;
        if (!href || this.assets.has(href))
            return;
        try {
            const rules = link.sheet?.cssRules;
            if (!rules)
                return;
            const css = Array.from(rules, (rule) => rule.cssText).join("\n");
            this.assets.set(href, rebaseCssUrls(css, href));
        }
        catch {
            // Cross-origin stylesheet: the player loads it by URL.
        }
    }
}
/** The form control whose state a mutation may have changed, if any. */
function affectedControl(record) {
    const target = record.target;
    if (record.type === "attributes") {
        const el = target;
        const name = record.attributeName;
        if (el.localName === "input" && (name === "value" || name === "checked" || name === "type"))
            return el;
        if (el.localName === "option" && (name === "selected" || name === "value"))
            return el.closest("select") ?? undefined;
        return undefined;
    }
    const el = record.type === "characterData" ? target.parentElement : target;
    if (el?.nodeType !== 1)
        return undefined;
    if (el.localName === "textarea")
        return el;
    if (el.localName === "select" || el.localName === "optgroup" || el.localName === "option") {
        return el.closest("select") ?? undefined;
    }
    return undefined;
}
function hasAddedAncestor(node, added) {
    for (let p = node.parentNode; p; p = p.parentNode)
        if (added.has(p))
            return true;
    return false;
}
/** What the browser prefers, as `E.Meta` env letters, or undefined when nothing is unusual. */
function browserEnv() {
    const match = (query) => typeof matchMedia === "function" && matchMedia(query).matches;
    let env = "";
    if (match("(prefers-color-scheme: dark)"))
        env += "d";
    if (match("(prefers-reduced-motion: reduce)"))
        env += "m";
    if (match("(pointer: coarse)"))
        env += "c";
    if (match("(hover: none)"))
        env += "n";
    return env || undefined;
}
/** The page URL without query string or fragment (they may hold personal data). */
function pageHref() {
    return location.origin + location.pathname;
}
/** A request URL as recorded: path only for same-origin, no query string. */
function shortUrl(url) {
    try {
        const parsed = new URL(url, location.href);
        return parsed.origin === location.origin ? parsed.pathname : parsed.origin + parsed.pathname;
    }
    catch {
        return url.split("?")[0];
    }
}
function describe(error) {
    if (error instanceof Error)
        return { message: `${error.name}: ${error.message}`, stack: error.stack };
    if (typeof error === "string")
        return { message: error };
    try {
        return { message: JSON.stringify(error) ?? String(error) };
    }
    catch {
        return { message: String(error) };
    }
}
/** Make relative `url()`s in an inlined stylesheet absolute. */
export function rebaseCssUrls(css, base) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
        if (/^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url))
            return match;
        try {
            return `url(${quote}${new URL(url, base).href}${quote})`;
        }
        catch {
            return match;
        }
    });
}
//# sourceMappingURL=recorder.js.map