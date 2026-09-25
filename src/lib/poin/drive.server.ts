import { assertPublicUrl, PoinGuardError } from "@/lib/poin/guard.server";
import { SECURITY_HEADERS, emptyProbe, type Probe } from "@/lib/poin/suites";
import {
  DRIVE_FRAME,
  emptyStats,
  type DriveView,
  type Finding,
  type GraphEdge,
  type GraphNode,
  type Highlight,
  type RunStats,
  type Thought,
} from "@/lib/poin/types";

type Run = {
  id: string;
  status: "running" | "done" | "error";
  target: string;
  thoughts: Thought[];
  findings: Finding[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: RunStats;
  highlight: Highlight;
  shot: string | null;
  shotSeq: number;
  error?: string;
  note: string;
  stop: boolean;
  probe: Probe | null;
};

type GlobalPoin = typeof globalThis & {
  __poinRuns?: Map<string, Run>;
  __poinActive?: boolean;
};

function runs(): Map<string, Run> {
  const g = globalThis as GlobalPoin;
  if (!g.__poinRuns) g.__poinRuns = new Map();
  return g.__poinRuns;
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const UA_NOTE = "Live drive. Same host only. Pay, delete, subscribe, and off-site links are held.";

function viewOf(run: Run, sinceSeq: number): DriveView {
  return {
    id: run.id,
    status: run.status,
    target: run.target,
    thoughts: run.thoughts.slice(-32),
    findings: run.findings.slice(),
    nodes: run.nodes.slice(),
    edges: run.edges.slice(),
    stats: { ...run.stats },
    highlight: run.highlight,
    shot: run.shotSeq > sinceSeq ? run.shot : null,
    shotSeq: run.shotSeq,
    error: run.error,
    note: run.note,
    probe: run.status === "running" ? null : run.probe,
  };
}

export function readDrive(id: string, sinceSeq: number): DriveView | null {
  const run = runs().get(id);
  if (!run) return null;
  return viewOf(run, sinceSeq);
}

export function stopDrive(id: string): boolean {
  const run = runs().get(id);
  if (!run) return false;
  run.stop = true;
  return true;
}

async function launchBrowser() {
  const spec = "playwright";
  try {
    const pw = (await import(/* @vite-ignore */ spec)) as typeof import("playwright");
    return await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/cannot find module|cannot find package|NO_ENGINE|unknown module/i.test(message)) {
      throw new Error("NO_ENGINE");
    }
    throw new Error("NO_ENGINE");
  }
}

export async function beginDrive(raw: string): Promise<string> {
  const g = globalThis as GlobalPoin;
  if (g.__poinActive) {
    throw new PoinGuardError("A browser hunt is already running.");
  }
  const url = (await assertPublicUrl(raw)).toString();
  g.__poinActive = true;
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  try {
    browser = await launchBrowser();
  } catch (error) {
    g.__poinActive = false;
    throw error;
  }
  const id = rid();
  const run: Run = {
    id,
    status: "running",
    target: url,
    thoughts: [],
    findings: [],
    nodes: [],
    edges: [],
    stats: emptyStats(),
    highlight: null,
    shot: null,
    shotSeq: 0,
    note: UA_NOTE,
    stop: false,
    probe: null,
  };
  runs().set(id, run);
  if (runs().size > 6) {
    const oldest = runs().keys().next().value;
    if (oldest && oldest !== id) runs().delete(oldest);
  }
  void execute(browser, run, url)
    .catch((error: unknown) => {
      run.status = "error";
      run.error = error instanceof Error ? error.message : "Drive failed";
      think(run, "done", run.error);
    })
    .finally(async () => {
      g.__poinActive = false;
      await browser.close().catch(() => undefined);
    });
  return id;
}

function think(run: Run, kind: Thought["kind"], text: string) {
  run.thoughts.push({ id: `${run.thoughts.length}-${kind}`, kind, text });
  if (run.thoughts.length > 80) run.thoughts.splice(0, run.thoughts.length - 80);
}

function addFinding(run: Run, finding: Finding) {
  if (run.findings.some((f) => f.id === finding.id)) return;
  run.findings.push(finding);
  const node = run.nodes[run.nodes.length - 1];
  if (node && finding.severity !== "note") node.bugs += 1;
}

async function shoot(
  page: import("playwright").Page,
  run: Run,
  highlight: Highlight,
) {
  const buf = await page.screenshot({ type: "jpeg", quality: 40 });
  run.shot = buf.toString("base64");
  run.shotSeq += 1;
  run.highlight = highlight;
}

type Candidate = {
  key: string;
  name: string;
  selector: string;
  kind: "link" | "button" | "input" | "summary" | "other";
  href: string;
  safe: boolean;
  held: boolean;
  box: { x: number; y: number; w: number; h: number } | null;
};

export async function execute(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  run: Run,
  startUrl: string,
) {
  const context = await browser.newContext({
    viewport: { width: DRIVE_FRAME.w, height: DRIVE_FRAME.h },
    userAgent: "Poin/1.0 (permissioned autonomous check)",
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const netFails: string[] = [];
  let apiOk = 0;
  const seenErr = new Set<string>();
  const seenNet = new Set<string>();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 280));
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err.message).slice(0, 280)));
  page.on("dialog", (dialog) => {
    void dialog.dismiss();
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400 && !/favicon|analytics|doubleclick/i.test(res.url())) {
      netFails.push(`${status} ${res.url().slice(0, 160)}`);
    } else if (status >= 200 && status < 400) {
      apiOk += 1;
    }
  });
  await page.route("**/*", async (route) => {
    const reqUrl = route.request().url();
    let protocol = "";
    try {
      protocol = new URL(reqUrl).protocol;
    } catch {
      await route.abort();
      return;
    }
    if (protocol === "data:" || protocol === "blob:") {
      await route.continue();
      return;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      await route.abort();
      return;
    }
    if (route.request().resourceType() === "document" || route.request().isNavigationRequest()) {
      try {
        await assertPublicUrl(reqUrl);
      } catch {
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  think(run, "think", "Opening the document. Mapping controls before any press.");
  const response = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  const headerBag = response?.headers() ?? {};
  await page.waitForTimeout(500);
  const origin = new URL(page.url()).origin;
  const deadline = Date.now() + 42_000;
  const tried = new Map<string, Set<string>>();
  const scanned = new Set<string>();
  let previous = "";
  let lastSig = "";
  const sigNode = new Map<string, string>();
  let steps = 0;
  let slowPresses = 0;
  const seenText: string[] = [];
  const seenNames: string[] = [];
  const maxSteps = 14;

  while (!run.stop && steps < maxSteps && Date.now() < deadline) {
    const signature = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700);
      return `${location.href}|${text}`;
    });
    if (!tried.has(signature)) {
      tried.set(signature, new Set());
      run.stats.states += 1;
      const label = await page.evaluate(() => {
        const h = document.querySelector("h1")?.textContent || document.title || location.pathname;
        return h.replace(/\s+/g, " ").trim().slice(0, 42) || location.pathname;
      });
      const id = `s${run.nodes.length}`;
      sigNode.set(signature, id);
      if (previous) run.edges.push({ from: previous, to: id });
      run.nodes.push({ id, label, tried: 0, total: 0, bugs: 0 });
      seenText.push(signature.split("|").slice(1).join("|").slice(0, 900));
      previous = id;
    } else if (lastSig && lastSig !== signature) {
      run.stats.loopsCut += 1;
      think(run, "think", "Known screen. Will not replay controls already pressed here.");
      const id = sigNode.get(signature);
      if (previous && id && previous !== id) run.edges.push({ from: previous, to: id });
      if (id) previous = id;
    }
    lastSig = signature;

    if (!scanned.has(signature)) {
      scanned.add(signature);
      const issues = await page.evaluate(scanDocument);
      for (const issue of issues) {
        addFinding(run, {
          id: issue.id,
          title: issue.title,
          severity: issue.severity,
          oracle: issue.oracle,
          summary: issue.summary,
          repro: [`Open ${page.url()}`, issue.repro],
          evidence: issue.evidence,
          fix: issue.fix,
          confidence: issue.confidence,
          confirmed: true,
        });
        if (issue.severity !== "note") think(run, "bug", issue.title);
      }
    }

    const candidates = await page.evaluate(collectCandidates);
    const bag = tried.get(signature) ?? new Set<string>();
    tried.set(signature, bag);
    const node = run.nodes[run.nodes.length - 1];
    if (node) {
      node.total = candidates.length;
      node.tried = bag.size;
    }
    run.stats.controls = Math.max(run.stats.controls, candidates.length);
    const next = candidates.find((c) => !bag.has(c.key));
    for (const candidate of candidates) {
      if (candidate.name && seenNames.length < 40 && !seenNames.includes(candidate.name)) seenNames.push(candidate.name);
    }
    if (!next) {
      think(run, "think", "Every safe control on the reached screens has been tried. Stopping.");
      break;
    }
    bag.add(next.key);
    run.stats.tried += 1;

    if (next.held || !next.safe) {
      run.stats.guarded += 1;
      if (next.held && run.findings.filter((f) => f.oracle === "guard").length < 6) {
        think(run, "guard", `Held “${next.name || next.kind}”. Not pressed.`);
        addFinding(run, {
          id: `held-${next.key}`.slice(0, 80),
          title: `Held: ${next.name || "unnamed control"}`,
          severity: "note",
          oracle: "guard",
          summary: "Poin does not pay, delete, subscribe, submit accounts, or leave the host.",
          repro: [`Reach ${page.url()}`, `See “${next.name}”`, "Leave it unpressed"],
          evidence: next.href || next.kind,
          fix: "Exercise this on a staging lane with fake data if it needs a test.",
          confidence: 1,
          confirmed: true,
          element: next.name,
        });
      }
      continue;
    }

    const highlight: Highlight = next.box
      ? { ...next.box, name: next.name || next.kind }
      : null;
    run.highlight = highlight;
    think(run, "act", `Press “${next.name || next.kind}”.`);
    await shoot(page, run, highlight).catch(() => undefined);
    const before = signature;
    const beforeUrl = page.url();
    const errMark = consoleErrors.length;
    const netMark = netFails.length;
    const pressedAt = Date.now();
    try {
      await page.locator(next.selector).first().click({ timeout: 3500 });
      if (Date.now() - pressedAt > 1500) slowPresses += 1;
    } catch {
      addFinding(run, {
        id: `click-fail-${next.key}`.slice(0, 90),
        title: `Could not press “${next.name || "control"}”`,
        severity: "minor",
        oracle: "dead",
        summary: "The control was visible in the map but did not accept a click.",
        repro: [`Open ${beforeUrl}`, `Press “${next.name}”`],
        evidence: next.selector.slice(0, 180),
        fix: "Check that the control is not covered, disabled by overlay, or removed mid-click.",
        confidence: 0.7,
        confirmed: false,
        element: next.name,
      });
      steps += 1;
      run.stats.actions += 1;
      continue;
    }
    await page.waitForTimeout(450);
    if (new URL(page.url()).origin !== origin) {
      think(run, "guard", "Navigation left the host. Returning.");
      run.stats.guarded += 1;
      await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
      continue;
    }
    const after = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700);
      return `${location.href}|${text}`;
    });
    const newErr = consoleErrors.slice(errMark);
    const newNet = netFails.slice(netMark);
    for (const err of newErr) {
      if (seenErr.has(err)) continue;
      seenErr.add(err);
      addFinding(run, {
        id: `console-${steps}-${err.slice(0, 24)}`,
        title: `Exception after “${next.name || "control"}”`,
        severity: "blocker",
        oracle: "console",
        summary: "The press and the exception landed in the same step.",
        repro: [`Open ${beforeUrl}`, `Press “${next.name}”`, err.slice(0, 180)],
        evidence: err,
        fix: "Handle the failure in that interaction. The console text is the root cause clue.",
        confidence: 0.86,
        confirmed: true,
        element: next.name,
      });
      think(run, "bug", `Console: ${err.slice(0, 120)}`);
    }
    for (const net of newNet) {
      if (seenNet.has(net)) continue;
      seenNet.add(net);
      addFinding(run, {
        id: `net-${steps}-${net.slice(0, 20)}`,
        title: `Failed response after “${next.name || "control"}”`,
        severity: "major",
        oracle: "network",
        summary: "A response of 400 or higher arrived in the step that pressed this control.",
        repro: [`Open ${beforeUrl}`, `Press “${next.name}”`, net],
        evidence: net,
        fix: "Repair the endpoint, or stop the client from calling it on this action.",
        confidence: 0.8,
        confirmed: true,
        element: next.name,
      });
      think(run, "bug", `Network: ${net.slice(0, 120)}`);
    }
    if (after === before && newErr.length === 0 && next.kind !== "input") {
      await page.locator(next.selector).first().click({ timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(300);
      const retry = await page.evaluate(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700);
        return `${location.href}|${text}`;
      });
      if (retry === before) {
        addFinding(run, {
          id: `dead-${next.key}`.slice(0, 90),
          title: `Dead press: ${next.name || "control"}`,
          severity: "major",
          oracle: "dead",
          summary: "Pressed twice. URL and visible text did not change, and nothing was thrown.",
          repro: [`Open ${beforeUrl}`, `Press “${next.name}”`, "Press it again"],
          evidence: "No DOM text change across two presses.",
          fix: "Wire the control, or remove it if it is leftover.",
          confidence: 0.84,
          confirmed: true,
          element: next.name,
        });
        think(run, "bug", `Dead press on “${next.name}”.`);
      } else {
        run.stats.flakesSuppressed += 1;
        think(run, "observe", `Flake held back on “${next.name}”. It responded on retry.`);
      }
    } else if (after !== before) {
      think(run, "observe", "Screen changed. Ledger records a new state instead of looping.");
    }
    steps += 1;
    run.stats.actions += 1;
    if (run.stop) break;
  }

  if (run.stop) {
    run.note = "Stopped. Partial dossier kept.";
    think(run, "done", "Stopped by request.");
  } else {
    think(run, "done", "Hunt complete. Scoring smoke through compatibility.");
  }
  try {
    run.probe = await sealDriveProbe(page, run, {
      headers: headerBag,
      httpStatus: response?.status() ?? null,
      apiOk,
      apiFail: netFails.length,
      consoleErrors: consoleErrors.length,
      slowPresses,
      seenText,
      seenNames,
    });
  } catch {
    run.probe = {
      ...emptyProbe(),
      loaded: true,
      httpStatus: response?.status() ?? null,
      title: run.target,
      pageText: seenText.join("\n").slice(0, 6000),
      controlNames: seenNames,
      consoleErrors: consoleErrors.length,
      navigations: Math.max(0, run.stats.states - 1),
      apiOk,
      apiFail: netFails.length,
      slowPresses,
      https: page.url().startsWith("https:"),
      primaryNamed: seenNames.length > 0,
    };
  }
  await shoot(page, run, null).catch(() => undefined);
  run.status = "done";
  run.highlight = null;
  await context.close().catch(() => undefined);
}

