import numpy as np, pandas as pd, random, json
from datetime import datetime, timedelta

rng = np.random.default_rng(42)
random.seed(42)

N = 24000
start = datetime(2022,1,1)
end = datetime(2025,8,31)
days_range = (end-start).days

countries = {
    "United States": ("North America", ["New York","Los Angeles","Chicago","Houston","Phoenix","Austin"]),
    "Canada": ("North America", ["Toronto","Vancouver","Montreal","Calgary"]),
    "United Kingdom": ("Europe", ["London","Manchester","Birmingham","Leeds"]),
    "Germany": ("Europe", ["Berlin","Munich","Hamburg","Frankfurt"]),
    "France": ("Europe", ["Paris","Lyon","Marseille"]),
    "India": ("Asia Pacific", ["Mumbai","Delhi","Bengaluru","Pune","Chennai"]),
    "Australia": ("Asia Pacific", ["Sydney","Melbourne","Brisbane"]),
    "Japan": ("Asia Pacific", ["Tokyo","Osaka","Nagoya"]),
    "Brazil": ("Latin America", ["Sao Paulo","Rio de Janeiro","Brasilia"]),
    "Mexico": ("Latin America", ["Mexico City","Guadalajara","Monterrey"]),
    "UAE": ("Middle East & Africa", ["Dubai","Abu Dhabi"]),
    "South Africa": ("Middle East & Africa", ["Johannesburg","Cape Town"]),
}
country_list = list(countries.keys())
# weight bigger economies more
country_w = [0.22,0.07,0.11,0.09,0.07,0.14,0.06,0.06,0.06,0.05,0.04,0.03]
country_w = np.array(country_w)/sum(country_w)

categories = {
    "Electronics": {
        "sub": {
            "Smartphones": ["Aeon X12","Aeon X12 Pro","Nimbus S3","Nimbus S3 Lite","Vertex Z1"],
            "Laptops": ["ProBook 14","ProBook 16 Slim","UltraLite Air","GameForge 15"],
            "Headphones": ["SoundWave ANC","SoundWave Mini","BassPro Wireless","ClearTone Buds"],
            "Cameras": ["PixelShot D5","PixelShot Mirror X","ActionCam 4K"],
            "Smart Home": ["HomeHub Mini","SecureCam Pro","SmartPlug 2-Pack","VoiceAssist Lite"],
            "Tablets": ["TabPro 11","TabPro 11 LTE","TabLite 8"],
        },
        "price": (40, 1800), "margin": (0.10,0.28)
    },
    "Apparel": {
        "sub": {
            "Men's Wear": ["Classic Oxford Shirt","Slim Fit Chinos","Everyday Hoodie"],
            "Women's Wear": ["Wrap Midi Dress","High-Rise Jeans","Cropped Blazer"],
            "Footwear": ["Trail Runner","Everyday Sneaker","Leather Loafer"],
            "Kids Wear": ["Graphic Tee Set","Fleece Joggers"],
            "Accessories": ["Woven Leather Belt","Canvas Tote","Wool Beanie"],
        },
        "price": (12, 220), "margin": (0.25,0.55)
    },
    "Home & Garden": {
        "sub": {
            "Furniture": ["Oakview Coffee Table","Linen Sofa 3-Seat","Bistro Chair Set"],
            "Decor": ["Ceramic Vase Set","Woven Wall Hanging","LED Frame Mirror"],
            "Kitchenware": ["Cast Iron Skillet","Knife Block Set","Ceramic Dinner Set"],
            "Garden Tools": ["Pruning Shears","Garden Hose 50ft","Raised Bed Kit"],
            "Lighting": ["Arc Floor Lamp","Pendant Light Set","Solar Path Lights"],
        },
        "price": (15, 950), "margin": (0.18,0.40)
    },
    "Office Supplies": {
        "sub": {
            "Stationery": ["Gel Pen 12-Pack","Notebook Bundle","Sticky Note Set"],
            "Printers": ["InkJet Compact","LaserPro Mono","AllInOne Pro"],
            "Storage": ["File Cabinet 2-Drawer","Storage Bin Set","Binder Organizer"],
            "Office Furniture": ["Ergo Task Chair","Standing Desk 48in","Monitor Arm Dual"],
            "Paper": ["Copy Paper Case","Cardstock Pack","Presentation Paper"],
        },
        "price": (3, 480), "margin": (0.15,0.35)
    },
    "Sports & Outdoors": {
        "sub": {
            "Fitness Equipment": ["Adjustable Dumbbell Set","Yoga Mat Pro","Resistance Band Kit"],
            "Camping Gear": ["2-Person Tent","Sleeping Bag 20F","Camp Stove"],
            "Cycling": ["Road Bike Helmet","Bike Repair Kit","LED Bike Light Set"],
            "Team Sports": ["Match Soccer Ball","Basketball Indoor/Outdoor","Training Cones Set"],
            "Footwear": ["Trail Hiking Boot","Running Shoe Pro"],
        },
        "price": (10, 900), "margin": (0.20,0.42)
    },
    "Beauty & Health": {
        "sub": {
            "Skincare": ["Vitamin C Serum","Daily Moisturizer SPF","Clay Cleanser"],
            "Haircare": ["Repair Shampoo","Argan Oil Treatment","Volumizing Mousse"],
            "Supplements": ["Multivitamin 90ct","Omega-3 Fish Oil","Probiotic Complex"],
            "Fragrance": ["Citrus Eau de Parfum","Woody Cologne 100ml"],
            "Wellness Devices": ["Massage Gun Mini","Sleep Sound Machine"],
        },
        "price": (5, 260), "margin": (0.30,0.60)
    },
}
cat_list = list(categories.keys())
cat_w = np.array([0.24,0.19,0.16,0.11,0.15,0.15])
cat_w = cat_w/cat_w.sum()

