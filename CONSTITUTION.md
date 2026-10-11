# TexMetrics map constitution

This file is binding. Grok Build / any agent must read it before editing. A commit that violates it is invalid.

## Product

- This repo is the one-RN sale path: the $129 button posts that RN to Railway POST /checkout. Railway opens a Stripe test Checkout. After payment, Stripe sends the browser to Railway GET /download.
- List price $129 MAY display on the pin popup and selected-card Get-report CTA. The click posts the RN only. The card number never touches the map. No live Stripe key in this repo. No $179.
- Company pack lives on texmetrics.com/company-pack (Railway `/pack`). Do not add CN search, zip, or pack UI here.
- Public sample is Covestro RN100209931: no price, no Buy, never calls checkout. The sample opens TexMetrics_RN100209931_Compliance_Report.pdf. Do not special-case ONEOK. Do not sell or market to ONEOK employees, vendors, or contractors. Pins may exist if TCEQ data has them. Do not refuse RN100209949 or RN107914277.

## Must not break

- Leaflet map must mount. Pins, 5-year chip, Top 10 sites, selected card, pin popup must render.
- Never write review notes, debug sentences, or FAIL text into user-visible HTML (example of invalid: "showDetail still slices 12 orders").
- Do not string-replace / patch a pinned copy of `app.js`. Edit the real source files.
- Popup CTA and selected-card CTA use the same action for that RN. The $129 click posts to checkout and does not open a password modal. The Covestro sample opens the public PDF and does not call checkout.
- No password prompt. No mailto.

## Defaults

- Date filter default is last 5 years. `?q=` / deep link stays on 5-year, not All years.
- Selected card and popup order: title, customer, payable (current filter), RN, rating, Get-report CTA, at most 3 orders.
- Side list is Sites (RN), ranked by payable in the current filter.

## Out of scope

- Live Stripe keys, pack as a Stripe product, card fields on the map, $179, email blast, Framer homepage, pack UI on the map.
- Title V default-on filter and search-opens-modal until specified in a later spec that also requires the map still to render.
