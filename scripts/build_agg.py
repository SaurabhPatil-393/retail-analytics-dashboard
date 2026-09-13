import pandas as pd, numpy as np, json

raw = pd.read_csv("/home/claude/dash/raw_sales.csv")
raw_rows, raw_cols = raw.shape

# ---------------- COLUMN-LEVEL DATA QUALITY (computed on raw, before cleaning) ----------------
def infer_status(nullpct, invalidpct):
    if nullpct > 5 or invalidpct > 2: return "Needs Attention"
    if nullpct > 0 or invalidpct > 0: return "Minor Issues"
    return "Good"

col_quality = []
numeric_cols_check = {"quantity":(lambda s: (s<0)), "unit_price":(lambda s: (s<=0)),
                       "discount":(lambda s: (s<0)|(s>1)), "sales":(lambda s: (s<0)),
                       "cost":(lambda s: (s<0)), "profit":(lambda s: pd.Series(False,index=s.index)),
                       "shipping_cost":(lambda s: (s<0))}
for c in raw.columns:
    nullpct = round(100*raw[c].isna().sum()/raw_rows,2)
    uniqpct = round(100*raw[c].nunique(dropna=True)/raw_rows,2)
    invalidpct = 0.0
    if c in numeric_cols_check:
        mask = numeric_cols_check[c](raw[c].fillna(0))
        invalidpct = round(100*mask.sum()/raw_rows,2)
    elif c in ("order_date","ship_date"):
        parsed = pd.to_datetime(raw[c], errors="coerce")
        invalidpct = round(100*(parsed.isna() & raw[c].notna()).sum()/raw_rows,2)
    dtype = str(raw[c].dtype)
    col_quality.append({"column":c, "dtype":dtype, "null_pct":nullpct, "unique_pct":uniqpct,
                         "invalid_pct":invalidpct, "status": infer_status(nullpct, invalidpct)})

raw_missing_total = int(raw.isna().sum().sum())
raw_missing_cells = raw_rows*raw_cols
raw_dupe_full = int(raw.duplicated().sum())
raw_invalid_qty = int((raw["quantity"] < 0).sum())

# ---------------- CLEANING ----------------
df = raw.copy()
df["category"] = df["category"].str.strip().str.title()
df["category"] = df["category"].str.replace(r"\s*&\s*", " & ", regex=True)

df = df.drop_duplicates()

invalid_price_dropped = int((df["unit_price"]==0).sum())
df = df[df["unit_price"] > 0]
df["quantity"] = df["quantity"].abs()

q1, q3 = df["sales"].quantile([0.25,0.75])
iqr = q3-q1
upper_fence = q3 + 3*iqr
df["is_outlier"] = df["sales"] > upper_fence
outlier_count = int(df["is_outlier"].sum())

df["customer_segment"] = df["customer_segment"].fillna("Unknown")
df["payment_method"] = df["payment_method"].fillna("Unknown")
df["city"] = df["city"].fillna("Unknown")
df["shipping_cost"] = df["shipping_cost"].fillna(df["shipping_cost"].median())
df["discount"] = df["discount"].fillna(0.0)

df["order_date"] = pd.to_datetime(df["order_date"])
df["ship_date"] = pd.to_datetime(df["ship_date"])
df["processing_days"] = (df["ship_date"] - df["order_date"]).dt.days
df["order_month"] = df["order_date"].dt.to_period("M").astype(str)
df["order_year"] = df["order_date"].dt.year
df["profit_margin"] = (df["profit"]/df["sales"]).replace([np.inf,-np.inf], np.nan)

clean_rows, clean_cols = df.shape
completeness = round(100*(1 - df.isna().sum().sum()/(clean_rows*clean_cols)),2)
validity_pct = round(100*(1 - (raw_invalid_qty+invalid_price_dropped)/raw_rows),2)
uniqueness_pct = round(100*(1 - raw_dupe_full/raw_rows),2)

quality = {
    "raw_rows": int(raw_rows), "raw_cols": int(raw_cols),
    "clean_rows": int(clean_rows), "clean_cols": int(clean_cols),
    "missing_cells_raw": raw_missing_total, "missing_pct_raw": round(100*raw_missing_total/raw_missing_cells,2),
    "duplicate_rows_removed": int(raw_dupe_full), "invalid_quantity_fixed": raw_invalid_qty,
    "invalid_price_dropped": invalid_price_dropped, "outliers_flagged": outlier_count,
    "completeness_pct": completeness, "validity_pct": validity_pct, "uniqueness_pct": uniqueness_pct,
    "rows_removed_total": int(raw_rows - clean_rows), "last_refresh": "2026-09-13",
    "column_quality": col_quality,
}
qscore = round(0.4*completeness + 0.3*validity_pct + 0.3*uniqueness_pct, 1)
quality["quality_score"] = qscore
print("Quality:", {k:v for k,v in quality.items() if k!="column_quality"})

