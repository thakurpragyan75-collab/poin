export type Severity = "blocker" | "major" | "minor" | "note";

export type OracleId = "console" | "network" | "a11y" | "visual" | "dead" | "guard";

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  oracle: OracleId;
  summary: string;
  repro: string[];
  evidence: string;
  fix: string;
  confidence: number;
  confirmed: boolean;
  element?: string;
};

export type Thought = {
  id: string;
  kind: "think" | "act" | "observe" | "bug" | "guard" | "done";
  text: string;
};

export type GraphNode = {
  id: string;
  label: string;
  tried: number;
  total: number;
  bugs: number;
};

export type GraphEdge = { from: string; to: string };

export type Highlight = {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
} | null;

export type RunStats = {
  actions: number;
  states: number;
  controls: number;
  tried: number;
  guarded: number;
  flakesSuppressed: number;
  loopsCut: number;
};

export type SpecimenId = "harbor" | "northstar" | "lumen";

export const DRIVE_FRAME = { w: 1120, h: 700 };

export const ORACLES: { id: OracleId; label: string; line: string }[] = [
  { id: "console", label: "Console", line: "Uncaught exceptions, tied to the click" },
  { id: "network", label: "Network", line: "Responses that fail or never return" },
  { id: "a11y", label: "Access", line: "Names, labels, contrast" },
  { id: "visual", label: "Layout", line: "Overflow, overlap, broken frames" },
  { id: "dead", label: "Dead", line: "A press that changes nothing" },
  { id: "guard", label: "Guard", line: "Pay, delete, submit — held" },
];

export type SurfaceControl = {
  kind: "link" | "button" | "input" | "image" | "form";
  name: string;
};

export type SurfaceLink = {
  href: string;
  status: number | null;
  error?: string;
};

export type SurfaceReport = {
  finalUrl: string;
  status: number;
  title: string;
  ms: number;
  bytes: number;
  counts: {
    links: number;
    buttons: number;
    inputs: number;
    images: number;
    forms: number;
  };
  controls: SurfaceControl[];
  links: SurfaceLink[];
  findings: Finding[];
  held: string[];
};

export type DriveView = {
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
};

export function emptyStats(): RunStats {
  return {
    actions: 0,
    states: 0,
    controls: 0,
    tried: 0,
    guarded: 0,
    flakesSuppressed: 0,
    loopsCut: 0,
  };
}

export function severityRank(s: Severity): number {
  if (s === "blocker") return 0;
  if (s === "major") return 1;
  if (s === "minor") return 2;
  return 3;
}
