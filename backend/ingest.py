#!/usr/bin/env python3
"""
Baja Motor EW Pricing — Data Ingestion Script
Reads Excel pricelist (18 brand sheets) and populates Supabase.

Usage:
  pip install openpyxl supabase python-dotenv
  python ingest.py

Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env before running.
"""

import os, re, sys, io, time, uuid as _uuid
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl

EXCEL_PATH = r"E:\OneDrive - Salasar Services Pvt. Ltd\Desktop\Baja Motor Extended Warranty  Retail Pricelist_2026.xlsx"

# ── SQL-generation mode (python ingest.py --sql) ──────────────────────────────
SQL_MODE = "--sql" in sys.argv
_SQL: list[str] = []

def _q(s) -> str:
    """Escape a value for SQL string literals."""
    return str(s).replace("'", "''") if s is not None else "NULL"

# ── Live-Supabase mode ────────────────────────────────────────────────────────
if not SQL_MODE:
    from supabase import create_client, Client
    from dotenv import load_dotenv
    load_dotenv()
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env")
        sys.exit(1)
    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def sb_execute(query, retries=6, delay=15):
    """Execute a PostgREST query with retries for transient Supabase gateway errors."""
    for attempt in range(retries):
        try:
            return query.execute()
        except Exception as e:
            msg = str(e)
            if attempt < retries - 1 and any(c in msg for c in ("502", "520", "503", "504", "could not be generated")):
                wait = delay * (attempt + 1)
                print(f"  [retry {attempt+1}/{retries-1}] Supabase gateway error — waiting {wait}s…", flush=True)
                time.sleep(wait)
            else:
                raise

# ── Caches (avoid redundant DB round-trips) ────────────────────────────────────
_brand_cache:   dict[str, str] = {}
_model_cache:   dict[tuple, str] = {}
_variant_cache: dict[tuple, str] = {}

# ── Name-lookup maps used only in SQL_MODE (uuid → human name) ────────────────
_brand_by_id:   dict[str, str]         = {}  # brand_uuid  → brand_name
_model_by_id:   dict[str, tuple]       = {}  # model_uuid  → (brand_name, model_name)
_variant_by_id: dict[str, tuple]       = {}  # variant_uuid→ (brand_name, model_name, variant_name)

def _safe_int(v):
    try: return int(v)
    except (ValueError, TypeError): return None

# ── DB helpers ─────────────────────────────────────────────────────────────────

def get_or_create_brand(name: str) -> str:
    name = name.strip()
    if name not in _brand_cache:
        if SQL_MODE:
            bid = str(_uuid.uuid4())
            _brand_cache[name] = bid
            _brand_by_id[bid] = name
            # Use INSERT … ON CONFLICT DO NOTHING so existing brand rows are left intact.
            # All child inserts use a SELECT subquery on brand name so the actual DB uuid is used.
            _SQL.append(f"INSERT INTO brands (id, name) VALUES ('{bid}', '{_q(name)}') ON CONFLICT DO NOTHING;")
        else:
            res = sb_execute(sb.table("brands").upsert({"name": name}, on_conflict="name"))
            _brand_cache[name] = res.data[0]["id"]
    return _brand_cache[name]


def get_or_create_model(brand_id: str, name: str) -> str:
    name = name.strip()
    key = (brand_id, name)
    if key not in _model_cache:
        if SQL_MODE:
            mid = str(_uuid.uuid4())
            _model_cache[key] = mid
            brand_name = _brand_by_id[brand_id]
            _model_by_id[mid] = (brand_name, name)
            # Look up brand by NAME so it works whether the brand was just inserted or already existed
            _SQL.append(
                f"INSERT INTO models (id, brand_id, name) "
                f"SELECT '{mid}', b.id, '{_q(name)}' FROM brands b WHERE b.name = '{_q(brand_name)}' "
                f"ON CONFLICT DO NOTHING;"
            )
        else:
            res = sb_execute(sb.table("models").select("id").eq("brand_id", brand_id).eq("name", name))
            if res.data:
                _model_cache[key] = res.data[0]["id"]
            else:
                r = sb_execute(sb.table("models").insert({"brand_id": brand_id, "name": name}))
                _model_cache[key] = r.data[0]["id"]
    return _model_cache[key]


def get_or_create_variant(model_id: str, name: str, fuel: str,
                          transmission: str, oem_months, oem_kms) -> str:
    name = name.strip()
    key = (model_id, name)
    if key not in _variant_cache:
        if SQL_MODE:
            vid = str(_uuid.uuid4())
            _variant_cache[key] = vid
            brand_name, model_name = _model_by_id[model_id]
            _variant_by_id[vid] = (brand_name, model_name, name)
            oem_m = _safe_int(oem_months)
            oem_k = _safe_int(oem_kms)
            _SQL.append(
                f"INSERT INTO variants (id, model_id, name, fuel, transmission, oem_warranty_months, oem_warranty_kms) "
                f"SELECT '{vid}', m.id, '{_q(name)}', '{_q(fuel)}', '{_q(transmission)}', "
                f"{oem_m if oem_m is not None else 'NULL'}, {oem_k if oem_k is not None else 'NULL'} "
                f"FROM models m JOIN brands b ON m.brand_id = b.id "
                f"WHERE b.name = '{_q(brand_name)}' AND m.name = '{_q(model_name)}' "
                f"ON CONFLICT DO NOTHING;"
            )
        else:
            res = sb_execute(sb.table("variants").select("id").eq("model_id", model_id).eq("name", name))
            if res.data:
                _variant_cache[key] = res.data[0]["id"]
            else:
                r = sb_execute(sb.table("variants").insert({
                    "model_id": model_id, "name": name, "fuel": fuel,
                    "transmission": transmission,
                    "oem_warranty_months": _safe_int(oem_months),
                    "oem_warranty_kms":   _safe_int(oem_kms),
                }))
                _variant_cache[key] = r.data[0]["id"]
    return _variant_cache[key]