out = {"quality": quality}
out["meta"] = {
    "categories": sorted(df["category"].unique().tolist()),
    "regions": sorted(df["region"].unique().tolist()),
    "countries": sorted(df["country"].unique().tolist()),
    "segments": sorted(df["customer_segment"].unique().tolist()),
    "channels": sorted(df["channel"].unique().tolist()),
    "statuses": sorted(df["order_status"].unique().tolist()),
    "payment_methods": sorted(df["payment_method"].unique().tolist()),
    "date_min": df["order_date"].min().strftime("%Y-%m-%d"),
    "date_max": df["order_date"].max().strftime("%Y-%m-%d"),
    "fields_available": sorted(df.columns.tolist()),
    "not_available": ["state_province", "delivery_confirmation_timestamp", "marketing_channel_attribution", "customer_acquisition_cost"],
}

valid = df[~df["order_status"].isin(["Cancelled","Returned"])]

# ---------------- RFM ----------------
max_date = df["order_date"].max()
rfm = df.groupby("customer_id").agg(
    last_order=("order_date","max"),
    frequency=("order_id","count"),
    monetary=("sales","sum"),
).reset_index()
rfm["recency_days"] = (max_date - rfm["last_order"]).dt.days
rfm["r_score"] = pd.qcut(rfm["recency_days"].rank(method="first", ascending=False), 5, labels=[1,2,3,4,5]).astype(int)
rfm["f_score"] = pd.qcut(rfm["frequency"].rank(method="first"), 5, labels=[1,2,3,4,5]).astype(int)
rfm["m_score"] = pd.qcut(rfm["monetary"].rank(method="first"), 5, labels=[1,2,3,4,5]).astype(int)

def segment_row(r):
    rr,f,m = r["r_score"], r["f_score"], r["m_score"]
    if rr>=4 and f>=4 and m>=4: return "Champions"
    if rr>=3 and f>=3: return "Loyal Customers"
    if rr>=4 and f<=2: return "New Customers"
    if rr>=3 and f<=3 and m>=3: return "Potential Loyalists"
    if rr<=2 and f>=3: return "At Risk"
    if rr<=2 and f<=2: return "Lost Customers"
    return "Needs Attention"
rfm["segment"] = rfm.apply(segment_row, axis=1)

seg_summary = rfm.groupby("segment").agg(customers=("customer_id","count"), revenue=("monetary","sum"),
                                          orders=("frequency","sum")).reset_index()
seg_summary["avg_order_value"] = round(seg_summary["revenue"]/seg_summary["orders"],2)
seg_summary["pct_customers"] = round(100*seg_summary["customers"]/seg_summary["customers"].sum(),2)
out["rfm_segments"] = seg_summary.round(2).to_dict("records")
out["customer_kpis"] = {
    "total_customers": int(rfm.shape[0]),
    "avg_customer_value": round(float(rfm["monetary"].mean()),2),
    "avg_orders_per_customer": round(float(rfm["frequency"].mean()),2),
}

# ---------------- COHORT RETENTION MATRIX ----------------
first_purchase = df.groupby("customer_id")["order_date"].min().dt.to_period("M")
df["cohort_period"] = df["customer_id"].map(first_purchase)
df["order_period"] = df["order_date"].dt.to_period("M")
df["month_offset"] = (df["order_period"] - df["cohort_period"]).apply(lambda x: x.n)
cohort_sizes = df[df["month_offset"]==0].groupby("cohort_period")["customer_id"].nunique()
cohort_counts = df.groupby(["cohort_period","month_offset"])["customer_id"].nunique().reset_index()
cohorts_sorted = sorted(cohort_sizes.index)
max_offset = min(11, int(df["month_offset"].max()))
cohort_matrix = []
for cp in cohorts_sorted:
    size = int(cohort_sizes[cp])
    if size < 15:
        continue
    row = {"cohort": str(cp), "size": size, "retention": []}
    for off in range(0, max_offset+1):
        rec = cohort_counts[(cohort_counts["cohort_period"]==cp)&(cohort_counts["month_offset"]==off)]
        cnt = int(rec["customer_id"].iloc[0]) if len(rec) else 0
        row["retention"].append(round(100*cnt/size,1))
    cohort_matrix.append(row)
