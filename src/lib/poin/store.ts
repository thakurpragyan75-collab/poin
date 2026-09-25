import { create } from "zustand";
import { buildReport, type Probe, type SuiteResult } from "@/lib/poin/suites";
import {
  emptyStats,
  type DriveView,
  type Finding,
  type GraphEdge,
  type GraphNode,
  type Highlight,
  type RunStats,
  type SpecimenId,
  type SurfaceReport,
  type Thought,
} from "@/lib/poin/types";

export type Screen = "launch" | "running" | "done";
export type Engine = "lab" | "drive" | "recon";

export type Diff = {
  added: string[];
  gone: string[];
  still: string[];
  hadBaseline: boolean;
};

type PoinState = {
  screen: Screen;
  engine: Engine;
  specimenId: SpecimenId | null;
  runToken: number;
  targetLabel: string;
  targetKey: string;
  targetUrl: string;
  note: string;
  error: string;
  thoughts: Thought[];
  findings: Finding[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: RunStats;
  highlight: Highlight;
  highlightSpace: "lab" | "drive";
  shot: string | null;
  shotSeq: number;
  huntId: string | null;
  surface: SurfaceReport | null;
  brief: string;
  briefState: "idle" | "loading" | "done" | "error";
  diff: Diff | null;
  probe: Probe | null;
  criteria: string;
  report: SuiteResult[];
  stopRequested: boolean;
  goLaunch: () => void;
  beginLab: (id: SpecimenId, criteria: string) => void;
  beginRemote: (url: string, criteria: string) => void;
  attachDrive: (id: string) => void;
  setSurface: (report: SurfaceReport) => void;
  applyDrive: (view: DriveView) => void;
  markRecon: (url: string) => void;
  appendThought: (kind: Thought["kind"], text: string) => void;
  addFinding: (finding: Finding) => void;
  setGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  patchStats: (partial: Partial<RunStats>) => void;
  setHighlight: (highlight: Highlight, space: "lab" | "drive") => void;
  setProbe: (probe: Probe) => void;
  setShot: (shot: string | null, seq: number) => void;
  setNote: (note: string) => void;
  requestStop: () => void;
  finish: () => void;
  fail: (message: string) => void;
  setBriefState: (briefState: PoinState["briefState"], brief?: string) => void;
};

const LEDGER_KEY = "poin-ledger-v1";

function baseline(key: string, titles: string[]): Diff {
  if (typeof window === "undefined") {
    return { added: titles, gone: [], still: [], hadBaseline: false };
  }
  let all: Record<string, string[]> = {};
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (raw) all = JSON.parse(raw) as Record<string, string[]>;
  } catch {
    all = {};
  }
  const prev = all[key] ?? [];
  const prevSet = new Set(prev);
  const nextSet = new Set(titles);
  const diff: Diff = {
    added: titles.filter((t) => !prevSet.has(t)),
    gone: prev.filter((t) => !nextSet.has(t)),
    still: titles.filter((t) => prevSet.has(t)),
    hadBaseline: key in all,
  };
  all[key] = titles;
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(all));
  return diff;
}

const fresh = {
  screen: "launch" as const,
  engine: "lab" as const,
  specimenId: null,
  targetLabel: "",
  targetKey: "",
  targetUrl: "",
  note: "",
  error: "",
  thoughts: [] as Thought[],
  findings: [] as Finding[],
  nodes: [] as GraphNode[],
  edges: [] as GraphEdge[],
  stats: emptyStats(),
  highlight: null as Highlight,
  highlightSpace: "lab" as const,
  shot: null as string | null,
  shotSeq: 0,
  huntId: null as string | null,
  surface: null as SurfaceReport | null,
  brief: "",
  briefState: "idle" as const,
  diff: null as Diff | null,
  probe: null as Probe | null,
  criteria: "",
  report: [] as SuiteResult[],
  stopRequested: false,
};

