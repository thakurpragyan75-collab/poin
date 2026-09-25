import { useEffect, useRef } from "react";
import { judgeHunt, pollHunt, stopHunt } from "@/lib/poin/api";
import { runLab } from "@/lib/poin/lab-agent";
import { playSurface } from "@/lib/poin/playback";
import { usePoin } from "@/lib/poin/store";
import { DRIVE_FRAME, ORACLES, severityRank, type Finding } from "@/lib/poin/types";
import type { SuiteResult, SuiteStatus } from "@/lib/poin/suites";
import { Specimen } from "@/components/poin/specimens";

export function Hunt() {
  const screen = usePoin((s) => s.screen);
  const engine = usePoin((s) => s.engine);
  const specimenId = usePoin((s) => s.specimenId);
  const runToken = usePoin((s) => s.runToken);
  const huntId = usePoin((s) => s.huntId);
  const surface = usePoin((s) => s.surface);
  const targetLabel = usePoin((s) => s.targetLabel);
  const targetUrl = usePoin((s) => s.targetUrl);
  const note = usePoin((s) => s.note);
  const thoughts = usePoin((s) => s.thoughts);
  const findings = usePoin((s) => s.findings);
  const nodes = usePoin((s) => s.nodes);
  const edges = usePoin((s) => s.edges);
  const stats = usePoin((s) => s.stats);
  const highlight = usePoin((s) => s.highlight);
  const highlightSpace = usePoin((s) => s.highlightSpace);
  const shot = usePoin((s) => s.shot);
  const brief = usePoin((s) => s.brief);
  const briefState = usePoin((s) => s.briefState);
  const diff = usePoin((s) => s.diff);
  const report = usePoin((s) => s.report);
  const goLaunch = usePoin((s) => s.goLaunch);
  const requestStop = usePoin((s) => s.requestStop);
  const applyDrive = usePoin((s) => s.applyDrive);
  const setBriefState = usePoin((s) => s.setBriefState);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (engine !== "lab" || !specimenId) return;
    const root = rootRef.current;
    if (!root) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void runLab({ root, signal: ctrl.signal });
    }, 40);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [engine, specimenId, runToken]);

  useEffect(() => {
    if (engine !== "drive" || !huntId) return;
    let stopped = false;
    let seq = 0;
    let timer = 0;
    const tick = async () => {
      if (stopped) return;
      try {
        const view = await pollHunt({ data: { id: huntId, sinceSeq: seq } });
        if (stopped || !view) return;
        seq = view.shotSeq;
        applyDrive(view);
        if (view.status === "running") timer = window.setTimeout(tick, 700);
      } catch {
        if (!stopped) timer = window.setTimeout(tick, 900);
      }
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [engine, huntId, applyDrive]);

  useEffect(() => {
    if (engine !== "recon" || !surface) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void playSurface(surface, ctrl.signal);
    }, 40);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [engine, surface, runToken]);

  const latest = thoughts[thoughts.length - 1];
  const ordered = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  async function onStop() {
    requestStop();
    if (huntId) await stopHunt({ data: { id: huntId } }).catch(() => undefined);
  }

  async function onBrief() {
    setBriefState("loading");
    try {
      const result = await judgeHunt({
        data: {
          target: targetLabel,
          findings: ordered.slice(0, 12).map((f) => ({
            title: f.title,
            severity: f.severity,
            oracle: f.oracle,
            evidence: f.evidence,
          })),
          suites: report.map((suite) => `${suite.label} (${suite.status}): ${suite.summary}`),
        },
      });
      if (!result.ok) setBriefState("error", result.error);
      else setBriefState("done", result.text);
    } catch {
      setBriefState("error", "The brief did not return.");
    }
  }

  function onDownload() {
    const payload = {
      target: targetLabel,
      url: targetUrl,
      engine,
      stats,
      findings: ordered,
      report,
      thoughts,
      diff,
      brief,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `poin-${targetLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "hunt"}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <button type="button" className="btn btn-ghost" onClick={goLaunch}>
          Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-xl">{targetLabel}</h1>
          <p className="truncate text-sm text-muted">{note}</p>
        </div>
        <Stats />
        {screen === "running" ? (
          <button type="button" className="btn btn-ghost" onClick={() => void onStop()}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={goLaunch}>
            New hunt
          </button>
        )}
      </header>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)] sm:p-6">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="overflow-hidden rounded-xl border border-line bg-elev">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-faint">
              <span className="size-2 rounded-full bg-sage" />
              <span className="truncate">{targetUrl}</span>
            </div>
            <div ref={rootRef} className="stage-body">
              {engine === "lab" && specimenId ? <Specimen key={specimenId} id={specimenId} /> : null}
              {engine === "drive" ? (
                shot ? (
                  <img
                    src={`data:image/jpeg;base64,${shot}`}
                    alt="Browser frame of the site under test"
                    width={DRIVE_FRAME.w}
                    height={DRIVE_FRAME.h}
                    className="block h-auto w-full bg-subtle"
                  />
                ) : (
                  <div className="flex min-h-80 items-end bg-subtle p-6 text-muted">
                    <p>Browser is opening. The first frame lands after the page paints.</p>
                  </div>
                )
              ) : null}
              {engine === "recon" ? <SurfaceMap /> : null}
              {highlight ? (
                <div
                  className="crosshair"
                  style={
                    highlightSpace === "drive"
                      ? {
                          left: `${(highlight.x / DRIVE_FRAME.w) * 100}%`,
                          top: `${(highlight.y / DRIVE_FRAME.h) * 100}%`,
                          width: `${(highlight.w / DRIVE_FRAME.w) * 100}%`,
                          height: `${(highlight.h / DRIVE_FRAME.h) * 100}%`,
                        }
                      : {
                          position: "fixed",
                          left: highlight.x,
                          top: highlight.y,
                          width: highlight.w,
                          height: highlight.h,
                        }
                  }
                >
                  <span>{highlight.name}</span>
                </div>
              ) : null}
            </div>
          </section>
          <p className="min-h-6 text-sm text-muted" aria-live="polite">
            {latest ? latest.text : "Waiting for the first observation."}
          </p>
          <Ledger nodes={nodes} edges={edges} />
        </div>
        <aside className="flex flex-col gap-4">
          <OracleRack findings={findings} />
          <section className="rounded-xl border border-line bg-elev p-4">
            <h2 className="text-sm text-muted">Findings</h2>
            {ordered.length === 0 ? (
              <p className="mt-3 text-sm text-faint">None yet. Oracles write here as soon as something fails.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {ordered.slice(0, 8).map((finding) => (
                  <li key={finding.id}>
                    <FindingRow finding={finding} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      {screen === "done" ? (
        <section className="mx-auto flex max-w-6xl flex-col gap-5 px-4 pb-16 sm:px-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-title">Dossier</h2>
              <p className="mt-1 text-sm text-muted">
                {diff?.hadBaseline
                  ? `${diff.added.length} new, ${diff.still.length} still open, ${diff.gone.length} gone since the last hunt.`
                  : "Sealed as the baseline. The next hunt on this target will show only what changed."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => void onBrief()} disabled={briefState === "loading"}>
                {briefState === "loading" ? "Writing" : "Write the brief"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onDownload}>
                Download dossier
              </button>
            </div>
          </header>
          {brief ? <p className="max-w-3xl whitespace-pre-wrap text-fg">{brief.replaceAll("**", "")}</p> : null}
          {briefState === "error" ? <p className="text-sm text-clay">{brief}</p> : null}
          <TestMatrix report={report} />
          {ordered.length === 0 ? (
            <p className="max-w-2xl text-muted">
              No defects recorded. A clean pass is not proof. Payment, login, and anything held were not exercised.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {ordered.map((finding) => (
                <article key={finding.id} className="rounded-xl border border-line bg-elev p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityPill severity={finding.severity} />
                    <span className="text-sm text-faint">{labelFor(finding.oracle)}</span>
                    <span className="text-sm text-faint tabular-nums">
                      {finding.confirmed ? "Confirmed" : "Once"} · {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                  <h3 className="mt-2 text-lg">{finding.title}</h3>
                  <p className="mt-2 text-muted">{finding.summary}</p>
                  <ol className="mt-3 list-decimal pl-5 text-sm text-fg">
                    {finding.repro.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p className="mt-3 font-mono text-sm text-muted">{finding.evidence}</p>
                  <p className="mt-2 text-sm text-fg">{finding.fix}</p>
                </article>
              ))}
            </div>
          )}
          {thoughts.length ? (
            <details className="rounded-xl border border-line bg-elev p-4">
              <summary className="cursor-pointer text-sm text-muted">Replay</summary>
              <ol className="mt-3 flex flex-col gap-1 text-sm">
                {thoughts.map((thought) => (
                  <li key={thought.id} className="grid grid-cols-[4.5rem_1fr] gap-3">
                    <span className="text-faint">{thought.kind}</span>
                    <span>{thought.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function TestMatrix({ report }: { report: SuiteResult[] }) {
  const groups = [
    ["functional", "Functional"],
    ["nonfunctional", "Non-functional"],
  ] as const;
  if (report.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(([id, label]) => (
        <section key={id} className="rounded-xl border border-line bg-elev p-4">
          <h3 className="text-sm text-muted">{label}</h3>
          <ul className="mt-3 flex flex-col gap-4">
            {report
              .filter((suite) => suite.group === id)
              .map((suite) => (
                <li key={suite.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={suite.status} />
                    <span className="text-sm text-fg">{suite.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{suite.summary}</p>
                  {suite.evidence.length ? (
                    <ul className="mt-1 flex flex-col gap-1 text-sm text-faint">
                      {suite.evidence.slice(0, 3).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: SuiteStatus }) {
  const tone =
    status === "pass" ? "bg-sage-soft text-sage" : status === "fail" ? "bg-clay-soft text-clay" : "bg-amber-soft text-amber";
  const label = status === "pass" ? "Pass" : status === "fail" ? "Fail" : "Partial";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

function Stats() {
  const stats = usePoin((s) => s.stats);
  const items = [
    ["States", stats.states],
    ["Pressed", stats.actions],
    ["Held", stats.guarded],
    ["Flakes", stats.flakesSuppressed],
  ] as const;
  return (
    <dl className="hidden gap-4 sm:flex">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-faint">{label}</dt>
          <dd className="font-mono text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OracleRack({ findings }: { findings: Finding[] }) {
  return (
    <section className="rounded-xl border border-line bg-elev p-4">
      <h2 className="text-sm text-muted">Oracles</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {ORACLES.map((oracle) => {
          const count = findings.filter((f) => f.oracle === oracle.id).length;
          return (
            <li key={oracle.id} className="grid grid-cols-[5.5rem_1fr_1.5rem] items-center gap-3">
              <span className="text-sm">{oracle.label}</span>
              <span className="h-px bg-line">
                {count > 0 ? <span className="tick block h-px w-full bg-paper" /> : null}
              </span>
              <span className="text-right font-mono text-sm tabular-nums text-muted">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <SeverityPill severity={finding.severity} />
        <span className="text-xs text-faint">{labelFor(finding.oracle)}</span>
      </div>
      <p className="mt-1 text-sm">{finding.title}</p>
    </div>
  );
}

function SeverityPill({ severity }: { severity: Finding["severity"] }) {
  const tone =
    severity === "blocker"
      ? "bg-clay-soft text-clay"
      : severity === "major"
        ? "bg-amber-soft text-amber"
        : severity === "minor"
          ? "bg-subtle text-muted"
          : "bg-sage-soft text-sage";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{severity}</span>;
}

function labelFor(id: Finding["oracle"]) {
  return ORACLES.find((oracle) => oracle.id === id)?.label ?? id;
}

function Ledger({
  nodes,
  edges,
}: {
  nodes: { id: string; label: string; tried: number; total: number; bugs: number }[];
  edges: { from: string; to: string }[];
}) {
  if (nodes.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-elev p-4">
        <h2 className="text-sm text-muted">State ledger</h2>
        <p className="mt-2 text-sm text-faint">Screens appear here as the hunter reaches them. A known screen is not walked again.</p>
      </section>
    );
  }
  const width = Math.max(nodes.length * 108, 280);
  return (
    <section className="rounded-xl border border-line bg-elev p-4">
      <h2 className="text-sm text-muted">State ledger</h2>
      <div className="mt-3 overflow-x-auto">
        <svg width={width} height={92} role="img" aria-label="Coverage graph">
          {edges.map((edge) => {
            const a = nodes.findIndex((n) => n.id === edge.from);
            const b = nodes.findIndex((n) => n.id === edge.to);
            if (a < 0 || b < 0) return null;
            return (
              <line
                key={`${edge.from}-${edge.to}-${a}`}
                x1={a * 108 + 16}
                y1={18}
                x2={b * 108 + 16}
                y2={18}
                stroke="currentColor"
                className="text-line-strong"
              />
            );
          })}
          {nodes.map((node, index) => (
            <g key={node.id} transform={`translate(${index * 108}, 0)`}>
              <circle cx={16} cy={18} r={6} className={node.bugs > 0 ? "fill-clay" : "fill-paper"} />
              <text x={0} y={44} className="fill-fg" fontSize={12}>
                {node.label.slice(0, 16)}
              </text>
              <text x={0} y={62} className="fill-faint" fontSize={11}>
                {node.tried}/{node.total}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

function SurfaceMap() {
  const surface = usePoin((s) => s.surface);
  if (!surface) return null;
  return (
    <div className="min-h-80 bg-elev p-4 text-fg">
      <p className="text-sm text-muted">
        {surface.status} · {surface.bytes.toLocaleString()} bytes · {surface.ms} ms
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {surface.controls.slice(0, 14).map((control, index) => (
          <li key={`${control.kind}-${control.name}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
            <span className="text-faint">{control.kind}</span>
            <span className="truncate">{control.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
