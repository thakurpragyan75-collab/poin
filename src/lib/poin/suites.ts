import type { Finding, RunStats, SpecimenId } from "@/lib/poin/types";

export type SuiteId =
  | "smoke"
  | "sanity"
  | "integration"
  | "system"
  | "regression"
  | "uat"
  | "performance"
  | "security"
  | "usability"
  | "compatibility";

export type SuiteStatus = "pass" | "fail" | "partial";

export type SuiteGroup = "functional" | "nonfunctional";

export type BaselineDiff = {
  added: string[];
  gone: string[];
  still: string[];
  hadBaseline: boolean;
};

export type Check = {
  criterion: string;
  met: boolean;
  evidence: string;
};

export type ViewportShot = {
  width: number;
  overflow: boolean;
  overlap: boolean;
  tiny: number;
};

export type SecurityHeader = {
  name: string;
  present: boolean;
};

export type Probe = {
  loaded: boolean;
  httpStatus: number | null;
  title: string;
  pageText: string;
  controlNames: string[];
  loadMs: number | null;
  dclMs: number | null;
  bytes: number | null;
  slowResources: number;
  slowPresses: number;
  consoleErrors: number;
  navigations: number;
  apiOk: number;
  apiFail: number;
  https: boolean | null;
  securityHeaders: SecurityHeader[];
  mixedContent: number;
  passwordOnInsecure: boolean;
  insecureFormAction: boolean;
  hasViewportMeta: boolean | null;
  viewports: ViewportShot[];
  primaryNamed: boolean;
  linksChecked: number;
  linksFailed: number;
};

export type SuiteResult = {
  id: SuiteId;
  group: SuiteGroup;
  label: string;
  status: SuiteStatus;
  summary: string;
  evidence: string[];
};

export const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
];

export function emptyProbe(): Probe {
  return {
    loaded: false,
    httpStatus: null,
    title: "",
    pageText: "",
    controlNames: [],
    loadMs: null,
    dclMs: null,
    bytes: null,
    slowResources: 0,
    slowPresses: 0,
    consoleErrors: 0,
    navigations: 0,
    apiOk: 0,
    apiFail: 0,
    https: null,
    securityHeaders: [],
    mixedContent: 0,
    passwordOnInsecure: false,
    insecureFormAction: false,
    hasViewportMeta: null,
    viewports: [],
    primaryNamed: false,
    linksChecked: 0,
    linksFailed: 0,
  };
}

const DEFECTS = new Set<Finding["severity"]>(["blocker", "major", "minor"]);

function defects(findings: Finding[]): Finding[] {
  return findings.filter((f) => DEFECTS.has(f.severity) && f.oracle !== "guard");
}

function titles(list: Finding[]): string[] {
  return list.map((f) => f.title);
}

export function acceptanceChecks(input: {
  criteria: string;
  specimenId: SpecimenId | null;
  probe: Probe;
  findings: Finding[];
}): { source: "user" | "specimen" | "inferred"; checks: Check[] } {
  const lines = input.criteria
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (lines.length) {
    return { source: "user", checks: lines.map((line) => checkLine(line, input.probe, input.findings)) };
  }
  if (input.specimenId === "harbor") {
    return {
      source: "specimen",
      checks: [
        checkLine("see: Wool field coat", input.probe, input.findings),
        checkLine("control: Add to cart", input.probe, input.findings),
        checkLine("clean", input.probe, input.findings),
      ],
    };
  }
  if (input.specimenId === "northstar") {
    return {
      source: "specimen",
      checks: [
        checkLine("see: Northstar", input.probe, input.findings),
        checkLine("control: Export", input.probe, input.findings),
        checkLine("clean", input.probe, input.findings),
      ],
    };
  }
  if (input.specimenId === "lumen") {
    return {
      source: "specimen",
      checks: [
        checkLine("see: Overview", input.probe, input.findings),
        checkLine("control: Copy", input.probe, input.findings),
        checkLine("clean", input.probe, input.findings),
      ],
    };
  }
  const heading = input.probe.title || "a heading";
  return {
    source: "inferred",
    checks: [
      {
        criterion: "The document has a title or heading",
        met: Boolean(input.probe.title.trim()) || /<h1|heading/i.test(input.probe.pageText) || input.probe.pageText.trim().length > 40,
        evidence: input.probe.title ? `Title: ${input.probe.title}` : "No title was recorded.",
      },
      {
        criterion: "A primary control has an accessible name",
        met: input.probe.primaryNamed,
        evidence: input.probe.primaryNamed
          ? `Named controls include ${input.probe.controlNames.slice(0, 3).join(", ") || heading}`
          : "No named button, link, or field was recorded.",
      },
      checkLine("clean", input.probe, input.findings),
    ],
  };
}