segments = ["Consumer","Corporate","Home Office"]
seg_w = [0.55,0.30,0.15]

channels = ["Online","In-Store","Mobile App"]
channel_w = [0.52,0.28,0.20]

payment_methods = ["Credit Card","Debit Card","PayPal","UPI","Net Banking","Cash on Delivery","Gift Card"]
payment_w = [0.34,0.20,0.16,0.10,0.08,0.08,0.04]

statuses = ["Delivered","Shipped","Processing","Cancelled","Returned"]
status_w = [0.72,0.10,0.06,0.06,0.06]

rows = []
cust_pool = [f"CUST-{i:05d}" for i in range(1, 6200)]

for i in range(N):
    oid = f"ORD-{100000+i}"
    # seasonality: boost Nov-Dec (holiday), dip Jan-Feb, general upward yearly trend
    day_offset = int(rng.integers(0, days_range))
    odate = start + timedelta(days=day_offset)
    month = odate.month
    seas = 1.0
    if month in (11,12): seas = 1.55
    elif month in (1,2): seas = 0.78
    elif month in (6,7): seas = 1.12
    yr_growth = 1 + 0.09*(odate.year - 2022)
    weight = seas*yr_growth

    country = rng.choice(country_list, p=country_w)
    region, cities = countries[country]
    city = random.choice(cities)

    cat = rng.choice(cat_list, p=cat_w)
    cinfo = categories[cat]
    sub = random.choice(list(cinfo["sub"].keys()))
    product = random.choice(cinfo["sub"][sub])
    unit_price = round(rng.uniform(*cinfo["price"]), 2)
    qty = int(rng.choice([1,1,1,2,2,3,4,5], p=[0.32,0.18,0.12,0.16,0.09,0.06,0.04,0.03]))
    margin = rng.uniform(*cinfo["margin"])

    discount = rng.choice([0,0,0,0.05,0.10,0.15,0.20,0.30], p=[0.42,0.10,0.08,0.14,0.12,0.08,0.04,0.02])
    gross = unit_price*qty
    sales = round(gross*(1-discount),2)
    cost = round(gross*(1-margin),2)
    profit = round(sales-cost,2)
    ship_cost = round(rng.uniform(2,45)*(1 if rng.random()>0.5 else 0.5),2)

    segment = rng.choice(segments, p=seg_w)
    channel = rng.choice(channels, p=channel_w)
    payment = rng.choice(payment_methods, p=payment_w)
    status = rng.choice(statuses, p=status_w)
    cust = random.choice(cust_pool)

    ship_days = int(rng.integers(1,9))
    sdate = odate + timedelta(days=ship_days)

    rows.append([oid, odate.strftime("%Y-%m-%d"), sdate.strftime("%Y-%m-%d"), cust, segment,
                 country, region, city, cat, sub, product, qty, unit_price, discount, sales, cost, profit,
                 ship_cost, payment, status, channel])

cols = ["order_id","order_date","ship_date","customer_id","customer_segment","country","region","city",
        "category","sub_category","product_name","quantity","unit_price","discount","sales","cost","profit",
        "shipping_cost","payment_method","order_status","channel"]
df = pd.DataFrame(rows, columns=cols)

# ---- inject realistic messiness ----
# 1. missing values
for col, frac in [("ship_date",0.035),("city",0.02),("discount",0.015),("payment_method",0.01),
                   ("customer_segment",0.008),("shipping_cost",0.012)]:
    idx = df.sample(frac=frac, random_state=1).index
    df.loc[idx, col] = np.nan

# 2. duplicate rows (full duplicates, simulate double submission)
dupe_idx = df.sample(frac=0.012, random_state=2).index
dupes = df.loc[dupe_idx].copy()
df = pd.concat([df, dupes], ignore_index=True)

# 3. inconsistent category casing / whitespace (data entry inconsistency)
messy_idx = df.sample(frac=0.02, random_state=3).index
def mess(v):
    choice = random.choice(["upper","lower","space"])
    if choice=="upper": return v.upper()
    if choice=="lower": return v.lower()
    return " "+v+" "
df.loc[messy_idx, "category"] = df.loc[messy_idx, "category"].apply(mess)

# 4. invalid / outlier records
neg_idx = df.sample(frac=0.004, random_state=4).index
df.loc[neg_idx, "quantity"] = -df.loc[neg_idx, "quantity"]

outlier_idx = df.sample(frac=0.003, random_state=5).index
df.loc[outlier_idx, "sales"] = df.loc[outlier_idx, "sales"] * rng.uniform(8,15,size=len(outlier_idx))
# NOTE: cost is intentionally left at its original per-unit basis (these represent unusually
# large bulk orders), and profit is always re-derived as sales-cost at the very end of this
# script so the revenue/cost/profit identity holds exactly for every row, including outliers.

zero_idx = df.sample(frac=0.002, random_state=6).index
df.loc[zero_idx, "unit_price"] = 0

# Final integrity pass: profit must always equal sales - cost, for every row (including
# outliers and any other injected messiness above), so downstream revenue/cost/profit
# reconciliation is exact.
df["profit"] = (df["sales"] - df["cost"]).round(2)

df = df.sample(frac=1, random_state=7).reset_index(drop=True)  # shuffle

df.to_csv("/home/claude/dash/raw_sales.csv", index=False)
print("RAW shape:", df.shape)
print(df.isna().sum())
print("Duplicate full rows:", df.duplicated().sum())
print(df.head(3).to_string())
