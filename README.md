# Retail Analytics Command Center

A self-contained, enterprise-style BI dashboard built on a synthetic (but realistic and
intentionally messy) global retail sales dataset — 24,288 raw orders, 2022–2025, 12 countries,
6 categories, ~150 products. No file was uploaded for this task, so the dataset was generated to
be representative of real-world retail data, including missing values, duplicate rows, sign
errors, inconsistent text casing, and true statistical outliers — the cleaning, data-quality, and
reconciliation sections are computed from that mess, not staged.

## Just want the dashboard?

Open **`output/retail_analytics_dashboard.html`** in any browser. It's fully self-contained
(Chart.js is inlined, not loaded from a CDN) — no server, no internet connection required.

## Project structure

```
data/
  raw_sales.csv          Raw generated dataset, pre-cleaning (24,288 rows, with injected issues)
  dashboard_data.json    Cleaned + aggregated data consumed by the dashboard: KPIs, RFM segments,
                          cohort retention matrix, forecast (with confidence bands), column-level
                          data quality, and the full cleaned record set (compact-encoded) that
                          drives all client-side filtering

scripts/
  gen_data.py             Generates raw_sales.csv (synthetic but realistic sales data + messiness).
                          Profit is always re-derived as sales − cost as a final integrity pass,
                          so revenue/cost/profit reconcile exactly for every row.
  build_agg.py             Cleans raw_sales.csv, computes RFM segmentation, cohort retention,
                          column-level data quality, 30/60/90-day forecast with confidence
                          intervals, and writes dashboard_data.json
  template.html             Page shell: layout, CSS (dark "command center" design tokens),
                          placeholders for the data and chart library
  app.js                    All dashboard logic — ~1,200 lines covering: date-intelligence engine
                          (MTD/QTD/YTD/custom range with auto-matched comparison periods),
                          12-tab navigation, category/geography drill-down with cross-filtering,
                          RFM + cohort rendering, revenue-change decomposition, anomaly detection,
                          forecasting, the detail table (search/multi-sort/pagination/column
                          visibility/CSV export)
  vendor/chart.umd.min.js   Chart.js v4.5.1 (MIT), vendored so the final file has no external
                          dependencies
  assemble.py                Stitches template.html + app.js + dashboard_data.json + Chart.js
                          into the single output HTML file

output/
  retail_analytics_dashboard.html   The final deliverable
```

## Rebuilding from scratch

```bash
cd scripts
python3 gen_data.py        # -> ../data/raw_sales.csv
python3 build_agg.py       # -> ../data/dashboard_data.json
python3 assemble.py        # -> ../output/retail_analytics_dashboard.html
```

Requires `pandas` and `numpy` (`pip install pandas numpy`).

## What's covered

**Navigation:** Overview · Trends · Products · Customers · Segments · Geography · Profitability ·
Operations · Advanced Analytics · Data Quality · Insights · Detail Table

**Date intelligence:** Custom range / MTD / QTD / YTD, each with an automatically matched
comparison period (previous period of equal length, or previous year) — never an arbitrary
comparison.

**KPIs:** every card is filter-aware, shows current value, % change vs. the selected comparison
period, and a sparkline. Filter-aware metrics vs. full-dataset metrics (RFM, cohorts, forecast)
are labeled explicitly in the UI.

**Drill-down:** clicking a category bar (Products tab) or a region/country bar (Geography tab)
sets the corresponding global filter and cross-filters the whole dashboard; a breadcrumb shows
the current drill level and resets it.

**Advanced analytics:** RFM customer segmentation, cohort retention heatmap, Pareto analysis,
discount-vs-margin correlation, 30/60/90-day revenue forecast with confidence bands (clearly
separated ACTUAL vs FORECAST), statistical anomaly detection (revenue, category, return-rate),
and a revenue-change decomposition (volume effect + price/AOV effect, which reconcile exactly to
the total change; a by-category breakdown as a second, independent exact partition).

**Data quality:** dataset-level and column-level (null %, unique %, invalid %, status), with
completeness / validity / uniqueness / composite quality score.

**Known, disclosed data limitations** (the dashboard states these rather than fabricating
answers): no state/province field (city is the finest geography level), no delivery-confirmation
timestamp beyond ship date, no marketing-channel attribution or customer acquisition cost — so
"Target" KPI cards and per-order delivery SLAs were intentionally left out rather than invented.

**Reconciliation:** revenue-by-category sums to the Total Revenue KPI, orders-by-status sums to
Total Orders, and profit = revenue − cost exactly, for every row — verified programmatically, not
just visually.
