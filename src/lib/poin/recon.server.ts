import { parse, type HTMLElement } from "node-html-parser";
import { assertPublicUrl, PoinGuardError } from "@/lib/poin/guard.server";
import type { Finding, SurfaceControl, SurfaceLink, SurfaceReport } from "@/lib/poin/types";

const UA = "Poin/1.0 (permissioned autonomous check)";
const DESTRUCTIVE =
  /\b(delete|remove|destroy|purchase|pay|buy|place order|checkout|confirm payment|unsubscribe|wipe|drop|sign out|log out|logout|deactivate|subscribe)\b/i;

function textOf(el: HTMLElement): string {
  return el.text.replace(/\s+/g, " ").trim();
}

function nameOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const title = el.getAttribute("title")?.trim();
  if (title) return title;
  const value = el.getAttribute("value")?.trim();
  const tag = el.tagName.toLowerCase();
  if ((tag === "input" || tag === "button") && value) return value;
  const placeholder = el.getAttribute("placeholder")?.trim();
  const text = textOf(el);
  if (text) return text.slice(0, 80);
  if (placeholder) return placeholder;
  return "";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    chunks.push(value);
    if (received >= cap) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const buf = new Uint8Array(Math.min(received, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, buf.byteLength - offset);
    buf.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= buf.byteLength) break;
  }
  return new TextDecoder().decode(buf);
}

async function fetchManual(raw: string): Promise<{
  url: string;
  status: number;
  html: string;
  bytes: number;
  ms: number;
  contentType: string;
}> {
  let current = (await assertPublicUrl(raw)).toString();
  const started = Date.now();
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new PoinGuardError("Redirect had no destination.");
      current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const html = await readCapped(res, 400_000);
    return {
      url: current,
      status: res.status,
      html,
      bytes: html.length,
      ms: Date.now() - started,
      contentType,
    };
  }
  throw new PoinGuardError("Too many redirects.");
}

function pushFinding(list: Finding[], finding: Finding) {
  if (list.some((f) => f.id === finding.id)) return;
  list.push(finding);
}

