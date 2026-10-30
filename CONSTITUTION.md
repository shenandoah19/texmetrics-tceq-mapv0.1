# TexMetrics map constitution

This file is binding. Grok Build / any agent must read it before editing. A commit that violates it is invalid.

## Product

- The map button says "Preview report" with no price. It opens https://reports.texmetrics.com/rn/<RN> in a new tab and never calls checkout. The sale is completed on the preview page. No live Stripe key in this repo. No $179.
- Company pack lives on texmetrics.com/company-pack (Railway `/pack`). Do not add CN search, zip, or pack UI here.
- Sample RN100209931 is the Covestro PDF with no price. Its button says "Get the TexMetrics report for this site" and opens TexMetrics_RN100209931_Compliance_Report.pdf. It does not open the preview page. Do not special-case ONEOK. Do not sell or market to ONEOK employees, vendors, or contractors. Pins may exist if TCEQ data has them. Do not refuse RN100209949 or RN107914277.

## Must not break

- Leaflet map must mount. Pins, 5-year chip, Top 10 sites, selected card, pin popup must render.
- Never write review notes, debug sentences, or FAIL text into user-visible HTML (example of invalid: "showDetail still slices 12 orders").
- Do not string-replace / patch a pinned copy of `app.js`. Edit the real source files.
- Popup CTA and selected-card CTA use the same action for that RN. That action opens the preview page in a new tab and does not open a password modal. The sample RN opens the Covestro PDF instead, with no price.
- No password prompt. No mailto.

## Defaults

- Date filter default is last 5 years. Search and `?q=` use all years. A "Show all years" control switches that default 5-year view to all years and back.
- Selected card and popup order: title, customer, payable (current filter), RN, rating, Get-report CTA, at most 3 orders.
- Side list is Sites (RN), ranked by payable in the current filter.

## Out of scope

- Live Stripe keys, pack as a Stripe product, card fields on the map, $179, email blast, Framer homepage, pack UI on the map.
- Title V default-on filter and search-opens-modal until specified in a later spec that also requires the map still to render.