function checkLine(line: string, probe: Probe, findings: Finding[]): Check {
  const lower = line.toLowerCase();
  if (lower === "clean" || lower.startsWith("clean:")) {
    const bad = defects(findings).filter((f) => f.severity === "blocker" || f.severity === "major");
    return {
      criterion: "No blocker or major defect on the walked path",
      met: bad.length === 0,
      evidence: bad.length ? bad.map((f) => f.title).slice(0, 4).join(" · ") : "No blocker or major defect.",
    };
  }
  if (lower.startsWith("see:")) {
    const phrase = line.slice(4).trim();
    const met = probe.pageText.toLowerCase().includes(phrase.toLowerCase());
    return {
      criterion: `Visible text includes “${phrase}”`,
      met,
      evidence: met ? `Found “${phrase}”.` : `“${phrase}” was not in the text Poin saw.`,
    };
  }
  if (lower.startsWith("control:")) {
    const phrase = line.slice(8).trim().toLowerCase();
    const hit = probe.controlNames.find((name) => name.toLowerCase().includes(phrase));
    return {
      criterion: `A control named “${line.slice(8).trim()}” exists`,
      met: Boolean(hit),
      evidence: hit ? `Matched “${hit}”.` : "No control name contained that text.",
    };
  }
  const met = probe.pageText.toLowerCase().includes(lower);
  return {
    criterion: line,
    met,
    evidence: met ? "The line appears in the text Poin saw." : "That line was not in the text Poin saw.",
  };
}

function suite(
  id: SuiteId,
  group: SuiteGroup,
  label: string,
  status: SuiteStatus,
  summary: string,
  evidence: string[],
): SuiteResult {
  return { id, group, label, status, summary, evidence: evidence.filter(Boolean).slice(0, 6) };
}

