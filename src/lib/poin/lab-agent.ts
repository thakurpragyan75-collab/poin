import { usePoin } from "@/lib/poin/store";
import type { Finding, GraphEdge, GraphNode, OracleId, Severity } from "@/lib/poin/types";

const DESTRUCTIVE =
  /\b(delete|remove|destroy|purchase|pay|buy|place order|checkout|confirm payment|unsubscribe|wipe|drop|sign out|log out|logout|deactivate)\b/i;

type Ctx = {
  root: HTMLElement;
  signal: AbortSignal;
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function accName(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.id) {
      const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.replace(/\s+/g, " ").trim();
    }
    const wrap = el.closest("label");
    if (wrap?.textContent?.trim()) return wrap.textContent.replace(/\s+/g, " ").trim();
    return (el.getAttribute("placeholder") || "").trim();
  }
  return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function visible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function siteOf(root: HTMLElement): HTMLElement {
  const site = root.querySelector(".lab-site");
  return site instanceof HTMLElement ? site : root;
}

function signature(root: HTMLElement): string {
  const site = siteOf(root);
  const view = site.getAttribute("data-view") ?? "page";
  const text = (site.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1600);
  return `${view}|${text}`;
}

function labelOf(root: HTMLElement): string {
  const site = siteOf(root);
  const heading = site.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
  const view = site.getAttribute("data-view") ?? "screen";
  return (heading || view).slice(0, 36);
}

function parseColor(input: string): [number, number, number, number] | null {
  const match = input.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a[0], a[1], a[2]);
  const l2 = luminance(b[0], b[1], b[2]);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function backgroundOf(el: HTMLElement): [number, number, number] {
  let cur: HTMLElement | null = el;
  while (cur) {
    const parsed = parseColor(getComputedStyle(cur).backgroundColor);
    if (parsed && parsed[3] > 0.85) return [parsed[0], parsed[1], parsed[2]];
    cur = cur.parentElement;
  }
  return [244, 241, 234];
}

type Control = {
  el: HTMLElement;
  key: string;
  name: string;
  kind: "click" | "fill" | "select";
  destructive: boolean;
};

function controlsIn(root: HTMLElement): Control[] {
  const nodes = [...root.querySelectorAll("a, button, input, select, textarea, summary, [role='button']")];
  const counts = new Map<string, number>();
  const out: Control[] = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (!visible(node)) continue;
    if (node instanceof HTMLInputElement && ["hidden", "password", "file", "submit"].includes(node.type)) continue;
    if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") continue;
    const name = accName(node);
    const base = `${node.tagName}|${name}`;
    const index = counts.get(base) ?? 0;
    counts.set(base, index + 1);
    let kind: Control["kind"] = "click";
    if (node instanceof HTMLSelectElement) kind = "select";
    else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) kind = "fill";
    out.push({
      el: node,
      key: `${base}|${index}`,
      name,
      kind,
      destructive: DESTRUCTIVE.test(name),
    });
  }
  return out;
}

