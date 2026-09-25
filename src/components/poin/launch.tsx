import { useState, type FormEvent } from "react";
import { startHunt } from "@/lib/poin/api";
import { usePoin } from "@/lib/poin/store";
import { ORACLES, type SpecimenId } from "@/lib/poin/types";

const SPECIMENS: { id: SpecimenId; name: string; kind: string; line: string }[] = [
  {
    id: "harbor",
    name: "Harbor",
    kind: "Checkout",
    line: "Dead promo, tax crash, clipped banner, unlabeled quantity. The order button stays held.",
  },
  {
    id: "northstar",
    name: "Northstar",
    kind: "Admin",
    line: "Export returns 500. Refresh does nothing. Search dies into a blank table.",
  },
  {
    id: "lumen",
    name: "Lumen",
    kind: "Docs",
    line: "Copy throws, a link 404s, feedback fields have no names.",
  },
];

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The hunt did not start.";
}

export function Launch() {
  const error = usePoin((s) => s.error);
  const beginLab = usePoin((s) => s.beginLab);
  const beginRemote = usePoin((s) => s.beginRemote);
  const attachDrive = usePoin((s) => s.attachDrive);
  const setSurface = usePoin((s) => s.setSurface);
  const fail = usePoin((s) => s.fail);
  const [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState("");

  async function onHunt(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setLocalError("Use a full URL, including http:// or https://.");
      return;
    }
    if (!consent) {
      setLocalError("Confirm you are allowed to test this site.");
      return;
    }
    setLocalError("");
    beginRemote(trimmed);
    try {
      const result = await startHunt({ data: { url: trimmed, consent: true } });
      if (result.mode === "drive") attachDrive(result.id);
      else setSurface(result.report);
    } catch (err) {
      fail(messageOf(err));
    }
  }

  const shown = localError || error;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="flex items-baseline justify-between gap-4 px-5 py-5 sm:px-8">
        <p className="font-serif text-2xl tracking-tight">Poin</p>
        <p className="text-sm text-muted">Autonomous tester</p>
      </header>
      <main className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 sm:px-8 lg:grid-cols-[1.35fr_0.75fr]">
        <section>
          <p className="rise text-sm text-sage">One click. Then it hunts.</p>
          <h1 className="rise rise-2 mt-3 font-serif text-display leading-none tracking-tight">
            It presses until the site is known. Then it stops.
          </h1>
          <p className="rise rise-3 mt-5 max-w-xl text-muted">
            Poin builds a ledger of every screen it reaches, presses what is safe, refuses pay and delete, and writes each bug with the steps that caused it.
          </p>
          <form onSubmit={onHunt} className="mt-8 flex max-w-xl flex-col gap-3">
            <label className="text-sm text-muted" htmlFor="target">
              Staging URL
            </label>
            <input
              id="target"
              className="field"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://staging.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="flex min-h-11 items-center gap-3 text-sm text-muted">
              <input
                type="checkbox"
                className="size-4 accent-paper"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I am allowed to test this site.
            </label>
            {shown ? <p className="text-sm text-clay">{shown}</p> : null}
            <div>
              <button type="submit" className="btn btn-primary">
                Hunt
              </button>
            </div>
            <p className="text-sm text-faint">
              Use staging. Poin will not submit payment, delete, or follow links off the host. Where a browser engine is available it drives the page. Otherwise it reads the public HTML and checks links.
            </p>
          </form>
        </section>
        <aside className="border-t border-line pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <h2 className="text-sm font-medium text-muted">How a hunt decides</h2>
          <ol className="mt-4 flex flex-col gap-4">
            {ORACLES.map((oracle, index) => (
              <li key={oracle.id} className="grid grid-cols-[1.5rem_1fr] gap-3">
                <span className="font-mono text-sm text-faint tabular-nums">{index + 1}</span>
                <span>
                  <span className="block text-fg">{oracle.label}</span>
                  <span className="block text-sm text-muted">{oracle.line}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
        <section className="lg:col-span-2">
          <h2 className="font-serif text-title">Or drive a specimen. The bugs are real.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            These are small sites inside Poin. The hunter clicks them in this window. Nothing is scripted in advance.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {SPECIMENS.map((specimen) => (
              <article key={specimen.id} className="flex flex-col rounded-xl border border-line bg-elev p-5">
                <p className="text-sm text-faint">{specimen.kind}</p>
                <h3 className="mt-1 font-serif text-2xl">{specimen.name}</h3>
                <p className="mt-3 flex-1 text-sm text-muted">{specimen.line}</p>
                <button type="button" className="btn btn-ghost mt-5" onClick={() => beginLab(specimen.id)}>
                  Drive {specimen.name}
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