function readTiming(): {
  title: string;
  loadMs: number | null;
  dclMs: number | null;
  bytes: number | null;
  slowResources: number;
  mixed: number;
  passwordOnInsecure: boolean;
  insecureFormAction: boolean;
  hasViewportMeta: boolean;
} {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const https = location.protocol === "https:";
  let insecureFormAction = false;
  for (const form of document.querySelectorAll("form")) {
    const action = form.getAttribute("action") || "";
    if (action.startsWith("http://")) insecureFormAction = true;
  }
  return {
    title: document.title || "",
    loadMs: nav ? Math.round(nav.loadEventEnd || nav.duration || 0) : null,
    dclMs: nav ? Math.round(nav.domContentLoadedEventEnd || 0) : null,
    bytes: nav ? nav.transferSize || nav.encodedBodySize || 0 : null,
    slowResources: resources.filter((entry) => entry.duration > 1000).length,
    mixed: https ? resources.filter((entry) => entry.name.startsWith("http://")).length : 0,
    passwordOnInsecure: Boolean(document.querySelector('input[type="password"]')) && !https,
    insecureFormAction,
    hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
  };
}

function readViewport(): { overflow: boolean; overlap: boolean; tiny: number } {
  const doc = document.documentElement;
  const nodes = [...document.querySelectorAll("button, a, [role='button']")].filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  });
  const rects = nodes.map((el) => el.getBoundingClientRect());
  let tiny = 0;
  let overlap = false;
  for (const rect of rects) {
    if (rect.width < 24 || rect.height < 24) tiny += 1;
  }
  for (let i = 0; i < rects.length && !overlap; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const ra = rects[i];
      const rb = rects[j];
      if (!ra || !rb) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) continue;
      const minArea = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (minArea > 0 && (w * h) / minArea > 0.4) overlap = true;
    }
  }
  return { overflow: doc.scrollWidth > doc.clientWidth + 8, overlap, tiny };
}

