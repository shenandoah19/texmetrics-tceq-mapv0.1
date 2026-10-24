# TexMetrics map constitution

This file is binding. Grok Build / any agent must read it before editing. A commit that violates it is invalid.

## Product

- This repo is the one-RN sale path: the $129 button posts that RN to Railway POST /checkout. Railway opens a Stripe test Checkout. After payment, Stripe sends the browser to Railway GET /download.
- List price $129 MAY display on the pin popup and selected-card Get-report CTA. The click posts the RN only. The card number never touches the map. No live Stripe key in this repo. No $179.
- Company pack lives on texmetrics.com/company-pack (Railway `/pack`). Do not add CN search, zip, or pack UI here.
- Covestro RN100209931 is a normal map site: its pin opens the live /rn/RN100209931 page with 'Preview report · $129' like every other pin (Bryce ruling 2026-10-24). The old sample PDF stays in the repo but is not linked from the map. Do not special-case ONEOK. Do not sell or market to ONEOK employees, vendors, or contractors. Pins may exist if TCEQ data has them. Do not refuse RN100209949 or RN107914277.

## Must not break

- Leaflet map must mount. Pins, 5-year chip, Top 10 sites, selected card, pin popup must render.
- Never write review notes, debug sentences, or FAIL text into user-visible HTML (example of invalid: "showDetail still slices 12 orders").
- Do not string-replace / patch a pinned copy of `app.js`. Edit the real source files.
- Popup CTA and selected-card CTA use the same action for that RN. The $129 click posts to checkout and does not open a password modal. Covestro uses that same pin action and the same $129 label.
- No password prompt. No mailto.

## Defaults

- Date filter default is last 5 years. Search and `?q=` use all years. A "Show all years" control switches that default 5-year view to all years and back.
- Selected card and popup order: title, customer, payable (current filter), RN, rating, Get-report CTA, at most 3 orders.
- Side list is Sites (RN), ranked by payable in the current filter.

## Out of scope

- Live Stripe keys, pack as a Stripe product, card fields on the map, $179, email blast, Framer homepage, pack UI on the map.
- Title V default-on filter and search-opens-modal until specified in a later spec that also requires the map still to render.
