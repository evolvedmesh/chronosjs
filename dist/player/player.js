import { absoluteEvents, E, } from "../format.js";
import { deriveActions } from "./actions.js";
import { CursorPath } from "./cursor.js";
import { Emulator, parseEnv, withAncestors } from "./emulate.js";
import { DomBuilder } from "./rebuild.js";
import { CURSOR_SVG, PLAYER_CSS } from "./styles.js";
const IDLE_MS = 2500;
const LEAD_MS = 1400;
const SPEEDS = [0.5, 1, 2, 4, 8];
/**
 * Plays a Chronos replay: the page as the user saw it, in a sandboxed iframe
 * (no script from the recording ever runs), with a cursor that moves to each
 * click, a timeline and the list of what the user did.
 */
export class ChronosPlayer {
    replay;
    events;
    actions;
    duration;
    /** Set once the iframe's own document has loaded (see `ready`). */
    builder;
    isReady = false;
    /** Set when the replay could not be rebuilt; the player then stays still. */
    failure;
    statesCheck = 0;
    cursor;
    emulator;
    /** The focused element's id (0: none) and whether `:focus-visible` matched. */
    focus = [0, 0];
    metas = [];
    times;
    errors;
    segment = -1;
    applied = -1;
    time = 0;
    playing = false;
    speed;
    skipIdle;
    raf = 0;
    lastFrame = 0;
    viewport = [1280, 720];
    scale = 1;
    zoom;
    currentAction = -2;
    listeners = new Map();
    resizeObserver;
    root;
    stage;
    frame;
    iframe;
    cursorEl;
    rippleEl;
    banner;
    playButton;
    timeEl;
    track;
    fill;
    thumb;
    items = [];
    constructor(container, replay, options = {}) {
        this.replay = replay;
        this.events = absoluteEvents(replay);
        this.times = this.events.map((event) => event[0]);
        this.events.forEach((event, index) => {
            if (event[1] === E.Meta)
                this.metas.push(index);
        });
        if (!this.metas.length)
            throw new Error("chronosjs: the replay has no snapshot");
        this.duration = (this.times[this.times.length - 1] ?? 0) + 600;
        this.actions = deriveActions(this.events);
        this.errors = this.actions.filter((action) => action.kind === "error");
        const keys = [];
        for (const event of this.events) {
            if (event[1] === E.Click && typeof event[3] === "number") {
                keys.push({ t: event[0], x: event[3], y: event[4] });
            }
            else if (event[1] === E.Pointer) {
                keys.push({ t: event[0], x: event[2], y: event[3], click: false });
            }
        }
        this.cursor = new CursorPath(keys);
        this.speed = options.speed ?? 1;
        this.skipIdle = options.skipIdle ?? true;
        this.zoom = options.zoom ?? "fit";
        injectStyles(container.ownerDocument);
        const h = (tag, className = "", parent) => {
            const el = container.ownerDocument.createElement(tag);
            if (className)
                el.className = className;
            parent?.appendChild(el);
            return el;
        };
        this.root = h("div", "chronos");
        this.root.tabIndex = 0;
        this.root.setAttribute("role", "region");
        this.root.setAttribute("aria-label", "Session replay");
        if (options.theme)
            this.root.dataset.theme = options.theme;
        if (options.showNetwork)
            this.root.dataset.network = "";
        const main = h("div", "chronos-main", this.root);
        this.stage = h("div", "chronos-stage", main);
        this.frame = h("div", "chronos-frame", this.stage);
        this.iframe = h("iframe", "", this.frame);
        this.iframe.setAttribute("sandbox", "allow-same-origin");
        this.iframe.setAttribute("title", "Recorded page");
        this.iframe.tabIndex = -1;
        this.rippleEl = h("div", "chronos-ripple", this.frame);
        this.cursorEl = h("div", "chronos-cursor", this.frame);
        this.cursorEl.innerHTML = CURSOR_SVG;
        this.banner = h("div", "chronos-banner", this.stage);
        this.banner.setAttribute("role", "status");
        // Without controls they are still built (the code that updates them stays simple), never shown.
        const controls = h("div", "chronos-controls", options.controls === false ? undefined : main);
        this.playButton = h("button", "chronos-btn", controls);
        this.playButton.type = "button";
        this.playButton.addEventListener("click", () => this.toggle());
        this.timeEl = h("span", "chronos-time", controls);
        this.track = h("div", "chronos-track", controls);
        this.track.tabIndex = 0;
        this.track.setAttribute("role", "slider");
        this.track.setAttribute("aria-label", "Replay position");
        this.fill = h("div", "chronos-fill", this.track);
        for (const action of this.actions) {
            if (!["click", "error", "page", "nav", "input"].includes(action.kind))
                continue;
            const mark = h("div", "chronos-mark", this.track);
            mark.dataset.kind = action.kind;
            mark.style.left = `${(action.t / this.duration) * 100}%`;
            mark.title = action.label;
        }
        this.thumb = h("div", "chronos-thumb", this.track);
        this.bindTrack();
        if (this.errors.length) {
            const jump = h("button", "chronos-btn", controls);
            jump.type = "button";
            jump.textContent = "Jump to error";
            jump.addEventListener("click", () => {
                this.seek(Math.max(0, this.errors[0].t - 4000));
                this.play();
            });
        }
        const speed = h("select", "chronos-select", controls);
        speed.setAttribute("aria-label", "Playback speed");
        for (const value of SPEEDS) {
            const option = h("option", "", speed);
            option.value = String(value);
            option.textContent = `${value}×`;
        }
        speed.value = String(this.speed);
        speed.addEventListener("change", () => this.setSpeed(Number(speed.value)));
        const skip = h("label", "chronos-toggle", controls);
        const skipBox = h("input", "", skip);
        skipBox.type = "checkbox";
        skipBox.checked = this.skipIdle;
        skipBox.addEventListener("change", () => {
            this.skipIdle = skipBox.checked;
        });
        h("span", "", skip).textContent = "Skip idle";
        const zoom = h("button", "chronos-btn", controls);
        zoom.type = "button";
        const zoomLabel = () => {
            zoom.textContent = this.zoom === "fit" ? "100%" : "Fit";
            zoom.setAttribute("aria-label", this.zoom === "fit" ? "Show at real size" : "Fit to player");
        };
        zoomLabel();
        zoom.addEventListener("click", () => {
            this.setZoom(this.zoom === "fit" ? 1 : "fit");
            zoomLabel();
        });
        if (options.controls === false)
            this.root.dataset.headless = "";
        if ((options.showActions ?? true) && options.controls !== false)
            this.buildActionList(h);
        this.root.addEventListener("keydown", (event) => {
            if (event.target !== this.root && event.target !== this.track)
                return;
            if (event.key === " ") {
                event.preventDefault();
                this.toggle();
            }
            else if (event.key === "ArrowRight") {
                this.seek(this.time + 5000);
            }
            else if (event.key === "ArrowLeft") {
                this.seek(this.time - 5000);
            }
        });
        // The page is rebuilt only once the iframe's own (empty) document has
        // loaded. Writing into the initial about:blank document instead races
        // with it in Firefox, which then drops the stylesheet requests.
        this.iframe.srcdoc = "<!DOCTYPE html><html><head></head><body></body></html>";
        this.ready = new Promise((resolve, reject) => {
            this.iframe.addEventListener("load", () => {
                const doc = this.iframe.contentDocument;
                if (!doc) {
                    reject(new Error("chronosjs: the player needs a same-origin iframe"));
                    return;
                }
                this.builder = new DomBuilder(doc, {
                    live: true,
                    assets: replay.assets,
                    resolveUrl: options.resolveUrl,
                    maxNodes: options.maxNodes,
                });
                this.emulator = new Emulator(doc);
                this.isReady = true;
                this.render();
                resolve();
            }, { once: true });
        });
        container.appendChild(this.root);
        this.resizeObserver = new ResizeObserver(() => this.layout());
        this.resizeObserver.observe(this.stage);
        this.seek(options.startAt ?? 0);
        if (options.autoplay)
            void this.ready.then(() => this.play());
    }
    /** Resolves when the player shows the page; calls made before then apply when it does. */
    ready;
    get currentTime() {
        return this.time;
    }
    get isPlaying() {
        return this.playing;
    }
    on(event, listener) {
        const set = this.listeners.get(event) ?? new Set();
        this.listeners.set(event, set);
        set.add(listener);
        return () => set.delete(listener);
    }
    play() {
        if (this.playing)
            return;
        if (this.time >= this.duration)
            this.seek(0);
        this.playing = true;
        this.lastFrame = performance.now();
        this.raf = requestAnimationFrame(this.loop);
        this.updatePlayButton();
        this.emit("play");
    }
    pause() {
        if (!this.playing)
            return;
        this.playing = false;
        cancelAnimationFrame(this.raf);
        this.updatePlayButton();
        this.emit("pause");
    }
    toggle() {
        if (this.playing)
            this.pause();
        else
            this.play();
    }
    setSpeed(speed) {
        this.speed = speed;
    }
    /** `fit`, or a fixed scale (1 is the page's real size). */
    setZoom(zoom) {
        this.zoom = zoom;
        this.layout();
        this.render();
    }
    seek(time) {
        this.time = Math.max(0, Math.min(this.duration, time));
        this.render();
    }
    destroy() {
        this.pause();
        cancelAnimationFrame(this.statesCheck);
        this.resizeObserver.disconnect();
        this.root.remove();
        this.listeners.clear();
    }
    // ── playback ────────────────────────────────────────────────────────────
    loop = (now) => {
        if (!this.playing)
            return;
        const elapsed = Math.min(100, now - this.lastFrame);
        this.lastFrame = now;
        let t = this.time + elapsed * this.speed;
        if (this.skipIdle) {
            const next = this.nextEventAfter(this.time);
            if (next !== undefined && next - t > IDLE_MS)
                t = next - LEAD_MS;
        }
        if (t >= this.duration) {
            this.seek(this.duration);
            this.pause();
            this.emit("end");
            return;
        }
        this.seek(t);
        this.raf = requestAnimationFrame(this.loop);
    };
    nextEventAfter(t) {
        let lo = 0;
        let hi = this.times.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.times[mid] <= t)
                lo = mid + 1;
            else
                hi = mid;
        }
        return this.times[lo];
    }
    /** Bring the iframe to the state at `t`: rebuild from the last snapshot if needed, then apply events. */
    applyUntil(t) {
        let segment = this.metas[0];
        for (const index of this.metas) {
            if (this.times[index] > t)
                break;
            segment = index;
        }
        if (segment !== this.segment || (this.applied >= 0 && this.times[this.applied] > t)) {
            this.loadSnapshot(segment);
        }
        while (this.applied + 1 < this.events.length && this.times[this.applied + 1] <= t) {
            this.applied++;
            const event = this.events[this.applied];
            if (event[1] === E.Meta) {
                this.loadSnapshot(this.applied);
                continue;
            }
            this.apply(event);
        }
    }
    loadSnapshot(metaIndex) {
        const meta = this.events[metaIndex];
        const snapshot = this.events[metaIndex + 1];
        this.segment = metaIndex;
        this.applied = metaIndex + 1;
        this.setViewport(meta[3], meta[4]);
        if (!snapshot || snapshot[1] !== E.Snapshot)
            return;
        this.focus = [0, 0];
        this.emulator.reset(parseEnv(meta[5]));
        this.builder.snapshot(snapshot[2], meta[2], snapshot[3], snapshot[4]);
        this.watchStylesheets();
    }
    /** Once a stylesheet loads: scroll again (the page has its height now) and adapt its rules. */
    watchStylesheets() {
        for (const link of Array.from(this.builder.doc.querySelectorAll("link[rel~=stylesheet]"))) {
            if (link.sheet)
                continue;
            link.addEventListener("load", () => {
                this.builder.restoreScroll();
                this.emulator.dirty = true;
                this.render();
            }, { once: true });
        }
    }
    apply(event) {
        const p = event.slice(2);
        switch (event[1]) {
            case E.Mutation:
                this.builder.mutate(p[0], p[1], p[2], p[3], p[4]);
                this.emulator.dirty = true;
                if (p[2]?.length)
                    this.watchStylesheets();
                break;
            case E.Input:
                this.builder.input(p[0], p[1]);
                break;
            case E.Scroll:
                this.builder.scroll(p[0], p[1], p[2]);
                break;
            case E.Resize:
                this.setViewport(p[0], p[1]);
                break;
            case E.CssRule:
                this.builder.cssRule(p[0], p[1], p[2]);
                this.emulator.dirty = true;
                break;
            case E.Focus:
                this.focus = [p[0], p[1]];
                break;
        }
    }
    // ── rendering ───────────────────────────────────────────────────────────
    render() {
        const frame = this.cursor.at(this.time);
        if (this.isReady && !this.failure) {
            try {
                this.applyUntil(this.time);
            }
            catch (error) {
                // A malformed or oversized replay: stop, say so, never half-render.
                this.failure = error instanceof Error ? error : new Error(String(error));
                this.pause();
                this.emit("error");
                this.banner.dataset.show = "";
                this.banner.textContent = "⚠ This replay can't be shown.";
                return;
            }
            this.renderStates(frame);
            // Firefox applies a scroll on its next frame, which changes what the
            // cursor is over: look again then (it fires no scroll event without scripts).
            if (!this.statesCheck) {
                this.statesCheck = requestAnimationFrame(() => {
                    this.statesCheck = 0;
                    this.renderStates(this.cursor.at(this.time));
                });
            }
        }
        const counter = Math.min(2.2, Math.max(1, 1 / this.scale));
        this.cursorEl.style.display = frame.visible ? "block" : "none";
        this.cursorEl.style.transform = `translate(${frame.x}px,${frame.y}px) scale(${counter})`;
        if (frame.ripple >= 0) {
            this.rippleEl.style.opacity = String(1 - frame.ripple);
            this.rippleEl.style.transform = `translate(${frame.rippleX}px,${frame.rippleY}px) scale(${(0.35 + frame.ripple) * counter})`;
        }
        else {
            this.rippleEl.style.opacity = "0";
        }
        const progress = this.duration ? this.time / this.duration : 0;
        this.fill.style.width = `${progress * 100}%`;
        this.thumb.style.left = `${progress * 100}%`;
        this.timeEl.textContent = `${clock(this.time)} / ${clock(this.duration)}`;
        this.track.setAttribute("aria-valuenow", String(Math.round(this.time / 1000)));
        this.track.setAttribute("aria-valuemax", String(Math.round(this.duration / 1000)));
        this.track.setAttribute("aria-valuetext", clock(this.time));
        let error;
        for (const candidate of this.errors)
            if (candidate.t <= this.time)
                error = candidate;
        if (this.failure) {
            // The failure message stays.
        }
        else if (error) {
            // Also without controls: the error the replay ends on is worth showing.
            this.banner.dataset.show = "";
            this.banner.textContent = `⚠ ${error.label}`;
        }
        else {
            delete this.banner.dataset.show;
        }
        this.highlightAction();
        this.updatePlayButton();
        this.emit("time");
    }
    /** Hover follows the cursor, press the click, focus the recorded focus. */
    renderStates(frame) {
        this.emulator.refresh();
        const doc = this.builder.doc;
        const hovered = frame.visible ? doc.elementFromPoint(frame.x, frame.y) : null;
        this.emulator.set("hover", withAncestors(hovered));
        this.emulator.set("active", frame.ripple >= 0 && frame.ripple < 0.25 ? withAncestors(hovered) : []);
        const node = this.focus[0] ? this.builder.nodes[this.focus[0]] : undefined;
        const focused = node?.nodeType === 1 && node.isConnected ? node : null;
        this.emulator.set("focus", focused ? [focused] : []);
        this.emulator.set("focus-visible", focused && this.focus[1] ? [focused] : []);
        this.emulator.set("focus-within", withAncestors(focused));
    }
    setViewport(width, height) {
        if (!width || !height)
            return;
        this.viewport = [width, height];
        this.frame.style.width = `${width}px`;
        this.frame.style.height = `${height}px`;
        this.layout();
    }
    layout() {
        const [width, height] = this.viewport;
        const box = this.stage.getBoundingClientRect();
        if (!box.width || !box.height)
            return;
        const pad = 16;
        const fit = this.zoom === "fit";
        this.scale = fit
            ? Math.min(1.5, (box.width - pad * 2) / width, (box.height - pad * 2) / height)
            : this.zoom;
        // At a fixed zoom a page larger than the player scrolls inside the stage.
        this.stage.style.overflow = fit ? "hidden" : "auto";
        // Whole device pixels on the screen, not just within the stage (which may
        // itself sit at a fraction): Firefox renders a fractional position as is,
        // which blurs every edge of the page.
        const dpr = window.devicePixelRatio || 1;
        const snap = (offset, origin) => Math.round((origin + offset) * dpr) / dpr - origin;
        const left = snap(Math.max(fit ? 0 : pad, (box.width - width * this.scale) / 2), box.left);
        const top = snap(Math.max(fit ? 0 : pad, (box.height - height * this.scale) / 2), box.top);
        if (this.scale === 1) {
            // No transform at real size: Firefox places glyphs differently inside a
            // transformed layer, even a plain translate.
            this.frame.style.transform = "none";
            this.frame.style.left = `${left}px`;
            this.frame.style.top = `${top}px`;
        }
        else {
            this.frame.style.left = "0px";
            this.frame.style.top = "0px";
            this.frame.style.transform = `translate(${left}px,${top}px) scale(${this.scale})`;
        }
    }
    updatePlayButton() {
        const label = this.playing ? "Pause" : "Play";
        if (this.playButton.getAttribute("aria-label") === label)
            return;
        this.playButton.setAttribute("aria-label", label);
        this.playButton.textContent = this.playing ? "❚❚" : "▶";
    }
    bindTrack() {
        let dragging = false;
        let resume = false;
        const seekTo = (clientX) => {
            const box = this.track.getBoundingClientRect();
            this.seek(((clientX - box.left) / box.width) * this.duration);
        };
        this.track.addEventListener("pointerdown", (event) => {
            dragging = true;
            resume = this.playing;
            this.pause();
            this.track.setPointerCapture(event.pointerId);
            seekTo(event.clientX);
        });
        this.track.addEventListener("pointermove", (event) => {
            if (dragging)
                seekTo(event.clientX);
        });
        const end = () => {
            if (!dragging)
                return;
            dragging = false;
            if (resume)
                this.play();
        };
        this.track.addEventListener("pointerup", end);
        this.track.addEventListener("pointercancel", end);
    }
    buildActionList(h) {
        const aside = h("aside", "chronos-actions", this.root);
        const header = h("header", "", aside);
        h("span", "", header).textContent = "What happened";
        const network = h("label", "chronos-toggle", header);
        const box = h("input", "", network);
        box.type = "checkbox";
        box.checked = this.root.dataset.network !== undefined;
        box.addEventListener("change", () => {
            if (box.checked)
                this.root.dataset.network = "";
            else
                delete this.root.dataset.network;
        });
        h("span", "", network).textContent = "Network";
        const list = h("ol", "", aside);
        for (const action of this.actions) {
            const item = h("li", "", list);
            item.tabIndex = 0;
            item.dataset.kind = action.kind;
            item.dataset.severity = action.severity;
            h("span", "chronos-at", item).textContent = clock(action.t);
            h("span", "chronos-label", item).textContent = action.label;
            if (action.detail) {
                h("span", "chronos-detail", item).textContent = action.detail.split("\n").slice(0, 3).join("\n");
            }
            const go = () => this.seek(Math.max(0, action.t - 1200));
            item.addEventListener("click", go);
            item.addEventListener("keydown", (event) => {
                if (event.key === "Enter")
                    go();
            });
            this.items.push(item);
        }
    }
    highlightAction() {
        let current = -1;
        for (let i = 0; i < this.actions.length; i++) {
            if (this.actions[i].t > this.time)
                break;
            current = i;
        }
        if (current === this.currentAction)
            return;
        this.currentAction = current;
        this.items.forEach((item, index) => {
            if (index === current)
                item.dataset.current = "";
            else
                delete item.dataset.current;
            if (index > current)
                item.dataset.future = "";
            else
                delete item.dataset.future;
        });
        const item = this.items[current];
        const list = item?.parentElement;
        if (item && list) {
            const top = item.offsetTop - list.offsetTop;
            if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - item.offsetHeight) {
                list.scrollTop = Math.max(0, top - list.clientHeight / 2);
            }
        }
    }
    emit(event) {
        for (const listener of this.listeners.get(event) ?? [])
            listener(this.time);
    }
}
function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function injectStyles(doc) {
    if (doc.getElementById("chronos-player-styles"))
        return;
    const style = doc.createElement("style");
    style.id = "chronos-player-styles";
    style.textContent = PLAYER_CSS;
    doc.head.appendChild(style);
}
//# sourceMappingURL=player.js.map