async function sealDriveProbe(
  page: import("playwright").Page,
  run: Run,
  bag: {
    headers: Record<string, string>;
    httpStatus: number | null;
    apiOk: number;
    apiFail: number;
    consoleErrors: number;
    slowPresses: number;
    seenText: string[];
    seenNames: string[];
  },
): Promise<Probe> {
  const timing = await page.evaluate(readTiming);
  const viewports: Probe["viewports"] = [];
  for (const width of [390, 768, 1120]) {
    await page.setViewportSize({ width, height: 800 });
    const shot = await page.evaluate(readViewport);
    viewports.push({ width, ...shot });
  }
  await page.setViewportSize({ width: DRIVE_FRAME.w, height: DRIVE_FRAME.h });
  const https = page.url().startsWith("https:");
  if (timing.passwordOnInsecure) {
    addFinding(run, {
      id: "password-http",
      title: "Password field is not on HTTPS",
      severity: "blocker",
      oracle: "network",
      summary: "A password can be read on the wire when the document is not HTTPS.",
      repro: [`Open ${page.url()}`, "Find the password field"],
      evidence: page.url(),
      fix: "Serve the page over HTTPS before asking for a password.",
      confidence: 0.95,
      confirmed: true,
    });
  }
  if (timing.insecureFormAction) {
    addFinding(run, {
      id: "form-http",
      title: "A form posts to http",
      severity: "major",
      oracle: "network",
      summary: "The form action is an insecure URL.",
      repro: [`Open ${page.url()}`, "Inspect form actions"],
      evidence: "action starts with http://",
      fix: "Post the form to https.",
      confidence: 0.9,
      confirmed: true,
    });
  }
  const broken = viewports.find((shot) => shot.overflow || shot.overlap);
  if (broken) {
    addFinding(run, {
      id: `viewport-${broken.width}`,
      title: `Layout breaks at ${broken.width}px`,
      severity: "major",
      oracle: "visual",
      summary: "At this Chromium width the page overflows or two controls overlap.",
      repro: [`Open ${page.url()}`, `Set the viewport to ${broken.width}px wide`],
      evidence: [broken.overflow ? "horizontal overflow" : "", broken.overlap ? "overlapping controls" : ""]
        .filter(Boolean)
        .join(", "),
      fix: "Reflow the layout at this width. Poin did not launch Firefox or Safari.",
      confidence: 0.84,
      confirmed: true,
    });
  }
  return {
    loaded: true,
    httpStatus: bag.httpStatus,
    title: timing.title,
    pageText: bag.seenText.join("\n").slice(0, 6000),
    controlNames: bag.seenNames,
    loadMs: timing.loadMs,
    dclMs: timing.dclMs,
    bytes: timing.bytes,
    slowResources: timing.slowResources,
    slowPresses: bag.slowPresses,
    consoleErrors: bag.consoleErrors,
    navigations: Math.max(0, run.stats.states - 1),
    apiOk: bag.apiOk,
    apiFail: bag.apiFail,
    https,
    securityHeaders: SECURITY_HEADERS.map((name) => ({ name, present: Boolean(bag.headers[name]) })),
    mixedContent: timing.mixed,
    passwordOnInsecure: timing.passwordOnInsecure,
    insecureFormAction: timing.insecureFormAction,
    hasViewportMeta: timing.hasViewportMeta,
    viewports,
    primaryNamed: bag.seenNames.some((name) => name.trim().length > 0),
    linksChecked: 0,
    linksFailed: 0,
  };
}