def insert_plan_with_tiers(variant_id: str, plan_name: str,
                           duration_months: int, max_kms,
                           tiers: list[tuple[int, int, float]]):
    """Insert a plan + its tier rows (skip if price is invalid)."""
    valid = [(mn, mx, p) for mn, mx, p in tiers if p is not None and p > 0]
    if not valid:
        return
    if SQL_MODE:
        pid = str(_uuid.uuid4())
        max_k = int(max_kms) if max_kms else "NULL"
        brand_name, model_name, variant_name = _variant_by_id[variant_id]
        # Subselect variant by name chain — works with any existing uuid in the DB
        v_sel = (
            f"(SELECT v.id FROM variants v "
            f"JOIN models m ON v.model_id = m.id "
            f"JOIN brands b ON m.brand_id = b.id "
            f"WHERE b.name = '{_q(brand_name)}' AND m.name = '{_q(model_name)}' AND v.name = '{_q(variant_name)}')"
        )
        _SQL.append(
            f"INSERT INTO plans (id, variant_id, plan_name, duration_months, max_kms) "
            f"SELECT '{pid}', {v_sel}, '{_q(plan_name)}', {duration_months}, {max_k} "
            f"ON CONFLICT DO NOTHING;"
        )
        for mn, mx, p in valid:
            # Look up the real plan_id by variant+plan_name+duration (handles pre-existing plans)
            p_sel = (
                f"(SELECT p.id FROM plans p WHERE p.variant_id = {v_sel} "
                f"AND p.plan_name = '{_q(plan_name)}' AND p.duration_months = {duration_months})"
            )
            _SQL.append(
                f"INSERT INTO tiers (plan_id, min_days, max_days, price_inr, is_active) "
                f"SELECT {p_sel}, {mn}, {mx}, {round(p,2)}, TRUE "
                f"ON CONFLICT DO NOTHING;"
            )
        return
    # ── Live mode ──────────────────────────────────────────────────────────────
    existing = sb_execute(
        sb.table("plans")
        .select("id")
        .eq("variant_id", variant_id)
        .eq("plan_name", plan_name)
        .eq("duration_months", duration_months)
    )
    if existing.data:
        plan_id = existing.data[0]["id"]
    else:
        r = sb_execute(sb.table("plans").insert({
            "variant_id":      variant_id,
            "plan_name":       plan_name,
            "duration_months": duration_months,
            "max_kms":         int(max_kms) if max_kms else None,
        }))
        plan_id = r.data[0]["id"]
    for mn, mx, p in valid:
        try:
            sb_execute(sb.table("tiers").insert(
                {"plan_id": plan_id, "min_days": mn, "max_days": mx,
                 "price_inr": round(p, 2), "is_active": True}
            ))
        except Exception as e:
            if "23505" not in str(e):
                raise

# ── Value helpers ──────────────────────────────────────────────────────────────

def to_price(val) -> float | None:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        v = float(val)
        return v if v > 0 else None
    s = re.sub(r"[^\d.]", "", str(val).replace(",", "").strip())
    return float(s) if s else None


def norm_fuel(raw) -> str:
    m = {
        "p": "Petrol", "petrol": "Petrol", "gasoline": "Petrol",
        "d": "Diesel", "diesel": "Diesel",
        "cng": "CNG",
        "ev": "EV", "b": "EV", "bev": "EV", "electric": "EV",
        "ph": "Hybrid", "phv": "Hybrid", "phev": "Hybrid",
        "hybrid": "Hybrid", "mild hybrid": "Hybrid",
        "p/d": "Petrol/Diesel", "diesel & petrol": "Petrol/Diesel",
        "na": "N/A", "n/a": "N/A",
    }
    return m.get(str(raw).strip().lower(), str(raw).strip())


def norm_trans(raw) -> str:
    m = {
        "mt": "Manual", "m/t": "Manual", "manual": "Manual",
        "at": "Automatic", "a/t": "Automatic", "automatic": "Automatic",
        "amt": "AMT", "cvt": "CVT", "dca": "DCA",
        "all variants": "All", "na": "N/A", "n/a": "N/A",
    }
    return m.get(str(raw).strip().lower(), str(raw).strip())


def rows(ws) -> list:
    return list(ws.iter_rows(values_only=True))

# ══════════════════════════════════════════════════════════════════════════════
# BRAND PARSERS
# ══════════════════════════════════════════════════════════════════════════════

# ── KIA ────────────────────────────────────────────────────────────────────────
# Row 1: plan headers | Row 2: km limits | Row 3+: model | age | 4 prices

KIA_PLANS = [
    ("4th Year / 100,000 Kms",       12, 100000),
    ("4th Year / Unlimited Kms",     12, None),
    ("4th & 5th Year / 120,000 Kms", 24, 120000),
    ("4th & 5th Year / Unlimited Kms", 24, None),
]
KIA_AGE = {
    "0-3 months":   (0,   90),
    "4-12 months":  (91,  365),
    "13-24 months": (366, 730),
    "25-34 months": (731, 1020),
}


def kia_models_from_cell(text: str) -> list[tuple[str, str]]:
    """
    'Seltos / The New Seltos - Petrol / Carens - Diesel'
    → [('Seltos', 'Petrol'), ('The New Seltos', 'Petrol'), ('Carens', 'Diesel')]
    """
    fuel_default = "Petrol"
    last_fuel = fuel_default
    out = []
    for part in str(text).split("/"):
        part = part.strip()
        fuel = last_fuel
        for tag in [("- Diesel", "Diesel"), ("-Diesel", "Diesel"),
                    ("- Petrol", "Petrol"), ("-Petrol", "Petrol"),
                    ("- CNG", "CNG"),    ("-CNG", "CNG"),
                    ("- EV", "EV"),      ("- Electric", "EV")]:
            if tag[0] in part:
                fuel = tag[1]
                part = part.replace(tag[0], "").strip()
                break
        else:
            if "EV" in part:
                fuel = "EV"
        last_fuel = fuel
        if part:
            out.append((part.strip(), fuel))
    return out


