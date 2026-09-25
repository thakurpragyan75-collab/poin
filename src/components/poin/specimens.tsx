import { useState } from "react";
import { Settings } from "lucide-react";
import type { SpecimenId } from "@/lib/poin/types";

const COAT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="112" viewBox="0 0 88 112"><rect width="88" height="112" rx="2" fill="#2a2622"/><path d="M28 16h32l10 22v62H18V38z" fill="#6e6256"/><path d="M40 16h8v20h-8z" fill="#3a342e"/></svg>`,
  );

export function Specimen({ id }: { id: SpecimenId }) {
  if (id === "harbor") return <Harbor />;
  if (id === "northstar") return <Northstar />;
  return <Lumen />;
}

function Harbor() {
  const [view, setView] = useState<"shop" | "missing">("shop");
  const [cart, setCart] = useState(0);
  const [cookie, setCookie] = useState(true);
  const [qty, setQty] = useState("1");
  const [promo, setPromo] = useState("");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState(false);

  if (view === "missing") {
    return (
      <div className="lab-site" data-specimen="harbor" data-view="missing" data-status="404">
        <button type="button" className="lab-quiet" onClick={() => setView("shop")}>
          Back to Harbor
        </button>
        <h1>Page not found</h1>
        <p>The shipping policy is not on this server.</p>
      </div>
    );
  }

  return (
    <div className="lab-site" data-specimen="harbor" data-view="shop" data-status="200">
      {cookie ? (
        <div className="lab-cookie">
          <p>Harbor keeps a session crumb so the cart survives a refresh.</p>
          <button type="button" onClick={() => setCookie(false)}>
            Accept
          </button>
        </div>
      ) : null}
      <header className="lab-top">
        <strong>Harbor</strong>
        <span>Cart {cart}</span>
      </header>
      <article className="lab-product">
        <img src={COAT} width={88} height={112} />
        <div>
          <h1>Wool field coat</h1>
          <p className="lab-whisper">$248</p>
          <div className="lab-inline">
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            <button
              type="button"
              onClick={() => setCart((c) => c + (Number.parseInt(qty, 10) || 1))}
            >
              Add to cart
            </button>
          </div>
        </div>
      </article>
      <p className="lab-nowrap">SPRINGFIELD-WAREHOUSE-CODE-MUST-STAY-ON-ONE-LINE-OR-THE-BANNER-BREAKS</p>
      <label className="lab-field">
        Promo code
        <input value={promo} onChange={(e) => setPromo(e.target.value)} />
      </label>
      <div className="lab-clash">
        <button type="button" className="lab-apply">
          Apply
        </button>
        <button type="button" className="lab-cover" onClick={() => setNote("Gift wrap added.")}>
          Gift wrap
        </button>
      </div>
      {note ? <p>{note}</p> : null}
      <div className="lab-actions">
        <button
          type="button"
          className="lab-quiet"
          onClick={() => {
            window.setTimeout(() => {
              throw new Error("Cannot read properties of undefined (reading 'total')");
            }, 0);
          }}
        >
          Calculate tax
        </button>
        <button type="button" className="lab-quiet" onClick={() => setDelivery((v) => !v)}>
          {delivery ? "Hide" : "Show"} delivery notes
        </button>
        <button type="button" className="lab-quiet" onClick={() => setView("missing")}>
          Shipping policy
        </button>
      </div>
      {delivery ? <p>Ships in four days from the dock warehouse.</p> : null}
      <div className="lab-actions">
        <button type="button">Place order</button>
        <button type="button" className="lab-quiet">
          Delete saved card
        </button>
      </div>
    </div>
  );
}

const ROWS = [
  { sku: "NS-14", name: "North quay" },
  { sku: "NS-22", name: "Glass ledger" },
  { sku: "NS-31", name: "Dry dock" },
  { sku: "NS-40", name: "Pilot lamp" },
];

function Northstar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [exp, setExp] = useState("");
  const shown = ROWS.filter((row) => row.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="lab-site" data-specimen="northstar" data-view="desk" data-status="200">
      <header className="lab-top">
        <strong>Northstar</strong>
        <span className="lab-live">LIVE</span>
      </header>
      <div className="lab-toolbar">
        <button type="button" className="lab-icon" onClick={() => setPanel((v) => !v)}>
          <Settings aria-hidden="true" />
        </button>
        <button type="button" className="lab-quiet">
          Refresh metrics
        </button>
        <button
          type="button"
          onClick={() => {
            setExp("Exporting");
            void fetch("/api/poin-fail").then((res) => {
              setExp(res.ok ? "Ready" : `Export failed (${res.status})`);
            });
          }}
        >
          Export
        </button>
      </div>
      {panel ? <p>Desk preferences. Density compact. Alerts on.</p> : null}
      {exp ? <p>{exp}</p> : null}
      <div className="lab-bars" aria-hidden="true">
        <span style={{ height: "70%" }} />
        <span style={{ height: "45%" }} />
        <span style={{ height: "88%" }} />
        <span style={{ height: "32%" }} />
      </div>
      <div data-results className="lab-rows">
        {shown.map((row) => (
          <div key={row.sku} className="lab-row">
            <span>
              {row.sku} {row.name}
            </span>
            <button type="button" className="lab-quiet" onClick={() => setOpen(row.name)}>
              Open
            </button>
          </div>
        ))}
      </div>
      {open ? (
        <div className="lab-drawer">
          <p>Record {open}</p>
          <button type="button" className="lab-quiet" onClick={() => setOpen(null)}>
            Close record
          </button>
        </div>
      ) : null}
      <label className="lab-field">
        Search records
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
    </div>
  );
}

function Lumen() {
  const [doc, setDoc] = useState<"overview" | "install" | "limits">("overview");
  const [missing, setMissing] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState(false);

  if (missing) {
    return (
      <div className="lab-site" data-specimen="lumen" data-view="missing" data-status="404">
        <button type="button" className="lab-quiet" onClick={() => setMissing(false)}>
          Back to docs
        </button>
        <h1>Page not found</h1>
        <p>API reference has not been published.</p>
      </div>
    );
  }

  const body =
    doc === "overview"
      ? "Lumen is the field manual. Start with install, then read the limits before you automate a hunt."
      : doc === "install"
        ? "Add the script to staging. Never point a hunter at production checkout."
        : "Rate limits exist so a hunt cannot hammer a host. Twelve safe presses, then it stops.";

  return (
    <div className="lab-site" data-specimen="lumen" data-view={doc} data-status="200">
      <header className="lab-top">
        <strong>Lumen</strong>
        <span className="lab-beta">Beta</span>
      </header>
      <div className="lab-actions">
        <button type="button" className={doc === "overview" ? "" : "lab-quiet"} onClick={() => setDoc("overview")}>
          Overview
        </button>
        <button type="button" className={doc === "install" ? "" : "lab-quiet"} onClick={() => setDoc("install")}>
          Install
        </button>
        <button type="button" className={doc === "limits" ? "" : "lab-quiet"} onClick={() => setDoc("limits")}>
          Limits
        </button>
      </div>
      <h1>{doc === "overview" ? "Overview" : doc === "install" ? "Install" : "Limits"}</h1>
      <p>{body}</p>
      <div className="lab-code">
        <code>poin hunt --target staging</code>
        <button
          type="button"
          onClick={() => {
            window.setTimeout(() => {
              throw new Error("Clipboard API blocked in this frame");
            }, 0);
          }}
        >
          Copy
        </button>
      </div>
      <div className="lab-inline">
        <input
          type="search"
          aria-label="Search docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs"
        />
        <button type="button">Search</button>
      </div>
      <button type="button" className="lab-quiet" onClick={() => setNotes((v) => !v)}>
        {notes ? "Hide release notes" : "Release notes"}
      </button>
      {notes ? <p>0.9 — ledger stops itself. Guard still holds payment.</p> : null}
      <button type="button" className="lab-quiet" onClick={() => setMissing(true)}>
        API reference
      </button>
      <form
        className="lab-form"
        onSubmit={(e) => {
          e.preventDefault();
          setThanks(true);
        }}
      >
        <input type="email" />
        <textarea rows={3} />
        <button type="submit">Send feedback</button>
      </form>
      {thanks ? <p>Received. A human reads these.</p> : null}
    </div>
  );
}