function collectCandidates(): Candidate[] {
  const destructive =
    /\b(delete|remove|destroy|purchase|pay|buy|place order|checkout|confirm payment|unsubscribe|wipe|drop|sign out|log out|logout|deactivate|subscribe|register|sign up)\b/i;
  const riskyPath = /logout|signout|sign-out|delete|checkout|payment|subscribe/i;
  const origin = location.origin;

  function accName(el: Element): string {
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const id = el.id;
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab?.textContent?.trim()) return lab.textContent.trim();
      }
      return (el.getAttribute("placeholder") || el.getAttribute("name") || "").trim();
    }
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function pathOf(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let sel = cur.tagName.toLowerCase();
      const parent: HTMLElement | null = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === cur?.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(sel);
      cur = parent;
    }
    return parts.join(" > ");
  }

  const nodes = [...document.querySelectorAll("a, button, summary, input, textarea, [role='button']")];
  const out: Candidate[] = [];
  const seen = new Map<string, number>();
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (el instanceof HTMLInputElement) {
      const t = el.type;
      if (["hidden", "password", "file", "submit", "reset"].includes(t)) continue;
    }
    const name = accName(el);
    const tag = el.tagName.toLowerCase();
    const base = `${tag}|${name}`;
    const index = seen.get(base) ?? 0;
    seen.set(base, index + 1);
    const href = el instanceof HTMLAnchorElement ? el.href : "";
    const typeAttr = (el.getAttribute("type") || "").toLowerCase();
    const inForm = Boolean(el.closest("form"));
    const submits =
      typeAttr === "submit" || (tag === "button" && inForm && typeAttr !== "button");
    let held = destructive.test(name) || submits;
    let safe = false;
    const kind: Candidate["kind"] =
      tag === "a"
        ? "link"
        : tag === "button" || el.getAttribute("role") === "button"
          ? "button"
          : tag === "summary"
            ? "summary"
            : tag === "input" || tag === "textarea"
              ? "input"
              : "other";
    if (kind === "input") {
      held = true;
    } else if (kind === "link") {
      if (!href || href.toLowerCase().startsWith("javascript:")) held = true;
      else {
        try {
          const u = new URL(href, location.href);
          if (u.origin !== origin || riskyPath.test(u.pathname)) held = true;
          else safe = !held;
        } catch {
          held = true;
        }
      }
    } else if (!held) {
      safe = true;
    }
    if (held) safe = false;
    if (kind === "input") continue;
    const box =
      rect.bottom > 0 && rect.top < window.innerHeight
        ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.width, h: rect.height }
        : null;
    out.push({
      key: `${base}|${index}`,
      name,
      selector: pathOf(el),
      kind,
      href,
      safe,
      held,
      box,
    });
    if (out.length >= 40) break;
  }
  return out;
}