export const usePoin = create<PoinState>((set, get) => ({
  ...fresh,
  runToken: 0,
  goLaunch: () => set({ ...fresh, runToken: get().runToken, stopRequested: true }),
  beginLab: (id, criteria) =>
    set({
      ...fresh,
      screen: "running",
      engine: "lab",
      specimenId: id,
      runToken: get().runToken + 1,
      targetLabel: id === "harbor" ? "Harbor" : id === "northstar" ? "Northstar" : "Lumen",
      targetKey: `lab:${id}`,
      targetUrl: `specimen://${id}`,
      criteria,
      note: "Live lab. Poin is driving this page for real — in this window, not a recording.",
      stopRequested: false,
    }),
  beginRemote: (url, criteria) =>
    set({
      ...fresh,
      screen: "running",
      engine: "drive",
      runToken: get().runToken + 1,
      targetLabel: url.replace(/^https?:\/\//, "").slice(0, 64),
      targetKey: `url:${url}`,
      targetUrl: url,
      criteria,
      note: "Opening a browser. Same host only. Destructive controls stay held.",
      stopRequested: false,
    }),
  attachDrive: (id) => set({ huntId: id, engine: "drive" }),
  setSurface: (report) =>
    set({
      surface: report,
      engine: "recon",
      huntId: null,
      targetUrl: report.finalUrl,
      targetLabel: report.title || report.finalUrl.replace(/^https?:\/\//, "").slice(0, 64),
      note: "Surface recon. Poin read the public HTML and checked links. It did not press controls on this site.",
      probe: report.probe,
    }),
  applyDrive: (view) => {
    const s = get();
    set({
      thoughts: view.thoughts,
      findings: view.findings,
      nodes: view.nodes,
      edges: view.edges,
      stats: view.stats,
      highlight: view.highlight,
      highlightSpace: "drive",
      shot: view.shot ?? s.shot,
      shotSeq: view.shotSeq,
      note: view.note,
      targetUrl: view.target,
      error: view.error ?? "",
      probe: view.probe ?? s.probe,
    });
    if ((view.status === "done" || view.status === "error") && get().screen === "running") {
      get().finish();
    }
  },
  markRecon: (url) =>
    set({
      engine: "recon",
      huntId: null,
      targetUrl: url,
      note: "Surface recon. No browser engine here, so Poin read the public HTML and checked links without pressing controls.",
    }),
  appendThought: (kind, text) =>
    set((s) => ({
      thoughts: [...s.thoughts, { id: `${s.thoughts.length}-${kind}`, kind, text }].slice(-48),
    })),
  addFinding: (finding) =>
    set((s) => (s.findings.some((f) => f.id === finding.id) ? s : { findings: [...s.findings, finding] })),
  setGraph: (nodes, edges) => set({ nodes, edges }),
  patchStats: (partial) => set((s) => ({ stats: { ...s.stats, ...partial } })),
  setHighlight: (highlight, space) => set({ highlight, highlightSpace: space }),
  setProbe: (probe) => set({ probe }),
  setShot: (shot, seq) => set((s) => ({ shot: shot ?? s.shot, shotSeq: seq })),
  setNote: (note) => set({ note }),
  requestStop: () => set({ stopRequested: true }),
  finish: () => {
    const s = get();
    if (s.screen === "done") return;
    const titles = s.findings.map((f) => f.title);
    const diff = baseline(s.targetKey, titles);
    const report = buildReport({
      findings: s.findings,
      stats: s.stats,
      diff,
      probe: s.probe,
      criteria: s.criteria,
      specimenId: s.specimenId,
      engine: s.engine,
    });
    set({
      screen: "done",
      highlight: null,
      stopRequested: false,
      diff,
      report,
    });
  },
  fail: (message) => set({ ...fresh, runToken: get().runToken, screen: "launch", error: message }),
  setBriefState: (briefState, brief) => set({ briefState, brief: brief ?? get().brief }),
}));