out["cohort_matrix"] = cohort_matrix

repeat_rate = round(100*float((df.groupby("customer_id")["order_period"].nunique()>1).mean()),2)
out["cohort"] = {"repeat_customer_rate_pct": repeat_rate, "one_time_pct": round(100-repeat_rate,2)}

# ---------------- FORECAST (daily, linear trend + confidence interval) ----------------
daily = valid.groupby(valid["order_date"].dt.date)["sales"].sum()
full_idx = pd.date_range(daily.index.min(), daily.index.max(), freq="D")
daily = daily.reindex(full_idx, fill_value=0)
last90 = daily.tail(90)
x = np.arange(len(last90))
coeffs = np.polyfit(x, last90.values, 1)
fitted = np.polyval(coeffs, x)
resid_std = float(np.std(last90.values - fitted))
horizons = {}
for h, label in [(30,"30d"), (60,"60d"), (90,"90d")]:
    fx = np.arange(len(last90), len(last90)+h)
    fvals = np.polyval(coeffs, fx)
    fvals = np.clip(fvals, 0, None)
    ci = 1.28 * resid_std * np.sqrt(1 + (fx-len(last90))/len(last90))
    horizons[label] = {"forecast": [round(float(v),2) for v in fvals],
                        "upper": [round(float(v+c),2) for v,c in zip(fvals,ci)],
                        "lower": [round(float(max(0,v-c)),2) for v,c in zip(fvals,ci)]}
out["forecast_daily"] = {
    "history_dates": [d.strftime("%Y-%m-%d") for d in last90.index],
    "history_sales": [round(float(v),2) for v in last90.values],
    "horizons": horizons,
}

out["kpis"] = {"unique_customers": int(df["customer_id"].nunique())}

# ---------------- ENCODED RECORD SET ----------------
lk_segment = sorted(df["customer_segment"].unique().tolist())
lk_country = sorted(df["country"].unique().tolist())
lk_region = sorted(df["region"].unique().tolist())
lk_category = sorted(df["category"].unique().tolist())
lk_subcat = sorted(df["sub_category"].unique().tolist())
lk_product = sorted(df["product_name"].unique().tolist())
lk_payment = sorted(df["payment_method"].unique().tolist())
lk_status = sorted(df["order_status"].unique().tolist())
lk_channel = sorted(df["channel"].unique().tolist())
lk_city = sorted(df["city"].unique().tolist())

idx_of = lambda lst: {v:i for i,v in enumerate(lst)}
seg_i, cty_i, reg_i, cat_i, sub_i, pay_i, sta_i, cha_i, city_i, prod_i = (
    idx_of(lk_segment), idx_of(lk_country), idx_of(lk_region), idx_of(lk_category), idx_of(lk_subcat),
    idx_of(lk_payment), idx_of(lk_status), idx_of(lk_channel), idx_of(lk_city), idx_of(lk_product))

records = []
for r in df.itertuples(index=False):
    records.append([
        r.order_id, r.order_date.strftime("%Y-%m-%d"),
        seg_i[r.customer_segment], cty_i[r.country], reg_i[r.region], city_i[r.city],
        cat_i[r.category], sub_i[r.sub_category], prod_i[r.product_name],
        int(r.quantity), float(r.unit_price), float(r.discount),
        round(float(r.sales),2), round(float(r.cost),2), round(float(r.profit),2),
        pay_i[r.payment_method], sta_i[r.order_status], cha_i[r.channel],
        1 if r.is_outlier else 0,
        int(r.processing_days) if pd.notna(r.processing_days) else -1,
        r.customer_id,
    ])

out["lookups"] = {"segment": lk_segment, "country": lk_country, "region": lk_region, "city": lk_city,
                   "category": lk_category, "subcategory": lk_subcat, "product": lk_product,
                   "payment": lk_payment, "status": lk_status, "channel": lk_channel}
out["record_cols"] = ["order_id","date","seg","country","region","city","cat","subcat","product",
                       "qty","unit_price","discount","sales","cost","profit","payment","status","channel",
                       "outlier","processing_days","customer_id"]
out["records"] = records

with open("/home/claude/dash/dashboard_data.json","w") as f:
    json.dump(out, f)

import os
print("JSON size MB:", os.path.getsize("/home/claude/dash/dashboard_data.json")/1e6)
print("RFM segments:", out["rfm_segments"])
print("Cohorts kept:", len(cohort_matrix))
