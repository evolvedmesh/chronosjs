export const DEFAULT_PRIVACY = {
    maskInputs: true,
    maskTextSelector: "[data-chronos-mask]",
    blockSelector: "[data-chronos-block]",
    unmaskSelector: "[data-chronos-unmask]",
};
/** Node ids for one snapshot generation. A new snapshot starts a new mirror. */
export class Mirror {
    ids = new WeakMap();
    next = 1;
    id(node) {
        return node ? this.ids.get(node) : undefined;
    }
    assign(node) {
        const id = this.next++;
        this.ids.set(node, id);
        return id;
    }
}
/** Elements whose children are never recorded. */
const OPAQUE_TAGS = new Set(["script", "noscript", "iframe", "object", "embed", "template"]);
/** Attributes that never help a replay, or would make the player fetch or run something. */
const DROPPED_ATTRS = new Set(["integrity", "nonce", "crossorigin", "autofocus", "srcdoc", "ping"]);
const LINK_ATTRS = new Set(["rel", "href", "media", "type", "sizes", "disabled"]);
const UNMASKED_INPUT_TYPES = new Set([
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "range",
    "color",
    "file",
    "image",
    "hidden",
]);
export const SVG_NS = "http://www.w3.org/2000/svg";
/** Whether children of `parent` are SVG by default, as the HTML parser would decide. */
export function inSvg(parent) {
    return (parent.nodeType === 1 &&
        parent.namespaceURI === SVG_NS &&
        parent.localName !== "foreignObject");
}
export function maskText(text) {
    return text.replace(/\S/g, "*");
}
export class Serializer {
    privacy;
    onStylesheet;
    /** Elements whose children are not recorded (scripts, blocked elements, …). */
    opaque = new WeakSet();
    mirror = new Mirror();
    /** The last form state recorded per control, so unchanged values are not recorded again. */
    values = new WeakMap();
    constructor(privacy, 
    /** Called for each `<link rel=stylesheet>`, to inline its CSS. */
    onStylesheet) {
        this.privacy = privacy;
        this.onStylesheet = onStylesheet;
    }
    /** Start a new generation and serialize the whole document. */
    snapshot(doc) {
        this.mirror = new Mirror();
        this.values = new WeakMap();
        return this.node(doc.documentElement, false);
    }
    /** Whether text under `parent` is masked. */
    masked(parent) {
        const el = parent instanceof Element ? parent : parent?.parentElement;
        return !!el?.closest(this.privacy.maskTextSelector);
    }
    /**
     * Serialize a node and its subtree, assigning ids in document order.
     * `svg`: whether the parent makes its children SVG (see `inSvg()`).
     */
    node(node, mask, svg = false) {
        switch (node.nodeType) {
            case 3: // text
            case 4: {
                // CDATA
                this.mirror.assign(node);
                const text = node.data;
                return mask ? maskText(text) : text;
            }
            case 8: // comment
                this.mirror.assign(node);
                return 0;
            case 1:
                return this.element(node, mask, svg);
            default:
                return null;
        }
    }
    element(el, mask, svg) {
        this.mirror.assign(el);
        const tag = el.localName;
        let attrs = this.attributes(el, tag);
        const isSvg = el.namespaceURI === SVG_NS;
        // The namespace is implied by the parent; say so only when it isn't
        // (an SVG shape moved under a <div>, say).
        if (isSvg !== (svg || tag === "svg"))
            attrs = { ...attrs, $ns: isSvg ? "s" : "h" };
        const out = [tag];
        if (el.matches(this.privacy.blockSelector)) {
            const rect = el.getBoundingClientRect();
            this.opaque.add(el);
            out.push({ ...attrs, $w: Math.round(rect.width), $h: Math.round(rect.height) });
            return out;
        }
        if (attrs)
            out.push(attrs);
        if (OPAQUE_TAGS.has(tag)) {
            this.opaque.add(el);
            return out;
        }
        const childMask = mask || el.matches(this.privacy.maskTextSelector);
        for (let child = el.firstChild; child; child = child.nextSibling) {
            const s = this.node(child, childMask, isSvg && tag !== "foreignObject");
            if (s !== null)
                out.push(s);
        }
        return out;
    }
    /** The recorded attributes of an element, including Chronos state (`$…`). */
    attributes(el, tag = el.localName) {
        const attrs = {};
        let any = false;
        if (tag !== "script" && tag !== "meta" && !(tag === "link" && !isUsefulLink(el))) {
            for (const attr of Array.from(el.attributes)) {
                const value = this.attribute(el, tag, attr.name, attr.value);
                if (value !== null) {
                    attrs[attr.name] = value;
                    any = true;
                }
            }
        }
        const state = this.state(el, tag);
        if (state) {
            Object.assign(attrs, state);
            any = true;
        }
        return any ? attrs : undefined;
    }
    /** One attribute as recorded, or null when it is dropped. */
    attribute(el, tag, name, value) {
        if (name.startsWith("on") || DROPPED_ATTRS.has(name))
            return null;
        if (tag === "script" || tag === "meta")
            return null;
        if (tag === "link" && (!isUsefulLink(el) || !LINK_ATTRS.has(name)))
            return null;
        if ((tag === "iframe" || tag === "object" || tag === "embed") && (name === "src" || name === "data")) {
            return null;
        }
        if (name === "value" && tag === "input") {
            const type = el.type;
            if (type === "hidden")
                return null;
            if (this.isMasked(el))
                return maskText(value);
        }
        return value;
    }
    /** Live state that is not in the attributes: values, CSSOM rules, scroll. */
    state(el, tag) {
        let state;
        const set = (key, value) => {
            state ??= {};
            state[key] = value;
        };
        // Form state only where it differs from what the attributes give, so a
        // rebuilt control is "dirty" exactly when the live one is.
        if (tag === "input") {
            const input = el;
            if (input.type === "checkbox" || input.type === "radio") {
                if (input.checked !== input.defaultChecked)
                    set("$c", input.checked ? 1 : 0);
            }
            else if (input.type !== "hidden" && input.type !== "file" && input.value !== input.defaultValue) {
                set("$v", this.value(input));
            }
        }
        else if (tag === "textarea") {
            const textarea = el;
            if (textarea.value !== textarea.defaultValue)
                set("$v", this.value(textarea));
        }
        else if (tag === "select") {
            set("$v", el.selectedIndex);
        }
        if (tag === "input" || tag === "textarea" || tag === "select") {
            const value = this.formValue(el);
            if (value !== undefined)
                this.values.set(el, value);
        }
        else if (tag === "style") {
            const rules = cssomRules(el);
            if (rules)
                set("$css", rules);
        }
        else if (tag === "link" && this.onStylesheet && /\bstylesheet\b/i.test(el.getAttribute("rel") ?? "")) {
            this.onStylesheet(el);
        }
        if (el.scrollTop || el.scrollLeft) {
            if (el !== el.ownerDocument.documentElement && el !== el.ownerDocument.body) {
                set("$sx", Math.round(el.scrollLeft));
                set("$sy", Math.round(el.scrollTop));
            }
        }
        return state;
    }
    /**
     * A form control's state as recorded: its text (masked), 1/0 for a checkbox
     * or radio, the selected index of a select. Undefined for anything else.
     */
    formValue(el) {
        const tag = el.localName;
        if (tag === "input") {
            const input = el;
            if (input.type === "checkbox" || input.type === "radio")
                return input.checked ? 1 : 0;
            if (input.type === "hidden" || input.type === "file")
                return undefined;
            return this.value(input);
        }
        if (tag === "textarea")
            return this.value(el);
        if (tag === "select")
            return el.selectedIndex;
        return undefined;
    }
    /** What a text field's value is recorded as. */
    value(el) {
        return this.isMasked(el) ? maskText(el.value) : el.value;
    }
    isMasked(el) {
        if (el.localName === "input") {
            const type = el.type;
            if (type === "password")
                return true;
            if (UNMASKED_INPUT_TYPES.has(type))
                return false;
        }
        return this.privacy.maskInputs && !el.closest(this.privacy.unmaskSelector);
    }
}
function isUsefulLink(el) {
    return /\b(stylesheet|icon)\b/i.test(el.getAttribute("rel") ?? "");
}
/**
 * Rules a `<style>` holds only in the CSSOM (CSS-in-JS libraries such as
 * emotion insert them with `insertRule`, leaving the element empty).
 */
export function cssomRules(style) {
    if ((style.textContent ?? "").trim() !== "")
        return undefined;
    try {
        const rules = style.sheet?.cssRules;
        if (!rules?.length)
            return undefined;
        return Array.from(rules, (rule) => rule.cssText);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=serialize.js.map