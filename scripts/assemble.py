"""
Assembles the final self-contained dashboard HTML from:
  - scripts/template.html   (page shell + CSS, with __DATA_JSON__ and __CHARTJS_INLINE__ placeholders)
  - scripts/app.js          (all dashboard logic: filtering, date intelligence, RFM, cohorts,
                              forecasting, anomaly detection, charts, table, tab routing)
  - data/dashboard_data.json (precomputed aggregates + encoded full record set)
  - scripts/vendor/chart.umd.min.js (Chart.js v4.5.1, inlined so the file has zero external deps)

Run from the project root:
    python3 scripts/assemble.py
Outputs: output/retail_analytics_dashboard.html
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, "scripts", "template.html")) as f:
    tpl = f.read()
with open(os.path.join(ROOT, "scripts", "app.js")) as f:
    appjs = f.read()
with open(os.path.join(ROOT, "data", "dashboard_data.json")) as f:
    data = f.read()
with open(os.path.join(ROOT, "scripts", "vendor", "chart.umd.min.js")) as f:
    chartjs = f.read()

tpl = tpl.replace("__CHARTJS_INLINE__", chartjs)
tpl = tpl.replace('<script src="app.js"></script>', "<script>\n" + appjs + "\n</script>")
tpl = tpl.replace("__DATA_JSON__", data)

out_path = os.path.join(ROOT, "output", "retail_analytics_dashboard.html")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w") as f:
    f.write(tpl)

print(f"Wrote {out_path} ({os.path.getsize(out_path)/1e6:.2f} MB)")