def ingest_kia(wb):
    brand_id = get_or_create_brand("Kia")
    data = rows(wb["Kia"])
    cur_model_cell = None

    for row in data[2:]:
        if row[0] is not None:
            cur_model_cell = str(row[0]).strip()
        if not cur_model_cell or row[1] is None:
            continue
        tier_key = str(row[1]).strip().lower()
        tier_range = KIA_AGE.get(tier_key)
        if tier_range is None:
            continue
        prices = [to_price(row[i]) for i in range(2, 6)]
        if all(p is None for p in prices):
            continue

        for model_name, fuel in kia_models_from_cell(cur_model_cell):
            model_id   = get_or_create_model(brand_id, model_name)
            variant_id = get_or_create_variant(model_id, model_name,
                                               fuel, "N/A", 36, 100000)
            for idx, (plan_name, dur, kms) in enumerate(KIA_PLANS):
                p = prices[idx]
                if p:
                    insert_plan_with_tiers(variant_id, plan_name, dur, kms,
                                           [(tier_range[0], tier_range[1], p)])

    print("✓ Kia")


# ── TATA ───────────────────────────────────────────────────────────────────────
# Sectional: MODEL header → PLAN header (with km limit) → variant rows | 3 day cols

TATA_DAYS = {
    "0-90 days":       (0,   90),
    "91-180 days":     (91,  180),
    "above 180 days":  (181, 1095),
}


def tata_parse_plan(header: str) -> tuple[str, int, int | None]:
    """
    'Additional 1 year or up to 100000km (whichever is earlier)'
    → ('Add 1 Yr / 100,000 Kms', 12, 100000)
    """
    h = header.strip()
    # years
    yr_m = re.search(r"(\d)\s+year", h, re.I)
    years = int(yr_m.group(1)) if yr_m else 1
    dur = years * 12
    # kms
    km_m = re.search(r"(\d[\d,]+)\s*km", h, re.I)
    kms  = int(km_m.group(1).replace(",", "")) if km_m else None
    km_str = f"{kms:,} Kms".replace(",", ",") if kms else "Unlimited Kms"
    name = f"Add {years} Yr / {km_str}" if kms else f"Add {years} Yr / Unlimited Kms"
    return name, dur, kms


def ingest_tata(wb):
    brand_id = get_or_create_brand("Tata")
    data = rows(wb["Tata"])

    cur_model = None      # e.g. "TIAGO"
    cur_plan  = None      # (plan_name, dur_months, max_kms)
    day_cols  = None      # list of (col_idx, min_d, max_d)

    # We accumulate tiers per (variant, plan) then batch-insert
    # tier_acc[(variant_id, plan_name)] = [(min,max,price)]
    tier_acc: dict[tuple, list] = {}

    def flush():
        for (vid, pname), tiers in tier_acc.items():
            # find dur/kms from plan name stored alongside
            dur, kms = plan_meta.get(pname, (12, None))
            insert_plan_with_tiers(vid, pname, dur, kms, tiers)
        tier_acc.clear()
        plan_meta.clear()

    plan_meta: dict[str, tuple] = {}

    for row in data:
        if row[0] is None and row[1] is None:
            continue
        cell0 = str(row[0]).strip() if row[0] is not None else ""
        cell1 = str(row[1]).strip() if row[1] is not None else ""

        # Model header (col B = "Days from Date of sale")
        if "days from date of sale" in cell1.strip().lower():
            flush()
            cur_model = cell0
            cur_plan  = None
            day_cols  = None
            continue

        # Plan sub-header (col A contains "Additional ... year")
        if "additional" in cell0.lower() and ("year" in cell0.lower() or "yr" in cell0.lower()):
            cur_plan = tata_parse_plan(cell0)
            plan_meta[cur_plan[0]] = (cur_plan[1], cur_plan[2])
            # Day cols may be on the same row (col B/C/D) or a separate subsequent row
            inline_days = []
            for ci in range(1, len(row)):
                v = str(row[ci]).strip().lower() if row[ci] is not None else ""
                tr = TATA_DAYS.get(v)
                if tr:
                    inline_days.append((ci, tr[0], tr[1]))
            if inline_days:
                day_cols = inline_days
            # else keep existing day_cols inherited from the previous plan section
            continue

        # Day column header row (contains day range strings in B/C/D)
        if any(k in cell1.lower() for k in ("0-90", "91-180", "above 180", "days")):
            day_cols = []
            for ci in range(1, len(row)):
                v = str(row[ci]).strip().lower() if row[ci] is not None else ""
                tr = TATA_DAYS.get(v)
                if tr:
                    day_cols.append((ci, tr[0], tr[1]))
            continue

        # Data row: col A = variant name, col B/C/D = prices
        if cur_model and cur_plan and day_cols and cell0:
            variant_name = cell0
            # Infer fuel & transmission from variant name
            fuel = "Petrol"
            if "diesel" in variant_name.lower():   fuel = "Diesel"
            elif " cng" in variant_name.lower():   fuel = "CNG"
            elif "ev" in variant_name.lower():     fuel = "EV"
            elif "electric" in variant_name.lower(): fuel = "EV"

            trans = "Manual"
            if " amt" in variant_name.lower():  trans = "AMT"
            elif " dca" in variant_name.lower(): trans = "DCA"
            elif " at " in variant_name.lower(): trans = "Automatic"

            model_id   = get_or_create_model(brand_id, cur_model)
            variant_id = get_or_create_variant(model_id, variant_name,
                                               fuel, trans, 36, 100000)
            key = (variant_id, cur_plan[0])
            if key not in tier_acc:
                tier_acc[key] = []
            for ci, mn, mx in day_cols:
                p = to_price(row[ci]) if ci < len(row) else None
                if p:
                    tier_acc[key].append((mn, mx, p))

    flush()
    print("✓ Tata")


# ── HYUNDAI ────────────────────────────────────────────────────────────────────
# Row 1: model header + plan names | Row 2: day-range sub-headers | Row 3+: data
# 3 plans × 3 day buckets = 9 price cols  (+possible extras we ignore)

HYUNDAI_PLANS = [
    ("4th YR / 80K kms",               12, 80000),
    ("4th & 5th YR / 100K kms",        24, 100000),
    ("4th, 5th, 6th & 7th YR / 140K kms", 48, 140000),
]
HYUNDAI_DAYS = [(0, 90), (91, 365), (366, 1095)]