export async function surface(raw: string): Promise<SurfaceReport> {
  const page = await fetchManual(raw);
  const findings: Finding[] = [];
  const held: string[] = [];
  const controls: SurfaceControl[] = [];

  if (page.status >= 400) {
    pushFinding(findings, {
      id: `status-${page.status}`,
      title: `Landing page returned ${page.status}`,
      severity: page.status >= 500 ? "blocker" : "major",
      oracle: "network",
      summary: "The URL itself failed before any control was considered.",
      repro: [`Open ${page.url}`, `Observe HTTP ${page.status}`],
      evidence: `Status ${page.status}, ${page.bytes} bytes in ${page.ms} ms.`,
      fix: "Serve a successful document, or fix the redirect that lands here.",
      confidence: 0.98,
      confirmed: true,
    });
  }

  const isHtml = /html|xml/i.test(page.contentType) || page.html.trim().startsWith("<");
  if (!isHtml) {
    pushFinding(findings, {
      id: "not-html",
      title: "Response is not an HTML document",
      severity: "major",
      oracle: "network",
      summary: "Poin can map controls only on a document. This response is something else.",
      repro: [`Open ${page.url}`],
      evidence: page.contentType || "No content type",
      fix: "Point Poin at the HTML entry of the site, not a file or API route.",
      confidence: 0.9,
      confirmed: true,
    });
    return {
      finalUrl: page.url,
      status: page.status,
      title: "",
      ms: page.ms,
      bytes: page.bytes,
      counts: { links: 0, buttons: 0, inputs: 0, images: 0, forms: 0 },
      controls,
      links: [],
      findings,
      held,
    };
  }

  const root = parse(page.html);
  const title = textOf(root.querySelector("title") ?? parse("<i></i>")).slice(0, 140);
  const htmlEl = root.querySelector("html");
  if (!htmlEl?.getAttribute("lang")) {
    pushFinding(findings, {
      id: "missing-lang",
      title: "Document has no language",
      severity: "minor",
      oracle: "a11y",
      summary: "Screen readers guess the language when html has no lang.",
      repro: [`Open ${page.url}`, "Inspect the html element"],
      evidence: "<html> without lang",
      fix: "Set lang on the html element to the page language.",
      confidence: 0.95,
      confirmed: true,
    });
  }
  if (!title) {
    pushFinding(findings, {
      id: "missing-title",
      title: "Document has no title",
      severity: "minor",
      oracle: "a11y",
      summary: "A missing title leaves the tab, history, and assistive tech unnamed.",
      repro: [`Open ${page.url}`],
      evidence: "No <title> text",
      fix: "Add a concise document title.",
      confidence: 0.95,
      confirmed: true,
    });
  }
  if (!root.querySelector('meta[name="viewport"]')) {
    pushFinding(findings, {
      id: "missing-viewport",
      title: "No viewport meta",
      severity: "minor",
      oracle: "visual",
      summary: "Phones will lay this page out as a desktop and scale it down.",
      repro: [`Open ${page.url} on a narrow screen`],
      evidence: "No meta name=viewport",
      fix: "Add a viewport meta with width=device-width.",
      confidence: 0.9,
      confirmed: true,
    });
  }

  const imgs = root.querySelectorAll("img");
  const missingAlt = imgs.filter((img) => !img.hasAttribute("alt")).slice(0, 6);
  if (missingAlt.length) {
    pushFinding(findings, {
      id: "img-alt",
      title: `${missingAlt.length} image${missingAlt.length === 1 ? "" : "s"} with no alt`,
      severity: "major",
      oracle: "a11y",
      summary: "An image without alt is invisible to a screen reader. Empty alt is allowed for decoration; missing alt is not.",
      repro: [`Open ${page.url}`, "Inspect images without an alt attribute"],
      evidence: missingAlt.map((img) => img.getAttribute("src")?.slice(0, 80) || "(no src)").join(" · "),
      fix: "Add alt text, or alt=\"\" if the image is purely decorative.",
      confidence: 0.93,
      confirmed: true,
    });
  }

  const unnamed: string[] = [];
  for (const el of root.querySelectorAll("button, a, [role=button]")) {
    const name = nameOf(el);
    const tag = el.tagName.toLowerCase();
    if (!name) unnamed.push(tag);
    if (name && DESTRUCTIVE.test(name)) held.push(name.slice(0, 80));
  }
  if (unnamed.length) {
    pushFinding(findings, {
      id: "unnamed-controls",
      title: `${unnamed.length} control${unnamed.length === 1 ? "" : "s"} with no accessible name`,
      severity: "major",
      oracle: "a11y",
      summary: "Buttons or links with no text, aria-label, or title cannot be understood or targeted reliably.",
      repro: [`Open ${page.url}`, "Tab to controls that announce nothing"],
      evidence: unnamed.slice(0, 8).join(", "),
      fix: "Give each control a visible label or aria-label.",
      confidence: 0.88,
      confirmed: true,
    });
  }

  const unlabeled: string[] = [];
  const labels = new Set(
    root
      .querySelectorAll("label")
      .map((label) => label.getAttribute("for"))
      .filter((v): v is string => Boolean(v)),
  );
  for (const input of root.querySelectorAll("input, textarea, select")) {
    const type = (input.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    const aria = input.getAttribute("aria-label") || input.getAttribute("aria-labelledby");
    const id = input.getAttribute("id");
    const wrapped = input.closest("label");
    if (!aria && !wrapped && !(id && labels.has(id))) {
      unlabeled.push(input.getAttribute("name") || input.getAttribute("placeholder") || type);
    }
    if (type === "password") {
      held.push("Password field");
    }
  }
  if (unlabeled.length) {
    pushFinding(findings, {
      id: "unlabeled-fields",
      title: `${unlabeled.length} field${unlabeled.length === 1 ? "" : "s"} without a label`,
      severity: "major",
      oracle: "a11y",
      summary: "Placeholder text disappears and is not a label. These fields have neither.",
      repro: [`Open ${page.url}`, "Inspect inputs without a label, aria-label, or wrapping label"],
      evidence: unlabeled.slice(0, 8).join(" · "),
      fix: "Associate a label element, or set aria-label.",
      confidence: 0.9,
      confirmed: true,
    });
  }

  const deadHrefs: string[] = [];
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href")?.trim() ?? "";
    if (href === "" || href === "#" || href.toLowerCase().startsWith("javascript:")) {
      deadHrefs.push(nameOf(a) || href || "(empty)");
    }
  }
  if (deadHrefs.length) {
    pushFinding(findings, {
      id: "hash-links",
      title: `${deadHrefs.length} link${deadHrefs.length === 1 ? "" : "s"} go nowhere`,
      severity: "minor",
      oracle: "dead",
      summary: "href of #, empty, or javascript: is a control that looks navigable and is not.",
      repro: [`Open ${page.url}`, "Activate the listed links"],
      evidence: deadHrefs.slice(0, 6).join(" · "),
      fix: "Point the href at a real URL, or use a button for in-page actions.",
      confidence: 0.8,
      confirmed: true,
    });
  }

  if (held.length) {
    const unique = [...new Set(held)].slice(0, 8);
    pushFinding(findings, {
      id: "held-controls",
      title: `${unique.length} destructive or account control${unique.length === 1 ? "" : "s"} held`,
      severity: "note",
      oracle: "guard",
      summary: "Poin inventoried these and did not press them. A staging build with fake payment and fake accounts is how they get tested.",
      repro: ["Review the held list", "Replay on staging if you need them exercised"],
      evidence: unique.join(" · "),
      fix: "Provide a staging lane. Do not ask an autonomous hunter to pay or delete on production.",
      confidence: 1,
      confirmed: true,
    });
  }

  const origin = new URL(page.url).origin;
  const linkSet = new Map<string, string>();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let abs: URL;
    try {
      abs = new URL(href, page.url);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (/\.(png|jpe?g|gif|webp|svg|css|js|pdf|zip|mp4|woff2?)($|\?)/i.test(abs.pathname)) continue;
    if (DESTRUCTIVE.test(abs.pathname)) continue;
    if (abs.toString() === page.url) continue;
    if (!linkSet.has(abs.toString())) linkSet.set(abs.toString(), nameOf(a) || abs.pathname);
    if (linkSet.size >= 8) break;
  }

  const links: SurfaceLink[] = [];
  const queue = [...linkSet.keys()];
  let cursor = 0;
  async function checkOne(href: string): Promise<SurfaceLink> {
    try {
      await assertPublicUrl(href);
      const res = await fetch(href, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(6000),
      });
      await res.body?.cancel().catch(() => undefined);
      return { href, status: res.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      return { href, status: null, error: message.slice(0, 140) };
    }
  }
  async function worker() {
    while (cursor < queue.length) {
      const href = queue[cursor];
      cursor += 1;
      if (!href) continue;
      links.push(await checkOne(href));
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  for (const link of links) {
    if (link.status !== null && link.status < 400) continue;
    const label = linkSet.get(link.href) || link.href;
    pushFinding(findings, {
      id: `link-${slug(link.href)}`,
      title: link.status === null ? `Link could not be checked` : `Link returned ${link.status}`,
      severity: link.status !== null && link.status >= 500 ? "major" : "major",
      oracle: "network",
      summary: `“${label.slice(0, 60)}” does not resolve to a successful document.`,
      repro: [`Open ${page.url}`, `Follow ${link.href}`],
      evidence: link.status === null ? link.error || "No response" : `HTTP ${link.status}`,
      fix: "Repair the target, or remove the link.",
      confidence: link.status === null ? 0.62 : 0.92,
      confirmed: link.status !== null,
    });
  }

  for (const a of root.querySelectorAll("a").slice(0, 24)) {
    controls.push({ kind: "link", name: nameOf(a) || a.getAttribute("href") || "Link" });
  }
  for (const b of root.querySelectorAll("button").slice(0, 16)) {
    controls.push({ kind: "button", name: nameOf(b) || "Unnamed button" });
  }
  for (const input of root.querySelectorAll("input, textarea, select").slice(0, 12)) {
    const type = (input.getAttribute("type") || input.tagName).toLowerCase();
    if (type === "hidden") continue;
    controls.push({ kind: "input", name: nameOf(input) || type });
  }
  for (const form of root.querySelectorAll("form").slice(0, 6)) {
    controls.push({ kind: "form", name: form.getAttribute("action") || "Form" });
  }

  return {
    finalUrl: page.url,
    status: page.status,
    title,
    ms: page.ms,
    bytes: page.bytes,
    counts: {
      links: root.querySelectorAll("a").length,
      buttons: root.querySelectorAll("button").length,
      inputs: root.querySelectorAll("input, textarea, select").length,
      images: imgs.length,
      forms: root.querySelectorAll("form").length,
    },
    controls: controls.slice(0, 36),
    links,
    findings,
    held: [...new Set(held)].slice(0, 12),
  };
}
