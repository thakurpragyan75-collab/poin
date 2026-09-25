import { usePoin } from "@/lib/poin/store";
import type { GraphNode, SurfaceReport } from "@/lib/poin/types";

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

export async function playSurface(report: SurfaceReport, signal: AbortSignal) {
  const say = usePoin.getState().appendThought;
  say(
    "think",
    `Read “${report.title || "untitled"}”. ${report.counts.links} links, ${report.counts.buttons} buttons, ${report.counts.inputs} fields.`,
  );
  const nodes: GraphNode[] = [
    {
      id: "s0",
      label: "Landing",
      tried: 0,
      total: report.controls.length,
      bugs: 0,
    },
  ];
  const edges = report.links.map((_, i) => ({ from: "s0", to: `s${i + 1}` }));
  report.links.forEach((link, i) => {
    let label = link.href;
    try {
      label = new URL(link.href).pathname || "/";
    } catch {
      label = link.href;
    }
    nodes.push({
      id: `s${i + 1}`,
      label: label.slice(0, 28),
      tried: 1,
      total: 1,
      bugs: link.status !== null && link.status >= 400 ? 1 : 0,
    });
  });
  usePoin.getState().setGraph(nodes, edges);
  for (const control of report.controls.slice(0, 10)) {
    if (signal.aborted || usePoin.getState().stopRequested) return;
    say("act", `Mapped ${control.kind}: ${control.name}`);
    await sleep(160, signal);
  }
  for (const finding of report.findings) {
    if (signal.aborted || usePoin.getState().stopRequested) return;
    usePoin.getState().addFinding(finding);
    say(finding.oracle === "guard" ? "guard" : finding.severity === "note" ? "observe" : "bug", finding.title);
    await sleep(220, signal);
  }
  if (signal.aborted) return;
  usePoin.getState().patchStats({
    actions: 0,
    states: nodes.length,
    controls: report.counts.links + report.counts.buttons + report.counts.inputs,
    tried: 0,
    guarded: report.held.length,
    flakesSuppressed: 0,
    loopsCut: 0,
  });
  say("done", "Surface recon complete. Nothing on the live site was pressed.");
  if (usePoin.getState().screen === "running") usePoin.getState().finish();
}
