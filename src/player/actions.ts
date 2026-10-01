import { E, type ReplayEvent, type SAdd, type SAttrChange, type SElement, type STextChange } from "../format.js";
import { DomBuilder } from "./rebuild.js";

export type ActionKind = "page" | "click" | "input" | "key" | "nav" | "http" | "error" | "visibility";

export interface Action {
  /** Milliseconds since the start of the replay. */
  t: number;
  kind: ActionKind;
  /** Plain words: "Clicked “Pay now”". */
  label: string;
  /** Extra detail (a stack, a status, a duration). */
  detail?: string;
  severity: "info" | "warning" | "error";
}

const INTERACTIVE =
  "button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],summary,label,input,select,textarea";

/**
 * The replay as a list of plain-language actions. The page is rebuilt in a
 * detached document (nothing loads or renders there) so each click can be
 * named after what was on screen at that moment.
 */
export function deriveActions(events: ReplayEvent[]): Action[] {
  const doc = document.implementation.createHTMLDocument("");
  const builder = new DomBuilder(doc, { live: false });
  const actions: Action[] = [];
  let href = "";
  let path = "";
  let lastClick: { id: number; index: number; t: number } | undefined;

  for (const event of events) {
    const [t, type] = event;
    const p = event.slice(2) as unknown[];
    switch (type) {
      case E.Meta: {
        href = p[0] as string;
        const next = pathOf(href);
        if (next !== path) actions.push({ t, kind: "page", label: `Opened ${next}`, severity: "info" });
        path = next;
        break;
      }
      case E.Snapshot:
        builder.snapshot(p[0] as SElement, href);
        break;
      case E.Mutation:
        builder.mutate(p[0] as number, p[1] as number[], p[2] as SAdd[], p[3] as SAttrChange[], p[4] as STextChange[]);
        break;
      case E.Click:
        lastClick = { id: p[0] as number, index: actions.length, t };
        actions.push({
          t,
          kind: "click",
          label: `Clicked ${quote(name(builder.nodes[p[0] as number]))}`,
          severity: "info",
        });
        break;
      case E.Input: {
        const id = p[0] as number;
        const value = p[1] as string | number;
        builder.input(id, value);
        const node = builder.nodes[id] as Element | undefined;
        const field = quote(name(node));
        const last = actions[actions.length - 1];
        let label: string;
        if (node?.localName === "input" && ["checkbox", "radio"].includes((node as HTMLInputElement).type)) {
          label = `${value === 1 ? "Checked" : "Unchecked"} ${field}`;
        } else if (node?.localName === "select") {
          const select = node as HTMLSelectElement;
          label = `Chose ${quote(select.selectedOptions[0]?.textContent?.trim() || String(value))} in ${field}`;
        } else {
          label = `Typed in ${field}`;
        }
        // One action for a run of keystrokes in the same field.
        if (last?.kind === "input" && last.label === label && label.startsWith("Typed")) break;
        // A click that ticked a box or picked an option is one action, not two.
        if (
          !label.startsWith("Typed") &&
          lastClick?.index === actions.length - 1 &&
          lastClick.id === id &&
          t - lastClick.t < 200
        ) {
          actions.pop();
        }
        actions.push({ t, kind: "input", label, severity: "info" });
        break;
      }
      case E.Key:
        actions.push({ t, kind: "key", label: `Pressed ${p[1]}`, severity: "info" });
        break;
      case E.Nav:
        path = p[0] as string;
        actions.push({ t, kind: "nav", label: `Went to ${path}`, severity: "info" });
        break;
      case E.Http: {
        const [method, url, status, ms] = p as [string, string, number, number];
        const severity = status === 0 || status >= 500 ? "error" : status >= 400 ? "warning" : "info";
        actions.push({
          t,
          kind: "http",
          label: `${method} ${url}`,
          detail: `${status || "network error"} · ${ms} ms`,
          severity,
        });
        break;
      }
      case E.Error:
        actions.push({
          t,
          kind: "error",
          label: p[1] as string,
          detail: p[2] as string | undefined,
          severity: "error",
        });
        break;
      case E.Visibility:
        actions.push({
          t,
          kind: "visibility",
          label: p[0] ? "Left the tab" : "Came back to the tab",
          severity: "info",
        });
        break;
    }
  }
  return actions;
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

function quote(text: string): string {
  return `“${text}”`;
}

/** What a person would call the element: its label, text or purpose. */
export function name(node: Node | undefined): string {
  if (!node) return "the page";
  const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!start) return "the page";
  const interactive = start.closest(INTERACTIVE);
  if (!interactive) {
    // Not a control: name it by its own words only, not everything inside it.
    const own = Array.from(start.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (own) return clip(own);
    const img = start.localName === "img" ? start.getAttribute("alt") : null;
    return img ? clip(img) : "an empty area";
  }
  const el = interactive;
  const aria = el.getAttribute("aria-label") ?? el.getAttribute("title");
  if (aria) return clip(aria);
  const tag = el.localName;
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const label = labelFor(el);
    if (label) return clip(label);
    const hint = el.getAttribute("placeholder") ?? el.getAttribute("name");
    if (hint) return clip(hint);
    if (tag === "input" && ["submit", "button"].includes((el as HTMLInputElement).type)) {
      return clip(el.getAttribute("value") ?? "Submit");
    }
    return tag === "input" ? `${(el as HTMLInputElement).type || "text"} field` : tag;
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return clip(text);
  const img = el.querySelector("img[alt]");
  if (img) return clip(img.getAttribute("alt") ?? "image");
  return tag;
}

function labelFor(el: Element): string | undefined {
  const id = el.getAttribute("id");
  if (id) {
    for (const label of Array.from(el.ownerDocument.querySelectorAll("label"))) {
      if (label.getAttribute("for") === id) return labelText(label);
    }
  }
  const wrapping = el.closest("label");
  return wrapping ? labelText(wrapping) : undefined;
}

/** A label's own words, without the text of the controls inside it (a select's options). */
function labelText(label: Element): string | undefined {
  const copy = label.cloneNode(true) as Element;
  for (const control of Array.from(copy.querySelectorAll("select,textarea,input,option,button"))) control.remove();
  return copy.textContent?.replace(/\s+/g, " ").trim() || undefined;
}

function clip(text: string): string {
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}
