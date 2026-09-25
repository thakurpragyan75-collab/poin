# Poin

Autonomous website tester. Give it a URL you are allowed to test, or drive one of the built-in sites. Poin walks controls, refuses to repeat a screen it already knows, holds destructive actions, and writes each bug with what it saw.

## Run it locally

Requires **Node.js 22**.

```bash
git clone https://github.com/thakurpragyan75-collab/poin.git
cd poin
npm install
npx playwright install chromium
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

Chromium is what the live drive uses. If it cannot launch, the same hunt falls back to a public-page read (HTML, links, and the controls it can see without a browser).

## What to try

| Action | What happens |
| --- | --- |
| Drive Harbor | Checkout with a dead promo, a tax crash, clipped text, and an unlabeled quantity. The pay control is held. |
| Drive Northstar | Admin table. Export returns 500. Refresh does nothing. Search ends on an empty table. |
| Drive Lumen | Docs. Copy throws. A link 404s. Feedback fields have no names. |
| Hunt a URL | Public `http` or `https` address, after you confirm you may test it. Pay, delete, subscribe, passwords, and links that leave the host are held, not clicked. |

Hunts stay in this browser. There is no account and no database.

## What it checks

- Console errors tied to the control that fired them
- Network responses in the 4xx and 5xx range
- Missing names, low contrast, missing alt text
- Overlapping controls and text that spills its box
- Dead clicks, confirmed only after a second try
- A guard that will not pay, delete, subscribe, or leave the site

## Scripts

```bash
npm run dev        # local server on port 8080
npm run build      # production build
npm run typecheck
npm test
```

## What the dossier scores

Functional: smoke, sanity, integration, system, regression, user acceptance.

Non-functional: performance and load, security, usability, compatibility.

Each row is Pass, Fail, or Partial, with the evidence Poin actually collected. A partial means the check ran but is not a full proof — for example, load is a single-user timing because Poin does not open concurrent sessions, and compatibility is Chromium at 390, 768, and 1120, not Firefox or Safari. Security is passive (HTTPS, headers, mixed content). Poin does not send attack payloads.

Optional acceptance lines, one per line:

```
see: Order confirmed
control: Add to cart
clean
```

`see:` looks for visible text. `control:` looks for a named control. `clean` fails if a blocker or major defect was found. Leave the box blank and a specimen uses its own script; any other URL gets three inferred checks, which is not a signed user acceptance.