def ingest_hyundai(wb):
    brand_id = get_or_create_brand("Hyundai")
    data = rows(wb["Hyundai"])
    cur_model = None

    for row in data[2:]:          # skip 2 header rows
        if row[0] is not None:
            cur_model = str(row[0]).strip()
        if not cur_model or row[1] is None:
            continue
        fuel_trans = str(row[1]).strip()
        if "fuel" in fuel_trans.lower() or fuel_trans == "":
            continue

        # Parse fuel/transmission from strings like "Petrol-M/T", "CNG-M/T"
        parts = fuel_trans.split("-")
        fuel  = norm_fuel(parts[0].strip())
        trans = norm_trans(parts[1].strip()) if len(parts) > 1 else "N/A"

        # 9 price cols starting at index 2
        prices = [to_price(row[2 + i]) if (2 + i) < len(row) else None
                  for i in range(9)]

        variant_name = f"{cur_model} {fuel_trans}"
        model_id   = get_or_create_model(brand_id, cur_model)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, trans, 36, 100000)

        for p_idx, (plan_name, dur, kms) in enumerate(HYUNDAI_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(HYUNDAI_DAYS):
                price = prices[p_idx * 3 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Hyundai")


# ── RENAULT ────────────────────────────────────────────────────────────────────
# Row 3: headers (Model, EW Plan/Kms, 0-90, 91-365, 366-730, 731-1095)
# Row 4+: data rows (model may be None = carry-forward, plan always present)

RENAULT_DAYS = [(0, 90), (91, 365), (366, 730), (731, 1095)]


def renault_parse_plan(plan_str: str) -> tuple[str, int, int | None]:
    """
    '3+2 Year (5 Years / 1L Kms)' → ('3+2 Yr / 1,00,000 Kms', 24, 100000)
    '3+4 Year (7 Years / Unlimited Kms)' → ('3+4 Yr / Unlimited Kms', 48, None)
    """
    s = str(plan_str).strip()
    # duration: years added = number after +
    add_m = re.search(r"\+(\d+)\s*year", s, re.I)
    added_yrs = int(add_m.group(1)) if add_m else 1
    dur = added_yrs * 12
    # km
    if "unlimited" in s.lower():
        return s, dur, None
    km_m = re.search(r"([\d.]+)L\s*Kms?", s, re.I)
    if km_m:
        kms = int(float(km_m.group(1)) * 100000)
    else:
        km_m2 = re.search(r"([\d,]+)\s*km", s, re.I)
        kms = int(km_m2.group(1).replace(",", "")) if km_m2 else None
    return s, dur, kms


def ingest_renault(wb):
    brand_id = get_or_create_brand("Renault")
    data = rows(wb["Renault"])
    cur_model = None
    cur_fuel  = "Petrol"

    for row in data[3:]:       # skip 3 header rows
        if row[0] is None and row[1] is None:
            continue
        # Detect fuel header rows like "Model (Diesel)"
        cell0 = str(row[0]).strip() if row[0] is not None else ""
        if "model" in cell0.lower() and ("diesel" in cell0.lower() or "petrol" in cell0.lower()):
            cur_fuel = "Diesel" if "diesel" in cell0.lower() else "Petrol"
            continue
        if row[0] is not None:
            cur_model = cell0
        if not cur_model or row[1] is None:
            continue
        if "ew plan" in str(row[1]).lower() or "plan" in str(row[1]).lower():
            continue

        plan_str = str(row[1]).strip()
        plan_name, dur, kms = renault_parse_plan(plan_str)
        prices = [to_price(row[2 + i]) if (2 + i) < len(row) else None
                  for i in range(4)]

        model_id   = get_or_create_model(brand_id, cur_model)
        variant_id = get_or_create_variant(model_id, cur_model,
                                           cur_fuel, "N/A", 36, 100000)
        tiers = [(mn, mx, p) for (mn, mx), p in zip(RENAULT_DAYS, prices) if p]
        if tiers:
            insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Renault")


# ── MARUTI (uses "Maruti New" sheet) ───────────────────────────────────────────
# Col layout: VARIANT | Make | Model | Fuel | Trans | OEM_M | OEM_KM |
#   12M/20K×4 | 24M/40K×4 | 36M/60K×4

MARUTI_PLANS = [
    ("12 Months / 20,000 Kms", 12, 20000),
    ("24 Months / 40,000 Kms", 24, 40000),
    ("36 Months / 60,000 Kms", 36, 60000),
]
MARUTI_DAYS = [(0, 30), (31, 365), (366, 730), (731, 1095)]


def ingest_maruti(wb):
    brand_id = get_or_create_brand("Maruti")
    data = rows(wb["Maruti New"])

    for row in data[3:]:       # skip 3 header rows
        if row[0] is None or str(row[0]).strip().upper() == "VARIANT":
            continue
        variant_name = str(row[0]).strip()
        model_name   = str(row[2]).strip() if row[2] else variant_name
        fuel_raw     = str(row[3]).strip() if row[3] else "P"
        trans_raw    = str(row[4]).strip() if row[4] else "Manual"
        oem_m        = row[5]
        oem_k        = row[6]

        fuel  = norm_fuel(fuel_raw)
        trans = norm_trans(trans_raw)

        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, trans, oem_m, oem_k)

        for p_idx, (plan_name, dur, kms) in enumerate(MARUTI_PLANS):
            base = 7 + p_idx * 4    # col index of first day bucket for this plan
            tiers = []
            for d_idx, (mn, mx) in enumerate(MARUTI_DAYS):
                ci = base + d_idx
                price = to_price(row[ci]) if ci < len(row) else None
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Maruti")


# ── MAHINDRA ───────────────────────────────────────────────────────────────────
# Row 3-4: plan headers + day buckets | Row 6+: model | trans | fuel | 6 prices
# Plans: 4th Yr/120K (3 day buckets) | 4th & 5th Yr/150K (3 day buckets)

MAHINDRA_PLANS = [
    ("4th Year / 120,000 Kms",       12, 120000),
    ("4th & 5th Year / 150,000 Kms", 24, 150000),
]
MAHINDRA_DAYS = [(0, 60), (61, 730), (731, 1095)]


def ingest_mahindra(wb):
    brand_id = get_or_create_brand("Mahindra")
    data = rows(wb["Mahindra"])
    cur_model = None

    for row in data[5:]:      # skip 5 header rows
        if row[0] is None and row[1] is None and row[2] is None:
            continue
        if row[0] is not None:
            cur_model = str(row[0]).strip()
        if not cur_model:
            continue
        trans_raw = str(row[1]).strip() if row[1] is not None else "N/A"
        fuel_raw  = str(row[2]).strip() if row[2] is not None else "N/A"
        if trans_raw.lower() in ("trasmission", "transmission", ""):
            continue

        fuel  = norm_fuel(fuel_raw)
        trans = norm_trans(trans_raw)

        prices = [to_price(row[3 + i]) if (3 + i) < len(row) else None
                  for i in range(6)]

        variant_name = f"{cur_model} {fuel} {trans}".strip()
        model_id   = get_or_create_model(brand_id, cur_model)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, trans, 36, 100000)

        for p_idx, (plan_name, dur, kms) in enumerate(MAHINDRA_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(MAHINDRA_DAYS):
                price = prices[p_idx * 3 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Mahindra")


# ── CITROEN ────────────────────────────────────────────────────────────────────
# Multiple sub-tables each starting with a "Prices with GST" sentinel row,
# then a plan-header row and a day-range row, then data rows.

def citroen_parse_plans(header_row, day_row):
    """
    Returns list of (plan_name, dur_months, max_kms, [(col_idx, min_d, max_d)])
    from the two header rows.
    """
    # Collect plan column ranges
    plans = []
    i = 5   # prices start at col index 5 (after Model, Fuel, Variant, OEM_M, OEM_KM)
    col = i
    while col < len(header_row):
        plan_raw = str(header_row[col]).strip() if header_row[col] else ""
        if not plan_raw or plan_raw.lower() in ("none", ""):
            col += 1
            continue
        # Gather contiguous day-range sub-columns
        tier_cols = []
        c2 = col
        while c2 < len(day_row):
            dr = str(day_row[c2]).strip() if day_row[c2] else ""
            if dr and re.search(r"\d", dr):
                # parse day range
                nums = re.findall(r"\d+", dr.replace(",", ""))
                if len(nums) >= 2:
                    tier_cols.append((c2, int(nums[0]), int(nums[1])))
                elif "731" in dr or "730" in dr:
                    tier_cols.append((c2, 731, 1095))
                c2 += 1
            else:
                break
        if not tier_cols:
            col += 1
            continue
        # Parse plan name for dur/kms
        kms_m = re.search(r"([\d,]+)\s*[kK][mM]", plan_raw)
        kms   = int(kms_m.group(1).replace(",", "")) if kms_m else None
        yr_m  = re.search(r"(\d)(?:th|rd|st|nd)?\s*(?:YR|Year)", plan_raw, re.I)
        # e.g. "4th YR / 125K km" → 12 months  |  "4th YR & 5th YR" → 24
        yr_count = plan_raw.lower().count("yr") + plan_raw.lower().count("year")
        dur = yr_count * 12 if yr_count else 12
        plans.append((plan_raw, dur, kms, tier_cols))
        col = c2

    return plans


def ingest_citroen(wb):
    brand_id = get_or_create_brand("Citroen")
    data = rows(wb["Citroen"])

    cur_plans  = []   # list from citroen_parse_plans
    header_row = None

    i = 0
    while i < len(data):
        row = data[i]
        cell0 = str(row[0]).strip() if row[0] else ""

        # Sub-table sentinel
        if cell0.lower() in ("prices with gst", ""):
            i += 1
            # next non-empty row is the plan-name header
            while i < len(data) and not any(data[i]):
                i += 1
            if i >= len(data): break
            h1 = data[i]; i += 1
            # skip to day-range row
            while i < len(data) and not any(data[i]):
                i += 1
            if i >= len(data): break
            h2 = data[i]; i += 1
            cur_plans = citroen_parse_plans(h1, h2)
            continue

        # Data row: Model | Fuel | Variant | OEM_M | OEM_KM | prices...
        if row[0] and row[1] and row[2]:
            model_name   = str(row[0]).strip()
            fuel         = norm_fuel(str(row[1]).strip())
            variant_name = str(row[2]).strip()
            oem_m        = row[3]
            oem_k        = row[4]

            model_id   = get_or_create_model(brand_id, model_name)
            variant_id = get_or_create_variant(model_id, variant_name,
                                               fuel, "N/A", oem_m, oem_k)
            for plan_name, dur, kms, tier_cols in cur_plans:
                tiers = []
                for ci, mn, mx in tier_cols:
                    price = to_price(row[ci]) if ci < len(row) else None
                    if price:
                        tiers.append((mn, mx, price))
                if tiers:
                    insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)
        i += 1

    print("✓ Citroen")


# ── TOYOTA ─────────────────────────────────────────────────────────────────────
# Row 2: Make/Model/Fuel/Trans/OEM + plan names | Row 3: day ranges
# Plans: 4th yr 100K | 4th & 5th yr 150K | 4th & 5th yr 200K

TOYOTA_PLANS = [
    ("4th Year / 100,000 Kms",       12, 100000),
    ("4th & 5th Year / 150,000 Kms", 24, 150000),
    ("4th & 5th Year / 200,000 Kms", 24, 200000),
]
TOYOTA_DAYS = [(0, 60), (61, 365), (366, 730), (731, 1095)]


def ingest_toyota(wb):
    brand_id = get_or_create_brand("Toyota")
    data = rows(wb["Toyota"])

    for row in data[4:]:      # skip 4 header rows
        if not row[0]:
            continue
        make       = str(row[0]).strip()
        model_name = str(row[1]).strip() if row[1] else make
        fuel       = norm_fuel(str(row[2]).strip() if row[2] else "N/A")
        trans      = norm_trans(str(row[3]).strip() if row[3] else "N/A")
        oem_m      = row[4]
        oem_k      = row[5]
        prices     = [to_price(row[6 + i]) if (6 + i) < len(row) else None
                      for i in range(12)]

        variant_name = f"{model_name} {fuel} {trans}".strip()
        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, trans, oem_m, oem_k)

        for p_idx, (plan_name, dur, kms) in enumerate(TOYOTA_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(TOYOTA_DAYS):
                price = prices[p_idx * 4 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Toyota")


# ── MG ─────────────────────────────────────────────────────────────────────────
# Row 2: plan names | Row 3: Make/Model/Fuel/OEM_M/OEM_KM + day ranges
# Plans: 12M/100K | 24M/100K | 12M/UNL | 24M/UNL  each with 4 day buckets

MG_PLANS = [
    ("12 Months / 100,000 Kms",     12, 100000),
    ("24 Months / 100,000 Kms",     24, 100000),
    ("12 Months / Unlimited Kms",   12, None),
    ("24 Months / Unlimited Kms",   24, None),
]
MG_DAYS = [(0, 30), (31, 180), (181, 365), (366, 1095)]


def ingest_mg(wb):
    brand_id = get_or_create_brand("MG")
    data = rows(wb["MG"])

    for row in data[3:]:      # skip 3 header rows
        if not row[0] or not row[1]:
            continue
        model_name = str(row[1]).strip()
        fuel       = norm_fuel(str(row[2]).strip() if row[2] else "N/A")
        oem_m      = row[3]
        oem_k      = row[4]
        prices     = [to_price(row[5 + i]) if (5 + i) < len(row) else None
                      for i in range(16)]

        variant_name = f"{model_name} {fuel}".strip()
        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, "N/A", oem_m, oem_k)

        for p_idx, (plan_name, dur, kms) in enumerate(MG_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(MG_DAYS):
                price = prices[p_idx * 4 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ MG")


# ── VOLKSWAGEN ─────────────────────────────────────────────────────────────────
# Row 5: headers | Row 6+: Make/Model/Variant/Fuel/Trans/OEM_M/OEM_KM/Type | 4 prices
# Plans: 5th yr/100K | 5th & 6th yr/150K  each 2 day buckets (0-365, 366-1430)

VW_PLANS = [
    ("5th Year / 100,000 Kms",       12, 100000),
    ("5th & 6th Year / 150,000 Kms", 24, 150000),
]
VW_DAYS = [(0, 365), (366, 1430)]


def ingest_vw(wb):
    brand_id = get_or_create_brand("Volkswagen")
    data = rows(wb["VW"])

    for row in data[5:]:      # skip 5 header rows
        if not row[0]:
            continue
        model_name   = str(row[1]).strip()  if row[1] else ""
        variant_name = str(row[2]).strip()  if row[2] else model_name
        fuel         = norm_fuel(str(row[3]).strip() if row[3] else "N/A")
        trans        = norm_trans(str(row[4]).strip() if row[4] else "N/A")
        oem_m        = row[5]
        oem_k        = row[6]
        if not model_name:
            continue
        prices = [to_price(row[8 + i]) if (8 + i) < len(row) else None
                  for i in range(4)]

        v_name   = f"{variant_name} {fuel}".strip() if variant_name != "NA" else f"{model_name} {fuel}"
        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, v_name,
                                           fuel, trans, oem_m, oem_k)

        for p_idx, (plan_name, dur, kms) in enumerate(VW_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(VW_DAYS):
                price = prices[p_idx * 2 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Volkswagen")


# ── SKODA ──────────────────────────────────────────────────────────────────────
# Row 4: headers | Row 5+: data
# Plans: 5 yr/125K (2 buckets) | 6 yr/150K (2 buckets) | 6 yr/150K alt (2 buckets)

SKODA_PLANS = [
    ("5 Years / 125,000 Kms", 12, 125000),   # 5th year only
    ("6 Years / 150,000 Kms", 24, 150000),   # 5th & 6th year
    ("6 Years / 150,000 Kms Alt", 24, 150000),
]
SKODA_DAYS = [(0, 365), (366, 1430)]


def ingest_skoda(wb):
    brand_id = get_or_create_brand("Skoda")
    data = rows(wb["Skoda"])

    # Detect header rows (there may be 2 sub-tables; handle both)
    in_data = False
    for row in data:
        if row[0] and str(row[0]).strip().lower() == "vehicle make":
            in_data = True
            continue
        if not in_data or not row[0]:
            continue
        make         = str(row[0]).strip()
        model_name   = str(row[1]).strip() if row[1] else make
        variant_name = str(row[2]).strip() if row[2] else model_name
        fuel         = norm_fuel(str(row[3]).strip() if row[3] else "N/A")
        trans        = norm_trans(str(row[4]).strip() if row[4] else "N/A")
        oem_m        = row[5]
        oem_k        = row[6]
        prices       = [to_price(row[7 + i]) if (7 + i) < len(row) else None
                        for i in range(6)]

        v_name   = f"{model_name} {variant_name}".strip() if variant_name not in ("NA", model_name) else model_name
        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, v_name,
                                           fuel, trans, oem_m, oem_k)

        for p_idx, (plan_name, dur, kms) in enumerate(SKODA_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(SKODA_DAYS):
                price = prices[p_idx * 2 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Skoda")


# ── JEEP ───────────────────────────────────────────────────────────────────────
# Multiple sub-tables each with its own plan header row.
# Row layout: Make/Model/Variant/Fuel/Trans/OEM_M/OEM_KM | 3 plans × 4 day buckets

JEEP_DAYS = [(0, 60), (61, 365), (366, 730), (731, 1095)]


def jeep_parse_plan_headers(row):
    """Row like: ...'5 Year/ 100K kms', None, None, None, '5 Year/ 125K Kms', ..."""
    plans = []
    for ci in range(7, min(len(row), 25)):
        val = str(row[ci]).strip() if row[ci] else ""
        if not val or val.lower() == "none":
            continue
        kms_m = re.search(r"([\d,]+)\s*[kK]", val)
        kms   = int(kms_m.group(1).replace(",", "")) * (1000 if "k" in kms_m.group(0).lower() else 1) if kms_m else None
        yr_m  = re.search(r"(\d+)\s*[Yy]ear", val)
        total_yrs = int(yr_m.group(1)) if yr_m else 5
        dur = (total_yrs - 3) * 12      # OEM is 3 yrs; EW dur = added years
        plans.append((val, dur, kms, ci))
    return plans


def ingest_jeep(wb):
    brand_id  = get_or_create_brand("Jeep")
    data      = rows(wb["JEEP"])
    cur_plans = []   # list of (plan_name, dur, kms, start_col)

    for row in data:
        cell0 = str(row[0]).strip() if row[0] else ""
        cell7 = str(row[7]).strip() if len(row) > 7 and row[7] else ""

        # Plan header rows have "5 Year/ 100K" etc. in col 7+
        if re.search(r"\d\s*year", cell7, re.I):
            cur_plans = jeep_parse_plan_headers(row)
            continue

        # Skip header rows
        if cell0.lower() in ("oem warranty", "vehicle make", ""):
            continue
        # Skip day-range header rows
        if re.search(r"\d+\s*~\s*\d+", cell7):
            continue

        # Data row
        if not row[0] or not row[1]:
            continue
        model_name   = str(row[1]).strip()
        variant_name = str(row[2]).strip() if row[2] and str(row[2]) != "None" else model_name
        fuel         = norm_fuel(str(row[3]).strip() if row[3] else "N/A")
        trans        = norm_trans(str(row[4]).strip() if row[4] else "N/A")
        oem_m        = row[5]
        oem_k        = row[6]

        v_name   = f"{model_name} {variant_name}".strip() if variant_name != model_name else model_name
        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, v_name,
                                           fuel, trans, oem_m, oem_k)

        for plan_name, dur, kms, start_col in cur_plans:
            tiers = []
            for d_idx, (mn, mx) in enumerate(JEEP_DAYS):
                ci = start_col + d_idx
                price = to_price(row[ci]) if ci < len(row) else None
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Jeep")


# ── HONDA ─────────────────────────────────────────────────────────────────────
# Row 2: Model + plan names | Row 3: day ranges
# Plans: 4th-5th yr/100K | 4th-6th yr/125K  each 6 day buckets

HONDA_PLANS = [
    ("4th-5th Year / 100,000 Kms", 24, 100000),
    ("4th-6th Year / 125,000 Kms", 36, 125000),
]
HONDA_DAYS = [(0, 60), (61, 300), (301, 540), (541, 730), (731, 910), (911, 1095)]


def ingest_honda(wb):
    brand_id = get_or_create_brand("Honda")
    data = rows(wb["Honda"])
    cur_model = None

    for row in data[3:]:      # skip 3 header rows
        if row[0] is not None:
            cur_model = str(row[0]).strip()
        if not cur_model or row[1] is None:
            continue
        variant_name = str(row[1]).strip()
        if variant_name.lower() in ("variant", ""):
            continue
        prices = [to_price(row[2 + i]) if (2 + i) < len(row) else None
                  for i in range(12)]

        model_id   = get_or_create_model(brand_id, cur_model)
        variant_id = get_or_create_variant(model_id, f"{cur_model} {variant_name}",
                                           "N/A", norm_trans(variant_name), 36, 100000)

        for p_idx, (plan_name, dur, kms) in enumerate(HONDA_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(HONDA_DAYS):
                price = prices[p_idx * 6 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Honda")


# ── MERCEDES-BENZ (MBI) ────────────────────────────────────────────────────────
# Row 3: headers | Row 4+: Class | Entry Age | 3 plan prices
# All plans are Unlimited KMs

MBI_PLANS = [
    ("4th Year / Unlimited Kms",               12, None),
    ("4th & 5th Year / Unlimited Kms",         24, None),
    ("4th, 5th & 6th Year / Unlimited Kms",    36, None),
]
MBI_AGES = {
    # Entry Age is time AFTER 3-yr OEM warranty expires (OEM = 1095 days from purchase).
    # So all ranges are offset by 1095 days from purchase date.
    "0 - 6 months":  (1095, 1275),
    "0-6 months":    (1095, 1275),
    "6 - 12 months": (1276, 1460),
    "6-12 months":   (1276, 1460),
    "1 to 2 year":   (1461, 1825),
    "1 to 2 years":  (1461, 1825),
    "2 to 3 year":   (1826, 2190),
    "2 to 3 years":  (1826, 2190),
}


def ingest_mbi(wb):
    brand_id  = get_or_create_brand("Mercedes-Benz")
    data      = rows(wb["MBI"])
    cur_model = None

    for row in data[3:]:      # skip 3 header rows
        if row[0] is not None and str(row[0]).strip():
            cur_model = str(row[0]).strip()
        if not cur_model or row[1] is None:
            continue
        age_str = str(row[1]).strip().lower()
        tier_range = MBI_AGES.get(age_str)
        if tier_range is None:
            continue
        prices = [to_price(row[2 + i]) if (2 + i) < len(row) else None
                  for i in range(3)]

        model_id   = get_or_create_model(brand_id, cur_model)
        variant_id = get_or_create_variant(model_id, cur_model,
                                           "N/A", "N/A", 36, None)

        for idx, (plan_name, dur, kms) in enumerate(MBI_PLANS):
            p = prices[idx]
            if p:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms,
                                       [(tier_range[0], tier_range[1], p)])

    print("✓ Mercedes-Benz")


# ── AUDI ───────────────────────────────────────────────────────────────────────
# Row 3-4: headers | Row 5+: Make/Model/OEM_M/OEM_KM | 4 prices
# Plans: 2+2 EW | 2+3 EW  each with 2 time buckets (0-180, 181-700 days)

AUDI_PLANS = [
    ("2+2 EW / Unlimited Kms", 24, None),
    ("2+3 EW / Unlimited Kms", 36, None),
]
AUDI_DAYS = [(0, 180), (181, 700)]


def ingest_audi(wb):
    brand_id = get_or_create_brand("Audi")
    data = rows(wb["Audi"])

    for row in data[4:]:      # skip 4 header rows
        if not row[0] or not row[1]:
            continue
        model_name = str(row[1]).strip()
        if model_name.lower() in ("vehicle model", ""):
            continue
        oem_m  = row[2]
        prices = [to_price(row[4 + i]) if (4 + i) < len(row) else None
                  for i in range(4)]

        model_id   = get_or_create_model(brand_id, model_name)
        variant_id = get_or_create_variant(model_id, model_name,
                                           "N/A", "N/A", oem_m, None)

        for p_idx, (plan_name, dur, kms) in enumerate(AUDI_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(AUDI_DAYS):
                price = prices[p_idx * 2 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Audi")


# ── BMW ────────────────────────────────────────────────────────────────────────
# Two sections: Row 3-36 (regular) and Row 39-47 (EV)
# Plans: 3rd Year/UNL | 4th Year/UNL | 5th Year/UNL  each 2 time buckets (0-45, 46-730)

BMW_PLANS = [
    ("3rd Year / Unlimited Kms", 12, None),
    ("4th Year / Unlimited Kms", 12, None),
    ("5th Year / Unlimited Kms", 12, None),
]
BMW_DAYS = [(0, 45), (46, 730)]


def ingest_bmw(wb):
    brand_id = get_or_create_brand("BMW")
    data = rows(wb["BMW"])

    for row in data:
        if not row[0] or str(row[0]).strip() in ("Vehicle Make", "MAKE", "BMW Customer EW Prices (With GST)", "REVISED EV"):
            continue
        if str(row[0]).strip() == "":
            continue
        make       = str(row[0]).strip()
        model_name = str(row[1]).strip() if row[1] else make
        fuel       = norm_fuel(str(row[2]).strip() if row[2] else "N/A")
        oem_raw    = str(row[3]).strip() if row[3] else ""
        oem_m_m    = re.search(r"(\d+)/", oem_raw)
        oem_m      = int(oem_m_m.group(1)) if oem_m_m else 24
        prices     = [to_price(row[4 + i]) if (4 + i) < len(row) else None
                      for i in range(6)]

        # BMW/MINI brand split
        brand_id_used = get_or_create_brand(make if make == "MINI" else "BMW")
        model_id   = get_or_create_model(brand_id_used, model_name)
        variant_id = get_or_create_variant(model_id, f"{model_name} {fuel}",
                                           fuel, "N/A", oem_m, None)

        for p_idx, (plan_name, dur, kms) in enumerate(BMW_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(BMW_DAYS):
                price = prices[p_idx * 2 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ BMW / MINI")


# ── JLR ────────────────────────────────────────────────────────────────────────
# Row 2: headers | Row 3+: Make/Model/Variant/Fuel | 3 plans × 4 day buckets

JLR_PLANS = [
    ("Add 12 Months / 125,000 Kms", 12, 125000),
    ("Add 24 Months / 150,000 Kms", 24, 150000),
    ("Add 36 Months / 175,000 Kms", 36, 175000),
]
JLR_DAYS = [(0, 30), (31, 365), (366, 730), (731, 1095)]


def ingest_jlr(wb):
    data = rows(wb["JLR"])
    for row in data[2:]:      # skip 2 header rows
        if not row[0] or not row[1]:
            continue
        make         = str(row[0]).strip()
        model_name   = str(row[1]).strip()
        variant_name = str(row[2]).strip() if row[2] else model_name
        fuel         = norm_fuel(str(row[3]).strip() if row[3] else "N/A")
        if make.lower() in ("make", ""):
            continue

        brand_id_used = get_or_create_brand(make)
        model_id   = get_or_create_model(brand_id_used, model_name)
        variant_id = get_or_create_variant(model_id, variant_name,
                                           fuel, "N/A", 36, None)

        prices = [to_price(row[4 + i]) if (4 + i) < len(row) else None
                  for i in range(12)]

        for p_idx, (plan_name, dur, kms) in enumerate(JLR_PLANS):
            tiers = []
            for d_idx, (mn, mx) in enumerate(JLR_DAYS):
                price = prices[p_idx * 4 + d_idx]
                if price:
                    tiers.append((mn, mx, price))
            if tiers:
                insert_plan_with_tiers(variant_id, plan_name, dur, kms, tiers)

    print("✓ Jaguar / Land Rover")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Parse --only flag:  python ingest.py --only citroen,toyota,mg
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="Comma-separated brand keys to run (default: all)")
    ap.add_argument("--sql",  action="store_true")
    args, _ = ap.parse_known_args()
    only = {b.strip().lower() for b in args.only.split(",") if b.strip()}

    def _run(key, fn):
        if only and key not in only:
            return
        if SQL_MODE: _SQL.append(f"-- BRAND: {key}")
        fn(wb)

    print(f"Loading workbook…")
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    print("Workbook loaded. Starting ingestion...\n")

    _run("kia",        lambda w: ingest_kia(w))
    _run("tata",       lambda w: ingest_tata(w))
    _run("hyundai",    lambda w: ingest_hyundai(w))
    _run("renault",    lambda w: ingest_renault(w))
    _run("maruti",     lambda w: ingest_maruti(w))
    _run("mahindra",   lambda w: ingest_mahindra(w))
    _run("citroen",    lambda w: ingest_citroen(w))
    _run("toyota",     lambda w: ingest_toyota(w))
    _run("mg",         lambda w: ingest_mg(w))
    _run("vw",         lambda w: ingest_vw(w))
    _run("skoda",      lambda w: ingest_skoda(w))
    _run("jeep",       lambda w: ingest_jeep(w))
    _run("honda",      lambda w: ingest_honda(w))
    _run("mbi",        lambda w: ingest_mbi(w))   # MB: re-seeded with correct post-OEM tier ranges
    _run("audi",       lambda w: ingest_audi(w))
    _run("bmw",        lambda w: ingest_bmw(w))
    _run("jlr",        lambda w: ingest_jlr(w))

    if SQL_MODE:
        import os as _os
        sql_dir = r"E:\Easy P\backend\sql_parts"
        _os.makedirs(sql_dir, exist_ok=True)
        # Write one file per brand using the brand markers injected during ingestion
        current_brand = "misc"
        brand_lines: dict[str, list[str]] = {}
        for line in _SQL:
            if line.startswith("-- BRAND:"):
                current_brand = line.split("-- BRAND:")[1].strip()
                brand_lines.setdefault(current_brand, [])
            else:
                brand_lines.setdefault(current_brand, []).append(line)
        for brand, lines in brand_lines.items():
            safe = brand.replace("/", "_").replace(" ", "_")
            path = _os.path.join(sql_dir, f"{safe}.sql")
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"-- {brand} — paste into Supabase SQL Editor and Run\n\n")
                f.write("\n".join(lines))
                f.write("\n")
            print(f"  {brand}: {len(lines):,} statements → {path}")
        print(f"\n✅ {len(brand_lines)} SQL files written to {sql_dir}")
        print("   Run each file one by one in Supabase SQL Editor")
    else:
        print("\n✅ All brands ingested successfully!")