type ScanIssue = {
  id: string;
  title: string;
  severity: Finding["severity"];
  oracle: Finding["oracle"];
  summary: string;
  repro: string;
  evidence: string;
  fix: string;
  confidence: number;
};

function scanDocument(): ScanIssue[] {
  const issues: ScanIssue[] = [];
  const imgs = [...document.querySelectorAll("img")].filter((img) => !img.hasAttribute("alt")).slice(0, 5);
  if (imgs.length) {
    issues.push({
      id: `alt-${location.pathname}`,
      title: `${imgs.length} image${imgs.length === 1 ? "" : "s"} with no alt on this screen`,
      severity: "major",
      oracle: "a11y",
      summary: "Missing alt is not the same as decorative empty alt.",
      repro: "Inspect images on this screen",
      evidence: imgs.map((img) => img.getAttribute("src")?.slice(0, 60) || "(no src)").join(" · "),
      fix: "Add alt, or alt=\"\" when the image carries no information.",
      confidence: 0.93,
    });
  }
  const unnamed = [...document.querySelectorAll("button, a, [role='button']")].filter((el) => {
    const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
    return name.length === 0;
  });
  if (unnamed.length) {
    issues.push({
      id: `name-${location.pathname}`,
      title: `${unnamed.length} unnamed control${unnamed.length === 1 ? "" : "s"} on this screen`,
      severity: "major",
      oracle: "a11y",
      summary: "A control without an accessible name cannot be operated predictably.",
      repro: "Tab the unnamed controls",
      evidence: unnamed
        .slice(0, 5)
        .map((el) => el.tagName.toLowerCase())
        .join(", "),
      fix: "Add visible text or aria-label.",
      confidence: 0.88,
    });
  }
  const labels = new Set(
    [...document.querySelectorAll("label")]
      .map((l) => l.getAttribute("for"))
      .filter((v): v is string => Boolean(v)),
  );
  const unlabeled = [...document.querySelectorAll("input, textarea, select")].filter((el) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return false;
    }
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "reset"].includes(el.type)) return false;
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
    if (el.closest("label")) return false;
    if (el.id && labels.has(el.id)) return false;
    return true;
  });
  if (unlabeled.length) {
    issues.push({
      id: `label-${location.pathname}`,
      title: `${unlabeled.length} unlabeled field${unlabeled.length === 1 ? "" : "s"} on this screen`,
      severity: "major",
      oracle: "a11y",
      summary: "Placeholder is not a label.",
      repro: "Inspect fields with no label",
      evidence: unlabeled
        .slice(0, 5)
        .map((el) => (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase()))
        .join(", "),
      fix: "Associate a label or aria-label.",
      confidence: 0.9,
    });
  }
  const overflow = [...document.querySelectorAll("h1,h2,h3,p,a,button,span")].find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (text.length < 24) return false;
    return el.scrollWidth > el.clientWidth + 16 && el.clientHeight < 90 && el.clientWidth > 40;
  });
  if (overflow instanceof HTMLElement) {
    issues.push({
      id: `overflow-${location.pathname}`,
      title: "Text overflows its box",
      severity: "minor",
      oracle: "visual",
      summary: "A line is wider than the box that holds it.",
      repro: "Look at the clipped line on this screen",
      evidence: (overflow.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      fix: "Allow wrap, or give the line a wider track.",
      confidence: 0.74,
    });
  }
  if (/page not found|404/i.test(document.body?.innerText || "") && document.title.toLowerCase().includes("404")) {
    issues.push({
      id: `404-${location.pathname}`,
      title: "Screen is a not-found page",
      severity: "major",
      oracle: "network",
      summary: "The hunter reached a document that calls itself missing.",
      repro: `Open ${location.href}`,
      evidence: document.title,
      fix: "Restore the document or remove the link that points here.",
      confidence: 0.7,
    });
  }
  return issues.slice(0, 8);
}
