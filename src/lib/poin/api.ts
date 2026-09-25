import { createServerFn } from "@tanstack/react-start";
import type { DriveView, Finding, SurfaceReport } from "@/lib/poin/types";

function startInput(input: unknown): { url: string } {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid request");
  }
  const url = "url" in input && typeof input.url === "string" ? input.url.trim() : "";
  const consent = "consent" in input && input.consent === true;
  if (!consent) throw new Error("Permission is required before Poin touches a site.");
  if (url.length < 8 || url.length > 2000) throw new Error("Enter a full http(s) URL.");
  return { url };
}

export const startHunt = createServerFn({ method: "POST" })
  .validator(startInput)
  .handler(async ({ data }): Promise<{ mode: "drive"; id: string } | { mode: "recon"; report: SurfaceReport }> => {
    const { assertPublicUrl, isGuardError } = await import("@/lib/poin/guard.server");
    await assertPublicUrl(data.url);
    try {
      const { beginDrive } = await import("@/lib/poin/drive.server");
      const id = await beginDrive(data.url);
      return { mode: "drive", id };
    } catch (error) {
      if (isGuardError(error)) throw error;
      const { surface } = await import("@/lib/poin/recon.server");
      const report = await surface(data.url);
      return { mode: "recon", report };
    }
  });

function pollInput(input: unknown): { id: string; sinceSeq: number } {
  if (typeof input !== "object" || input === null) throw new Error("Invalid request");
  const id = "id" in input && typeof input.id === "string" ? input.id : "";
  const sinceSeq = "sinceSeq" in input && typeof input.sinceSeq === "number" ? input.sinceSeq : 0;
  if (!/^[a-z0-9]{4,16}$/.test(id)) throw new Error("Unknown hunt");
  return { id, sinceSeq };
}

export const pollHunt = createServerFn({ method: "POST" })
  .validator(pollInput)
  .handler(async ({ data }): Promise<DriveView | null> => {
    const { readDrive } = await import("@/lib/poin/drive.server");
    return readDrive(data.id, data.sinceSeq);
  });

export const stopHunt = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (typeof input !== "object" || input === null || !("id" in input) || typeof input.id !== "string") {
      throw new Error("Unknown hunt");
    }
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { stopDrive } = await import("@/lib/poin/drive.server");
    return { ok: stopDrive(data.id) };
  });

function judgeInput(input: unknown): {
  target: string;
  findings: Pick<Finding, "title" | "severity" | "oracle" | "evidence">[];
  suites: string[];
} {
  if (typeof input !== "object" || input === null) throw new Error("Invalid request");
  const target = "target" in input && typeof input.target === "string" ? input.target.slice(0, 180) : "Unknown target";
  const raw = "findings" in input && Array.isArray(input.findings) ? input.findings : [];
  const findings = raw.slice(0, 12).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const title = "title" in item && typeof item.title === "string" ? item.title.slice(0, 160) : "";
    const severity = "severity" in item && typeof item.severity === "string" ? item.severity.slice(0, 16) : "note";
    const oracle = "oracle" in item && typeof item.oracle === "string" ? item.oracle.slice(0, 16) : "console";
    const evidence = "evidence" in item && typeof item.evidence === "string" ? item.evidence.slice(0, 240) : "";
    if (!title) return [];
    return [{ title, severity: severity as Finding["severity"], oracle: oracle as Finding["oracle"], evidence }];
  });
  const suites = ("suites" in input && Array.isArray(input.suites) ? input.suites : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, 280))
    .slice(0, 10);
  return { target, findings, suites };
}

export const judgeHunt = createServerFn({ method: "POST" })
  .validator(judgeInput)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Judgment oracle is offline in this environment." };
    const list =
      data.findings.length === 0
        ? "No findings were recorded."
        : data.findings
            .map((f, i) => `${i + 1}. [${f.severity}/${f.oracle}] ${f.title} — ${f.evidence}`)
            .join("\n");
    const suites =
      data.suites.length === 0 ? "" : `\n\nSuite scores:\n${data.suites.map((line, i) => `${i + 1}. ${line}`).join("\n")}`;
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 420,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are Poin's principal tester. Write a brief an engineer can act on. Do not invent defects that are not in the findings. Plain prose only: no markdown, no asterisks, no headings. Under 150 words. Name the single most important defect first, why it likely happens, then three retests. If there are no findings, say the pass was clean and name what was not covered: payments, auth, and anything held.",
          },
          { role: "user", content: `Target: ${data.target}\n\nFindings:\n${list}${suites}` },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `Judgment oracle returned ${res.status}.` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "Judgment oracle returned an empty brief." };
    return { ok: true as const, text };
  });
