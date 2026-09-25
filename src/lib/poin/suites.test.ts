import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, emptyProbe, type Probe } from "./suites.ts";
import { emptyStats, type Finding } from "./types.ts";

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "title" | "severity" | "oracle">): Finding {
  return {
    summary: partial.title,
    repro: ["Open the page"],
    evidence: "observed",
    fix: "Fix it",
    confidence: 0.9,
    confirmed: true,
    ...partial,
  };
}

function baseProbe(over: Partial<Probe> = {}): Probe {
  return {
    ...emptyProbe(),
    loaded: true,
    httpStatus: 200,
    title: "Northline",
    pageText: "Northline ships coats. Add to cart.",
    controlNames: ["Add to cart", "Search"],
    loadMs: 640,
    dclMs: 400,
    bytes: 12000,
    https: true,
    securityHeaders: [
      { name: "strict-transport-security", present: true },
      { name: "content-security-policy", present: true },
      { name: "x-content-type-options", present: true },
      { name: "x-frame-options", present: true },
      { name: "referrer-policy", present: true },
    ],
    hasViewportMeta: true,
    primaryNamed: true,
    navigations: 2,
    apiOk: 3,
    viewports: [
      { width: 390, overflow: false, overlap: false, tiny: 0 },
      { width: 768, overflow: false, overlap: false, tiny: 0 },
      { width: 1120, overflow: false, overlap: false, tiny: 0 },
    ],
    ...over,
  };
}

function byId(report: ReturnType<typeof buildReport>, id: string) {
  const suite = report.find((item) => item.id === id);
  assert.ok(suite, id);
  return suite;
}

test("clean drive passes functional checks and holds load", () => {
  const report = buildReport({
    findings: [],
    stats: { ...emptyStats(), actions: 4, states: 3 },
    diff: { added: [], gone: [], still: [], hadBaseline: true },
    probe: baseProbe(),
    criteria: "see: Northline\ncontrol: Add to cart\nclean",
    specimenId: null,
    engine: "drive",
  });
  assert.equal(byId(report, "smoke").status, "pass");
  assert.equal(byId(report, "sanity").status, "pass");
  assert.equal(byId(report, "integration").status, "pass");
  assert.equal(byId(report, "system").status, "pass");
  assert.equal(byId(report, "regression").status, "pass");
  assert.equal(byId(report, "uat").status, "pass");
  assert.equal(byId(report, "security").status, "pass");
  assert.equal(byId(report, "usability").status, "pass");
  assert.equal(byId(report, "compatibility").status, "pass");
  assert.equal(byId(report, "performance").status, "partial");
  assert.match(byId(report, "performance").summary, /Load was not run/);
});

test("blockers fail smoke, system, and acceptance", () => {
  const report = buildReport({
    findings: [finding({ id: "c", title: "Tax throws", severity: "blocker", oracle: "console" })],
    stats: { ...emptyStats(), actions: 2, states: 2 },
    diff: { added: ["Tax throws"], gone: [], still: [], hadBaseline: true },
    probe: baseProbe({ consoleErrors: 1, pageText: "Wool field coat" }),
    criteria: "",
    specimenId: "harbor",
    engine: "lab",
  });
  assert.equal(byId(report, "smoke").status, "fail");
  assert.equal(byId(report, "system").status, "fail");
  assert.equal(byId(report, "regression").status, "fail");
  assert.equal(byId(report, "uat").status, "fail");
  assert.match(byId(report, "uat").evidence.join(" "), /Wool field coat/);
});

test("insecure password fails security without pretending to be a pentest", () => {
  const report = buildReport({
    findings: [],
    stats: { ...emptyStats(), actions: 1, states: 1 },
    diff: { added: [], gone: [], still: [], hadBaseline: false },
    probe: baseProbe({ https: false, passwordOnInsecure: true, navigations: 0, apiOk: 0 }),
    criteria: "",
    specimenId: null,
    engine: "recon",
  });
  assert.equal(byId(report, "security").status, "fail");
  assert.match(byId(report, "security").summary, /No exploit/);
  assert.equal(byId(report, "regression").status, "partial");
});

test("overflow at a phone width fails compatibility", () => {
  const report = buildReport({
    findings: [],
    stats: { ...emptyStats(), actions: 3, states: 2 },
    diff: null,
    probe: baseProbe({
      viewports: [
        { width: 390, overflow: true, overlap: false, tiny: 2 },
        { width: 768, overflow: false, overlap: false, tiny: 0 },
        { width: 1120, overflow: false, overlap: false, tiny: 0 },
      ],
    }),
    criteria: "",
    specimenId: null,
    engine: "drive",
  });
  assert.equal(byId(report, "compatibility").status, "fail");
  assert.match(byId(report, "compatibility").evidence[0] ?? "", /390px/);
  assert.match(byId(report, "compatibility").summary, /Other browser engines were not launched/);
});
