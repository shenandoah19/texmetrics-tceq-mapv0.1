# TexMetrics map constitution

This file is binding. Grok Build / any agent must read it before editing. A commit that violates it is invalid.

## Product

- This repo is the one-RN sale path: pins of TCEQ agreed orders → password → Railway generate-pdf.
- Company pack lives on texmetrics.com/company-pack (Railway `/pack`). Do not add CN search, zip, or pack UI here.
- Public sample is Covestro RN100209931. Do not special-case or market ONEOK. Pins may exist if TCEQ data has them.

## Must not break

- Leaflet map must mount. Pins, 5-year chip, Top 10 sites, selected card, pin popup must render.
- Never write review notes, debug sentences, or FAIL text into user-visible HTML (example of invalid: "showDetail still slices 12 orders").
- Do not string-replace / patch a pinned copy of `app.js`. Edit the real source files.
- Popup CTA and selected-card CTA must open the same early-access password path for that RN.
- Report ready: Open PDF and Download PDF. No mailto.

## Defaults

- Date filter default is last 5 years. `?q=` / deep link stays on 5-year, not All years.
- Selected card and popup order: title, customer, payable (current filter), RN, rating, Get-report CTA, at most 3 orders.
- Side list is Sites (RN), ranked by payable in the current filter.

## Out of scope

- Stripe, prices, email blast, Framer homepage.
- Title V default-on filter and search-opens-modal until specified in a later spec that also requires the map still to render.