function place(el: HTMLElement, name: string) {
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = el.getBoundingClientRect();
  usePoin.getState().setHighlight(
    {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      name: name || "control",
    },
    "lab",
  );
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillFor(el: HTMLInputElement | HTMLTextAreaElement): string {
  if (el instanceof HTMLTextAreaElement) return "Poin probe. Please ignore.";
  if (el.type === "email") return "poin@example.com";
  if (el.type === "number") return "2";
  if (el.type === "search") return "zzzz-empty";
  if (el.type === "url") return "https://example.com";
  return "Poin probe";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
}

export async function runLab({ root, signal }: Ctx) {
  const store = usePoin.getState();
  const target = store.targetLabel || "Specimen";
  const errors: string[] = [];
  const nets: string[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.message || "Script error");
    event.preventDefault();
  };
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    if (!text.startsWith("Warning:")) errors.push(text.slice(0, 280));
    originalError.apply(console, args);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    if (res.status >= 400) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      nets.push(`${res.status} ${url}`);
    }
    return res;
  };
  window.addEventListener("error", onError);

  const globalTried = new Set<string>();
  const scanned = new Set<string>();
  const findingIds = new Set<string>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sigNode = new Map<string, string>();
  let actions = 0;
  let guarded = 0;
  let flakes = 0;
  let loops = 0;
  let previousSig = "";

  const say = (kind: "think" | "act" | "observe" | "bug" | "guard" | "done", text: string) => {
    usePoin.getState().appendThought(kind, text);
  };
  const noteFinding = (finding: Finding) => {
    if (findingIds.has(finding.id)) return;
    findingIds.add(finding.id);
    usePoin.getState().addFinding(finding);
    const node = nodes[nodes.length - 1];
    if (node && finding.severity !== "note") node.bugs += 1;
    usePoin.getState().setGraph(nodes.map((n) => ({ ...n })), edges.map((e) => ({ ...e })));
    if (finding.severity !== "note") say("bug", finding.title);
  };

  const publish = () => {
    const triedCount = globalTried.size;
    usePoin.getState().patchStats({
      actions,
      states: nodes.length,
      controls: triedCount,
      tried: triedCount,
      guarded,
      flakesSuppressed: flakes,
      loopsCut: loops,
    });
    usePoin.getState().setGraph(nodes.map((n) => ({ ...n })), edges.map((e) => ({ ...e })));
  };

  try {
    say("think", `${target} is on the bench. Poin will press each new control once per screen.`);
    while (!signal.aborted && !usePoin.getState().stopRequested && actions < 26) {
      const sig = signature(root);
      let nodeId = sigNode.get(sig);
      if (!nodeId) {
        nodeId = `s${nodes.length}`;
        sigNode.set(sig, nodeId);
        if (previousSig && previousSig !== sig) {
          const from = sigNode.get(previousSig);
          if (from) edges.push({ from, to: nodeId });
        }
        nodes.push({ id: nodeId, label: labelOf(root), tried: 0, total: 0, bugs: 0 });
        say("observe", `New screen “${labelOf(root)}”.`);
      } else if (previousSig && previousSig !== sig) {
        loops += 1;
        say("think", "Known screen. Skipping controls already pressed here.");
      }
      previousSig = sig;
      const list = controlsIn(root);
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        node.total = list.length;
        node.tried = list.filter((c) => globalTried.has(c.key)).length;
      }
      if (!scanned.has(sig)) {
        scanned.add(sig);
        scan(root, target, noteFinding);
      }
      const next = list.find((c) => !globalTried.has(c.key));
      if (!next) {
        say("think", "No untried controls on the screens reached. Stopping before a loop.");
        break;
      }
      globalTried.add(next.key);
      if (node) node.tried = list.filter((c) => globalTried.has(c.key)).length;
      place(next.el, next.name || next.kind);
      if (next.destructive) {
        guarded += 1;
        say("guard", `Held “${next.name}”. Poin does not pay or delete.`);
        noteFinding({
          id: `guard-${slug(next.name || next.key)}`,
          title: `Held: ${next.name || "control"}`,
          severity: "note",
          oracle: "guard",
          summary: "The control matches a pay, delete, or account action. It was not pressed.",
          repro: [`Open ${target}`, `See “${next.name}”`, "Leave it unpressed"],
          evidence: "Name matched the destructive guard.",
          fix: "Retest on staging with a fake payment or fake account if this path matters.",
          confidence: 1,
          confirmed: true,
          element: next.name,
        });
        publish();
        await sleep(220, signal);
        continue;
      }

      const before = sig;
      const errAt = errors.length;
      const netAt = nets.length;
      say("act", next.kind === "fill" ? `Fill “${next.name || "field"}”.` : `Press “${next.name || "control"}”.`);
      if (next.kind === "fill" && (next.el instanceof HTMLInputElement || next.el instanceof HTMLTextAreaElement)) {
        setNativeValue(next.el, fillFor(next.el));
      } else if (next.kind === "select" && next.el instanceof HTMLSelectElement && next.el.options.length > 1) {
        const option = next.el.options[1];
        if (option) {
          next.el.value = option.value;
          next.el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        next.el.click();
      }
      actions += 1;
      await sleep(260, signal);
      if (signal.aborted || usePoin.getState().stopRequested) break;

      const stepErr = errors.slice(errAt);
      const stepNet = nets.slice(netAt);
      for (const err of stepErr) {
        noteFinding({
          id: `console-${slug(next.name)}-${slug(err)}`,
          title: `Exception after “${next.name || "control"}”`,
          severity: "blocker",
          oracle: "console",
          summary: "The action and the exception are the same step. That is the root cause trail.",
          repro: [`Open ${target}`, `Press “${next.name}”`, err.slice(0, 180)],
          evidence: err.slice(0, 280),
          fix: "Guard the missing value in that handler, and show a failure the user can read.",
          confidence: 0.92,
          confirmed: true,
          element: next.name,
        });
      }
      for (const net of stepNet) {
        noteFinding({
          id: `net-${slug(net)}`,
          title: `Failed response after “${next.name || "control"}”`,
          severity: "major",
          oracle: "network",
          summary: "A 4xx or 5xx landed in the same step as this press.",
          repro: [`Open ${target}`, `Press “${next.name}”`, net],
          evidence: net,
          fix: "Fix the endpoint or stop calling it from this control.",
          confidence: 0.9,
          confirmed: true,
          element: next.name,
        });
      }

      const after = signature(root);
      if (next.kind === "fill" && (next.el instanceof HTMLInputElement || next.name.toLowerCase().includes("search"))) {
        const region = root.querySelector("[data-results]");
        if (region) {
          const text = (region.textContent || "").replace(/\s+/g, " ").trim();
          const page = (root.innerText || "").toLowerCase();
          if (text.length < 2 && !/no results|nothing found|no matches|empty/.test(page)) {
            noteFinding({
              id: "empty-results",
              title: "Search collapses to a blank with no empty state",
              severity: "major",
              oracle: "visual",
              summary: "A query that matches nothing removes the list and offers no explanation.",
              repro: [`Open ${target}`, `Search for “zzzz-empty”`, "The results region is blank"],
              evidence: "Result region text length is zero and no empty copy is present.",
              fix: "Render an explicit empty state when the filter matches nothing.",
              confidence: 0.9,
              confirmed: true,
              element: next.name,
            });
          }
        }
      }

      if (after === before && stepErr.length === 0 && stepNet.length === 0 && next.kind === "click") {
        next.el.click();
        await sleep(180, signal);
        const retry = signature(root);
        if (retry === before) {
          noteFinding({
            id: `dead-${slug(next.key)}`,
            title: `Dead press: ${next.name || "control"}`,
            severity: "major",
            oracle: "dead",
            summary: "Pressed twice. The screen did not change and nothing failed out loud.",
            repro: [`Open ${target}`, `Press “${next.name || "the control"}”`, "Press it again"],
            evidence: "Visible text and view id were identical after both presses.",
            fix: "Bind the control to an action, or remove it.",
            confidence: 0.9,
            confirmed: true,
            element: next.name,
          });
        } else {
          flakes += 1;
          say("observe", `Flake held back on “${next.name}”. It responded on the second press.`);
        }
      } else if (after !== before) {
        say("observe", "Screen changed. The ledger keeps this as its own state.");
      }
      publish();
    }
    if (!signal.aborted && !usePoin.getState().stopRequested) {
      say("done", "Hunt complete.");
      publish();
      usePoin.getState().finish();
    } else if (usePoin.getState().stopRequested && usePoin.getState().screen === "running") {
      say("done", "Stopped. Partial dossier kept.");
      publish();
      usePoin.getState().finish();
    }
  } finally {
    window.removeEventListener("error", onError);
    console.error = originalError;
    window.fetch = originalFetch;
    usePoin.getState().setHighlight(null, "lab");
  }
}