export function buildReport(input: {
  findings: Finding[];
  stats: RunStats;
  diff: BaselineDiff | null;
  probe: Probe | null;
  criteria: string;
  specimenId: SpecimenId | null;
  engine: "lab" | "drive" | "recon";
}): SuiteResult[] {
  const probe = input.probe ?? emptyProbe();
  const bugs = defects(input.findings);
  const blockers = bugs.filter((f) => f.severity === "blocker");
  const majors = bugs.filter((f) => f.severity === "major");
  const minors = bugs.filter((f) => f.severity === "minor");
  const acceptance = acceptanceChecks({
    criteria: input.criteria,
    specimenId: input.specimenId,
    probe,
    findings: input.findings,
  });

  const smokeFail = !probe.loaded || (probe.httpStatus !== null && probe.httpStatus >= 400);
  const smoke: SuiteResult = smokeFail
    ? suite(
        "smoke",
        "functional",
        "Smoke",
        "fail",
        "The build did not come up cleanly enough for a deeper pass.",
        [
          probe.loaded ? "Document was reached." : "No document was confirmed.",
          probe.httpStatus !== null ? `HTTP ${probe.httpStatus}.` : "",
          probe.consoleErrors ? `${probe.consoleErrors} console error${probe.consoleErrors === 1 ? "" : "s"} during the hunt.` : "",
        ],
      )
    : suite(
        "smoke",
        "functional",
        "Smoke",
        probe.consoleErrors > 0 ? "fail" : "pass",
        probe.consoleErrors > 0
          ? "The page opened, then a script error landed. That fails the smoke bar."
          : "The page opened, had a name, and did not throw while coming up.",
        [
          probe.title ? `Title: ${probe.title}` : "No document title.",
          probe.httpStatus !== null ? `HTTP ${probe.httpStatus}.` : input.engine === "lab" ? "In-app specimen. No separate HTTP status." : "",
          probe.primaryNamed ? "At least one control has a name." : "No named control on the first look.",
        ],
      );

  let sanityStatus: SuiteStatus = "partial";
  let sanitySummary = "Too little was exercised to call the core path sane.";
  if (blockers.length) {
    sanityStatus = "fail";
    sanitySummary = "A blocker landed on a path Poin actually walked.";
  } else if (input.stats.actions > 0 || input.engine === "recon") {
    sanityStatus = majors.length ? "fail" : "pass";
    sanitySummary =
      sanityStatus === "fail"
        ? "The narrow path still has a major break."
        : "After the walk, the reached screens still responded without a blocker.";
  }
  const sanity = suite("sanity", "functional", "Sanity", sanityStatus, sanitySummary, [
    `${input.stats.actions} presses, ${input.stats.states} screens.`,
    ...titles(majors).slice(0, 3),
  ]);

  let integration: SuiteResult;
  if (input.engine === "recon") {
    integration =
      probe.linksFailed > 0
        ? suite(
            "integration",
            "functional",
            "Integration",
            "fail",
            "Same-host links from the landing page do not all resolve.",
            [`${probe.linksFailed} of ${probe.linksChecked} checked links failed.`],
          )
        : probe.linksChecked === 0
          ? suite(
              "integration",
              "functional",
              "Integration",
              "partial",
              "No same-host link was available to prove modules connect.",
              ["Surface recon does not press controls, so in-page handoffs were not observed."],
            )
          : suite(
              "integration",
              "functional",
              "Integration",
              "pass",
              "Checked same-host links returned successfully. Controls themselves were not pressed.",
              [`${probe.linksChecked} links checked, none failed.`],
            );
  } else if (probe.apiFail > 0) {
    integration = suite(
      "integration",
      "functional",
      "Integration",
      "fail",
      "A control and a failing response landed in the same hunt. The seam between UI and server is broken.",
      [`${probe.apiFail} failed response${probe.apiFail === 1 ? "" : "s"}.`, `${probe.apiOk} responses under 400.`, `${probe.navigations} screen changes.`],
    );
  } else if (probe.navigations === 0 && probe.apiOk === 0) {
    integration = suite(
      "integration",
      "functional",
      "Integration",
      "partial",
      "Only one screen was reached and no successful request crossed a boundary.",
      ["Nothing here proves two modules work together."],
    );
  } else {
    integration = suite(
      "integration",
      "functional",
      "Integration",
      "pass",
      "Screens or requests connected without a failed response on the walked path.",
      [`${probe.navigations} screen changes.`, `${probe.apiOk} responses under 400.`, `${probe.apiFail} failed.`],
    );
  }

  let systemStatus: SuiteStatus = "pass";
  let systemSummary = "The walked system has no recorded defect. Held actions were not part of this pass.";
  if (blockers.length || majors.length) {
    systemStatus = "fail";
    systemSummary = "System testing failed. A blocker or major defect is still open on the integrated path.";
  } else if (minors.length || input.stats.states < 2) {
    systemStatus = "partial";
    systemSummary = minors.length
      ? "No blocker or major, but minor defects remain. This is not a clean system pass."
      : "Coverage is a single screen. The whole application was not exercised.";
  }
  const system = suite("system", "functional", "System", systemStatus, systemSummary, [
    `${input.stats.states} screens, ${bugs.length} defects.`,
    ...titles(bugs).slice(0, 4),
  ]);

  const diff = input.diff;
  const regression = !diff || !diff.hadBaseline
    ? suite(
        "regression",
        "functional",
        "Regression",
        "partial",
        "First hunt on this target. It is sealed as the baseline, not scored as a regression.",
        [`${bugs.length} defects saved for the next comparison.`],
      )
    : diff.added.length
      ? suite(
          "regression",
          "functional",
          "Regression",
          "fail",
          "This hunt has defects that were not in the previous baseline.",
          [
            `New: ${diff.added.slice(0, 4).join(" · ")}`,
            diff.still.length ? `Still open: ${diff.still.slice(0, 3).join(" · ")}` : "",
            diff.gone.length ? `Gone: ${diff.gone.slice(0, 3).join(" · ")}` : "",
          ],
        )
      : suite(
          "regression",
          "functional",
          "Regression",
          "pass",
          "No new defect titles since the last hunt of this target.",
          [
            diff.still.length ? `Still open: ${diff.still.slice(0, 4).join(" · ")}` : "Nothing still open.",
            diff.gone.length ? `Gone: ${diff.gone.slice(0, 3).join(" · ")}` : "",
          ],
        );

  const unmet = acceptance.checks.filter((c) => !c.met);
  const sourceLine =
    acceptance.source === "user"
      ? "Scored against the acceptance lines you wrote."
      : acceptance.source === "specimen"
        ? "Scored against this specimen's acceptance script."
        : "No acceptance script was supplied, so Poin inferred three checks. That is not a signed UAT.";
  const uat = suite(
    "uat",
    "functional",
    "User acceptance",
    unmet.length ? "fail" : acceptance.source === "inferred" ? "partial" : "pass",
    unmet.length ? `${unmet.length} acceptance check${unmet.length === 1 ? "" : "s"} failed. ${sourceLine}` : `Acceptance checks passed. ${sourceLine}`,
    acceptance.checks.map((c) => `${c.met ? "Met" : "Miss"}: ${c.criterion}. ${c.evidence}`),
  );

  let performance: SuiteResult;
  const loadNote = "Load was not run. Poin does not open concurrent sessions against a host.";
  if (probe.loadMs === null) {
    performance = suite(
      "performance",
      "nonfunctional",
      "Performance and load",
      probe.slowPresses > 0 ? "fail" : "partial",
      probe.slowPresses > 0
        ? `${probe.slowPresses} press${probe.slowPresses === 1 ? "" : "es"} took over half a second in the page. ${loadNote}`
        : `No separate document timing applies to this run. ${loadNote}`,
      [
        input.engine === "lab" ? "Specimen runs inside Poin, so navigation timing would measure Poin itself." : "Document timing was not captured.",
        `${probe.slowPresses} slow presses.`,
      ],
    );
  } else if (probe.loadMs >= 4000 || probe.slowResources >= 8) {
    performance = suite(
      "performance",
      "nonfunctional",
      "Performance and load",
      "fail",
      `Single-user load was ${probe.loadMs} ms. ${loadNote}`,
      [
        probe.dclMs !== null ? `DOM content loaded ${probe.dclMs} ms.` : "",
        probe.bytes !== null ? `${probe.bytes.toLocaleString()} bytes on the document.` : "",
        `${probe.slowResources} resources slower than 1s.`,
      ],
    );
  } else if (probe.loadMs >= 1800 || probe.slowResources > 0 || probe.slowPresses > 0) {
    performance = suite(
      "performance",
      "nonfunctional",
      "Performance and load",
      "partial",
      `Single-user timing is ${probe.loadMs} ms, with some slow pieces. ${loadNote}`,
      [`${probe.slowResources} resources slower than 1s.`, `${probe.slowPresses} slow presses.`],
    );
  } else {
    performance = suite(
      "performance",
      "nonfunctional",
      "Performance and load",
      "partial",
      `Single-user timing passed at ${probe.loadMs} ms. ${loadNote}`,
      [
        probe.dclMs !== null ? `DOM content loaded ${probe.dclMs} ms.` : "",
        probe.bytes !== null ? `${probe.bytes.toLocaleString()} bytes.` : "",
      ],
    );
  }

  const missingHeaders = probe.securityHeaders.filter((h) => !h.present).map((h) => h.name);
  let security: SuiteResult;
  if (input.engine === "lab" || probe.https === null) {
    security = suite(
      "security",
      "nonfunctional",
      "Security",
      "partial",
      "Passive transport checks do not apply to an in-app specimen. Poin does not send attack payloads.",
      ["No HTTPS, cookie, or header verdict. Auth and payment were not attacked."],
    );
  } else if (!probe.https || probe.passwordOnInsecure || probe.insecureFormAction || probe.mixedContent > 0) {
    security = suite(
      "security",
      "nonfunctional",
      "Security",
      "fail",
      "A passive check found data exposed on an insecure transport. No exploit was attempted.",
      [
        probe.https ? "HTTPS is on." : "The document is not HTTPS.",
        probe.passwordOnInsecure ? "A password field is served without HTTPS." : "",
        probe.insecureFormAction ? "A form posts to http." : "",
        probe.mixedContent ? `${probe.mixedContent} http resource${probe.mixedContent === 1 ? "" : "s"} on an https page.` : "",
      ],
    );
  } else if (missingHeaders.length) {
    security = suite(
      "security",
      "nonfunctional",
      "Security",
      "partial",
      "HTTPS is on. Recommended response headers are missing. This is not a penetration test.",
      [`Missing: ${missingHeaders.join(", ")}.`, `Present: ${probe.securityHeaders.filter((h) => h.present).map((h) => h.name).join(", ") || "none"}.`],
    );
  } else {
    security = suite(
      "security",
      "nonfunctional",
      "Security",
      "pass",
      "HTTPS is on and the checked response headers are present. This is not a penetration test.",
      probe.securityHeaders.map((h) => `${h.name}: present`),
    );
  }

  const usabilityFindings = bugs.filter((f) => f.oracle === "a11y" || f.oracle === "dead" || f.oracle === "visual");
  const tiny = probe.viewports.reduce((sum, v) => sum + v.tiny, 0);
  const usability =
    usabilityFindings.some((f) => f.severity === "blocker" || f.severity === "major")
      ? suite(
          "usability",
          "nonfunctional",
          "Usability",
          "fail",
          "A person cannot reliably see, name, or activate something Poin reached.",
          titles(usabilityFindings),
        )
      : usabilityFindings.length || tiny > 0
        ? suite(
            "usability",
            "nonfunctional",
            "Usability",
            "partial",
            "The path is usable with friction: minor layout, naming, or small targets.",
            [...titles(usabilityFindings), tiny ? `${tiny} targets under 24px across the viewport checks.` : ""],
          )
        : suite(
            "usability",
            "nonfunctional",
            "Usability",
            "pass",
            "No naming, contrast, dead-control, or layout defect was recorded on the walked path.",
            ["Labels, contrast, dead presses, overflow, and overlap were checked."],
          );

  const badViews = probe.viewports.filter((v) => v.overflow || v.overlap);
  let compatibility: SuiteResult;
  if (probe.viewports.length === 0) {
    const missingMeta = probe.hasViewportMeta === false;
    compatibility = suite(
      "compatibility",
      "nonfunctional",
      "Compatibility",
      missingMeta ? "fail" : "partial",
      missingMeta
        ? "No viewport meta, and surface recon cannot lay the page out. Phones will scale a desktop page."
        : "Layout was not measured in a browser. Surface recon only sees markup.",
      [
        probe.hasViewportMeta === true ? "Viewport meta is present." : probe.hasViewportMeta === false ? "Viewport meta is absent." : "",
        "Firefox and Safari were not launched. A live drive measures Chromium at 390, 768, and 1120.",
      ],
    );
  } else if (badViews.length) {
    compatibility = suite(
      "compatibility",
      "nonfunctional",
      "Compatibility",
      "fail",
      "The layout breaks in at least one Chromium width. Other browser engines were not launched.",
      badViews.map(
        (v) =>
          `${v.width}px: ${[v.overflow ? "horizontal overflow" : "", v.overlap ? "overlapping controls" : "", v.tiny ? `${v.tiny} tiny targets` : ""].filter(Boolean).join(", ")}`,
      ),
    );
  } else {
    compatibility = suite(
      "compatibility",
      "nonfunctional",
      "Compatibility",
      "pass",
      "No overflow or overlap at 390, 768, and 1120 in Chromium. Firefox and Safari were not launched.",
      probe.viewports.map((v) => `${v.width}px clean${v.tiny ? `, ${v.tiny} tiny targets` : ""}.`),
    );
  }

  return [smoke, sanity, integration, system, regression, uat, performance, security, usability, compatibility];
}
