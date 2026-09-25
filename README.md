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