function scan(
  root: HTMLElement,
  target: string,
  noteFinding: (finding: Finding) => void,
) {
  const view = root.querySelector("[data-view]")?.getAttribute("data-view") ?? "page";
  const imgs = [...root.querySelectorAll("img")].filter((img) => !img.hasAttribute("alt"));
  if (imgs.length) {
    noteFinding(make({
      id: `alt-${view}`,
      title: `${imgs.length} image${imgs.length === 1 ? "" : "s"} with no alt`,
      severity: "major",
      oracle: "a11y",
      summary: "Missing alt is unread by assistive tech. Empty alt would mean decorative. This attribute is absent.",
      repro: [`Open ${target}`, "Inspect the product image"],
      evidence: imgs.map((img) => img.getAttribute("src")?.slice(0, 48) || "(no src)").join(" · "),
      fix: "Add an alt that says what the image is, or alt=\"\" if it is decorative.",
    }));
  }

  for (const el of root.querySelectorAll("button, a, [role='button']")) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    if (accName(el)) continue;
    noteFinding(make({
      id: `unnamed-${view}-${el.tagName}`,
      title: "Control with no accessible name",
      severity: "major",
      oracle: "a11y",
      summary: "This control has no text, aria-label, or title. A hunter and a screen reader both have to guess.",
      repro: [`Open ${target}`, "Tab to the icon control"],
      evidence: el.tagName.toLowerCase(),
      fix: "Add a visible label or aria-label.",
    }));
    break;
  }

  const labels = new Set(
    [...root.querySelectorAll("label")]
      .map((l) => l.getAttribute("for"))
      .filter((v): v is string => Boolean(v)),
  );
  const unlabeled = [...root.querySelectorAll("input, textarea, select")].filter((el) => {
    if (!(el instanceof HTMLElement) || !visible(el)) return false;
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button"].includes(el.type)) return false;
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
    if (el.closest("label")) return false;
    if (el.id && labels.has(el.id)) return false;
    return true;
  });
  if (unlabeled.length) {
    noteFinding(make({
      id: `fields-${view}`,
      title: `${unlabeled.length} field${unlabeled.length === 1 ? "" : "s"} without a label`,
      severity: "major",
      oracle: "a11y",
      summary: "Placeholder text is not a name. These fields have neither a label nor aria-label.",
      repro: [`Open ${target}`, "Inspect the unlabeled fields"],
      evidence: unlabeled
        .map((el) => (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase()))
        .join(", "),
      fix: "Associate a label element or set aria-label.",
    }));
  }

  const low = [...root.querySelectorAll("p, span, a, h1, h2, button, li")].find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (text.length < 2 || text.length > 32) return false;
    const fg = parseColor(getComputedStyle(el).color);
    if (!fg) return false;
    const ratio = contrast([fg[0], fg[1], fg[2]], backgroundOf(el));
    return ratio < 2.1;
  });
  if (low instanceof HTMLElement) {
    const fg = parseColor(getComputedStyle(low).color);
    const ratio = fg ? contrast([fg[0], fg[1], fg[2]], backgroundOf(low)) : 0;
    noteFinding(make({
      id: `contrast-${view}-${slug(low.textContent || "text")}`,
      title: `Contrast fails on “${(low.textContent || "").trim().slice(0, 24)}”`,
      severity: "major",
      oracle: "a11y",
      summary: "The text is too close to its background to read reliably.",
      repro: [`Open ${target}`, "Read the flagged text"],
      evidence: `Contrast ratio ${ratio.toFixed(2)} : 1`,
      fix: "Darken the text or lighten the surface until the ratio clears 4.5:1.",
    }));
  }

  const overflow = [...root.querySelectorAll("p, h1, h2, span, a, div")].find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (text.length < 28) return false;
    return el.scrollWidth > el.clientWidth + 12 && el.clientHeight < 80 && el.clientWidth > 30;
  });
  if (overflow instanceof HTMLElement) {
    noteFinding(make({
      id: `overflow-${view}`,
      title: "A line overflows its box",
      severity: "minor",
      oracle: "visual",
      summary: "Text is wider than the element that contains it, so the line clips.",
      repro: [`Open ${target}`, "Look along the clipped promo line"],
      evidence: (overflow.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
      fix: "Allow the line to wrap, or shorten the copy.",
    }));
  }

  const buttons = [...root.querySelectorAll("button")].filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement && visible(el));
  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const a = buttons[i];
      const b = buttons[j];
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) continue;
      const area = w * h;
      const minArea = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (minArea > 0 && area / minArea > 0.4) {
        noteFinding(make({
          id: `overlap-${view}`,
          title: `“${accName(a) || "Button"}” overlaps “${accName(b) || "Button"}”`,
          severity: "major",
          oracle: "visual",
          summary: "Two controls occupy the same pixels. The one underneath cannot be aimed at.",
          repro: [`Open ${target}`, "Try to press each of the overlapping controls"],
          evidence: `Intersection covers ${Math.round((area / minArea) * 100)}% of the smaller control.`,
          fix: "Place the controls in separate tracks.",
        }));
        i = buttons.length;
        break;
      }
    }
  }

  if (root.querySelector("[data-status='404']")) {
    noteFinding(make({
      id: `missing-${view}`,
      title: "Reached a page that is not found",
      severity: "major",
      oracle: "network",
      summary: "A control navigated into an in-app 404.",
      repro: [`Open ${target}`, "Follow the control that left the main screen"],
      evidence: "Screen marked not found.",
      fix: "Publish the document or remove the control.",
    }));
  }
}

function make(partial: {
  id: string;
  title: string;
  severity: Severity;
  oracle: OracleId;
  summary: string;
  repro: string[];
  evidence: string;
  fix: string;
}): Finding {
  return { ...partial, confidence: 0.9, confirmed: true };
}
