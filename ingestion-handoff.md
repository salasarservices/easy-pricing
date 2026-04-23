# Baja Motor EW Pricing — Data Ingestion Handoff

## What This Document Is
A handoff note for any AI agent continuing the work of populating the Supabase database from the Excel pricelist. The ingestion script has been written and is ready to run — it just needs a Unicode encoding fix and possibly some parser debugging per brand.

---

## Project Context

**Project:** Baja Motor Extended Warranty Pricing Engine  
**Purpose:** Web calculator that shows EW prices for 17+ car brands based on vehicle model, variant, and purchase date  
**Stack:** React 18 + Vite (Vercel) → Supabase PostgreSQL (direct from frontend)  
**Local path:** `E:\Easy P`  
**GitLab repo:** https://gitlab.com/salasarservices/easy-pricing

---

## Current Status

| Layer | Status |
|---|---|
| Frontend UI | ✅ Live and working |
| Supabase schema (tables) | ✅ Already created |
| Excel pricelist | ✅ Available |
| Ingestion script | ✅ Written — needs encoding fix + test run |
| Database data | ❌ Empty — ingestion not yet run successfully |

---

## Files to Know

| File | Purpose |
|---|---|
| `E:\Easy P\backend\ingest.py` | Main ingestion script — reads Excel → inserts into Supabase |
| `E:\Easy P\backend\.env` | Has SUPABASE_URL and SUPABASE_SERVICE_KEY set |
| `E:\OneDrive - Salasar Services Pvt. Ltd\Desktop\Baja Motor Extended Warranty  Retail Pricelist_2026.xlsx` | Source Excel file (18 brand sheets) |
| `E:\Easy P\schema.sql` | Supabase table definitions |
| `E:\Easy P\frontend\src\App.jsx` | Frontend — queries Supabase directly |
| `E:\Easy P\frontend\.env.local` | Has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (currently placeholders — real keys are in Vercel dashboard) |

---

## Supabase Credentials

```
SUPABASE_URL=https://oloqmcryyunhubzgppyv.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sb3FtY3J5eXVuaHViemdwcHl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjQ4NzgwOCwiZXhwIjoyMDkyMDYzODA4fQ.SXyvX-O2jabvU8i0oIpo0EvMVrPJQ0hD6QhPkvI41-4
```

> The service_role key is needed (not the anon key) because RLS policies only allow public SELECT. Writes require bypassing RLS via service_role.

Also update `E:\Easy P\frontend\.env.local` with the anon key if running locally:
```
VITE_SUPABASE_URL=https://oloqmcryyunhubzgppyv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase Settings > API Keys>
```

---

## Database Schema (5 tables)

```
brands
  id UUID PK
  name TEXT UNIQUE

models
  id UUID PK
  brand_id UUID → brands.id
  name TEXT

variants
  id UUID PK
  model_id UUID → models.id
  name TEXT
  fuel TEXT          -- Petrol, Diesel, EV, CNG, Hybrid, Petrol/Diesel, N/A
  transmission TEXT  -- Manual, Automatic, AMT, CVT, DCA, N/A
  oem_warranty_months INT
  oem_warranty_kms INT

plans
  id UUID PK
  variant_id UUID → variants.id
  plan_name TEXT
  plan_code TEXT UNIQUE (nullable — ingestion leaves NULL)
  duration_months INT
  max_kms INT (NULL = unlimited)

tiers
  id UUID PK
  plan_id UUID → plans.id
  min_days INT
  max_days INT
  price_inr DECIMAL(10,2)
  is_active BOOLEAN
```

**Pricing logic:** user enters purchase date → `days_since_purchase` calculated → frontend queries tiers where `min_days <= days <= max_days` AND `plans.variant_id = selected_variant_id`.

---

## The Ingestion Script

**File:** `E:\Easy P\backend\ingest.py`

### How to run

```bash
cd "E:\Easy P\backend"
python -X utf8 ingest.py
# OR
set PYTHONIOENCODING=utf-8 && python ingest.py
# OR on PowerShell:
$env:PYTHONIOENCODING="utf-8"; python ingest.py
```

### Known issue that must be fixed first

**Error:** `UnicodeEncodeError: 'charmap' codec can't encode character '\u2713'`  
**Cause:** Windows terminal uses cp1252 encoding; the script uses `✓` checkmark in print statements  
**Fix (Option A):** Replace all `print("✓ Brand")` lines with `print("OK Brand")`  
**Fix (Option B):** Add at the top of ingest.py, after imports:
```python
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
```
**Fix (Option C):** Run with `python -X utf8 ingest.py` (Python 3.7+)

### Dependencies

```bash
pip install openpyxl supabase python-dotenv
```

All should already be installed. If not, run the above.

---

## Excel File Structure (18 sheets)

The script has a dedicated parser function for each brand. Here is what each sheet looks like and how the parser handles it:

### 1. Kia
- **Sheet name:** `Kia`
- **Structure:** Row 1 = plan headers, Row 2 = km limits, Row 3+ = `model_cell | age_text | price1 | price2 | price3 | price4`
- **Model cells** combine multiple models: `"Seltos / The New Seltos - Petrol / Carens- Petrol"` → must be split on `/` and fuel extracted from ` - Petrol/Diesel` suffix
- **4 plans:** 4th Year/100K, 4th Year/UNL, 4th & 5th/120K, 4th & 5th/UNL
- **Age → days:** 0-3M→0-90, 4-12M→91-365, 13-24M→366-730, 25-34M→731-1020
- **OEM warranty assumed:** 36 months

### 2. Tata
- **Sheet name:** `Tata`
- **Structure:** Sectional. Each model has its own block:
  - `[MODEL NAME] | "Days from Date of sale"` — model header
  - `"Additional N year or up to XXXXXkm"` — plan sub-header (contains duration + km limit)
  - `[plan name] | 0-90 days | 91-180 days | Above 180 days` — column header
  - `[variant name] | price | price | price` — data rows
- **Day ranges:** 0-90, 91-180, 181-1095 ("Above 180 days")
- **Fuel/transmission** inferred from variant name text (e.g. "Diesel", "CNG", "AMT", "DCA")
- **Many models:** Tiago, Tigor, Nexon, Altroz, Harrier, Safari, Punch, Curvv, and their variants (Dark, CNG, DCA, iCNG, Racer editions)
- **OEM warranty assumed:** 36 months

### 3. Hyundai
- **Sheet name:** `Hyundai`
- **Structure:** Row 1 = model + 3 plan names (merged cols), Row 2 = 9 day-range columns, Row 3+ = data
- **3 plans × 3 day buckets = 9 price columns per row**
- **Plans:** 4th YR/80K, 4th & 5th YR/100K, 4th-7th YR/140K
- **Day buckets:** 0-90, 91-365, 366-1095
- **Fuel/trans** in col B as `"Petrol-M/T"`, `"Diesel-A/T"`, `"CNG-M/T"` etc.
- **`-` values** = plan not applicable for that model/age — skip these

### 4. Renault
- **Sheet name:** `Renault`
- **Structure:** Row 3 = headers, Row 4+ = `model | plan_name | price×4`
- **Day ranges:** 0-90, 91-365, 366-730, 731-1095
- **Plan names** like `"3+2 Year (5 Years / 1L Kms)"` — parse year count and km limit
- **Fuel type** in section-header rows like `"Model (Diesel)"` — carry forward
- **OEM warranty assumed:** 36 months

### 5. Maruti (uses "Maruti New" sheet)
- **Sheet name:** `Maruti New` (identical data exists in "Maruti" — only one is ingested)
- **Structure:** Clean tabular. Row 4+ = `VARIANT | Make | Model | Fuel | Trans | OEM_M | OEM_KM | 12 prices`
- **3 plans × 4 day buckets = 12 price columns**
- **Plans:** 12M/20K, 24M/40K, 36M/60K
- **Day buckets:** 0-30, 31-365, 366-730, 731-1095
- **Fuel values:** `P` = Petrol, `CNG` = CNG — normalize with `norm_fuel()`
- **Very large sheet** — hundreds of variants

### 6. Mahindra
- **Sheet name:** `Mahindra`
- **Structure:** Rows 3-4 = plan + day headers, Row 6+ = `Model | Trans | Fuel | price×6`
- **2 plans × 3 day buckets = 6 price columns**
- **Plans:** 4th Yr/120K, 4th & 5th Yr/150K
- **Day buckets:** 0-60, 61-730, 731-1095
- **Fuel:** `Gasoline` = Petrol, `Diesel` = Diesel
- **Model rows** have None in col A when same model continues — carry forward

### 7. Citroen
- **Sheet name:** `Citroen`
- **Structure:** Multiple sub-tables, each starting with a "Prices with GST" sentinel row
- **Each sub-table has its own plan structure** (different km limits, different plan count)
- **Col layout per sub-table:** `Model | Fuel | Variant | OEM_M | OEM_KM | prices…`
- **Models include:** EC3 (EV, 36m OEM), C5 Aircross (Diesel, 36m OEM), C3/C3 Aircross (Petrol, 24m OEM)
- **Day buckets:** 0-60, 61-365, 366-730, 731-1095 (some sub-tables only have 3 buckets: 0-60, 61-365, 366-730)

### 8. Toyota
- **Sheet name:** `Toyota`
- **Structure:** Row 2 = Make/Model/Fuel/Trans/OEM headers + plan names, Row 3 = day ranges, Row 5+ = data
- **3 plans × 4 day buckets = 12 price columns**
- **Plans:** 4th yr/100K, 4th & 5th yr/150K, 4th & 5th yr/200K
- **Day buckets:** 0-60, 61-365, 366-730, 731-1095 (labeled "0-2 Months", "3-12 Months" etc. in header but stored as prices only)
- **Models:** Innova Crysta, Fortuner, Camry, Glanza, Urban Cruiser, etc.

### 9. MG (Morris Garages)
- **Sheet name:** `MG`
- **Structure:** Row 2 = plan names, Row 3 = Make/Model/Fuel/OEM + day ranges, Row 4+ = data
- **4 plans × 4 day buckets = 16 price columns**
- **Plans:** 12M/100K, 24M/100K, 12M/UNL, 24M/UNL
- **Day buckets:** 0-30, 31-180, 181-365, 366-1095
- **⚠️ IMPORTANT:** Prices stored as strings with spaces and commas: `'   18,000'` — the `to_price()` helper strips these
- **`NA` values** (for Gloster 24M/UNL and ZSEV UNL plans) = not available — skip

### 10. Volkswagen
- **Sheet name:** `VW`
- **Structure:** Row 5 = headers, Row 6+ = `Make | Model | Variant | Fuel | Trans | OEM_M | OEM_KM | NCW | price×4`
- **2 plans × 2 day buckets = 4 price columns** (col 8 is "NCW" type label — skip, prices start col 8)
- **Plans:** 5th yr/100K, 5th & 6th yr/150K
- **Day buckets:** 0-365, 366-1430 (VW has 4-year OEM warranty)
- **Some prices stored as strings:** `'37 999'`, `'86 799'` — to_price() handles this
- **OEM warranty:** 48 months

### 11. Skoda
- **Sheet name:** `Skoda`
- **Structure:** Row 4 = headers, Row 5+ = data (multiple sub-tables — detect header rows where col A = "Vehicle Make")
- **3 plans × 2 day buckets = 6 price columns** (some plans have NA for certain models)
- **Plans:** 5 yrs/125K, 6 yrs/150K, 6 yrs/150K alt
- **Day buckets:** 0-365, 366-1430 (4-year OEM)
- **`NA` values** = plan not available for this model — skip

### 12. Jeep
- **Sheet name:** `JEEP`
- **Structure:** Multiple sub-tables with plan-name header rows
- **3 plans × 4 day buckets = 12 price columns** per sub-table
- **Plans:** 5 Yr/100K, 5 Yr/125K, 5 Yr/150K
- **Day buckets:** 0-60, 61-365, 366-730, 731-1095
- **Plan header detection:** rows where col 7 contains `"\d Year/"` pattern
- **Some prices as strings:** `'32000      '`, `'40000      '` — to_price() handles

### 13. Honda
- **Sheet name:** `Honda`
- **Structure:** Row 2 = Model + plan names, Row 3 = day ranges, Row 4+ = data
- **2 plans × 6 day buckets = 12 price columns**
- **Plans:** 4th-5th yr/100K, 4th-6th yr/125K
- **Day buckets:** 0-60, 61-300, 301-540, 541-730, 731-910, 911-1095
- **Col A** = model name (carry forward when None), **Col B** = variant/transmission

### 14. Mercedes-Benz (MBI)
- **Sheet name:** `MBI`
- **Structure:** Row 3 = headers (Class | Entry Age | plan1 | plan2 | plan3), Row 4+ = data
- **3 plans, all Unlimited KMs**
- **Plans:** 4th Year, 4th+5th Year, 4th+5th+6th Year
- **Age text → days:** `"0 - 6 Months"` → 0-180, `"6 - 12 Months"` → 181-365, `"1 to 2 year"` → 366-730, `"2 to 3 year"` → 731-1095
- **Col A** = class/model name (carry forward when None)
- **Very high prices** (luxury brand) — some exceed ₹10 lakh

### 15. Audi
- **Sheet name:** `Audi`
- **Structure:** Row 3-4 = headers, Row 5+ = `Make | Model | OEM_M | OEM_KM | price×4`
- **2 plans × 2 day buckets = 4 price columns**
- **Plans:** 2+2 EW/UNL, 2+3 EW/UNL
- **Day buckets:** 0-180, 181-700 (Audi has 2-year OEM)
- **OEM warranty:** 24 months, unlimited kms

### 16. BMW (+ MINI)
- **Sheet name:** `BMW`
- **Structure:** Two sections:
  - **Regular (rows 3-36):** `Make | Model | Fuel | OEM | price×6`
  - **EV section (rows 39-47):** Different plan names, BEV fuel
- **3 plans × 2 day buckets = 6 price columns**
- **Plans:** 3rd Year/UNL, 4th Year/UNL, 5th Year/UNL
- **Day buckets:** 0-45, 46-730 (BMW has 2-year OEM)
- **MINI models** are in the same sheet — brand = "MINI" when col A = "MINI"
- **XM model** fuel = PH (Hybrid)

### 17. Jaguar / Land Rover (JLR)
- **Sheet name:** `JLR`
- **Structure:** Row 2 = headers, Row 3+ = `Make | Model | Variant | Fuel | price×12`
- **3 plans × 4 day buckets = 12 price columns**
- **Plans:** Add 12M/125K, Add 24M/150K, Add 36M/175K
- **Day buckets:** 0-30, 31-365, 366-730, 731-1095
- **Brand split:** "Jaguar" and "Land Rover" → two separate brands in DB
- **Very high prices** (ultra-luxury)

---

## Key Helper Functions in ingest.py

```python
to_price(val)       # Handles floats, ints, and strings like '  18,000' or '37 999'
norm_fuel(raw)      # Maps 'P','D','B','PH','Gasoline' etc → 'Petrol','Diesel','EV','Hybrid'
norm_trans(raw)     # Maps 'M/T','A/T','AMT','CVT' → 'Manual','Automatic','AMT','CVT'
get_or_create_brand(name)          # Upsert brand, return id (cached)
get_or_create_model(brand_id, name) # Insert or fetch model
get_or_create_variant(...)          # Insert or fetch variant
insert_plan_with_tiers(...)         # Insert plan + all its tier rows in one go
```

---

## What Needs To Be Done

### Step 1 — Fix Unicode print issue (BLOCKING)
The script fails immediately with:
```
UnicodeEncodeError: 'charmap' codec can't encode character '\u2713'
```
This is because `print("✓ Kia")` uses a checkmark that Windows cp1252 terminal can't render.

**Fix:** In `E:\Easy P\backend\ingest.py`, find-and-replace all `✓` characters in print statements with `[OK]` or use ASCII only. Then run:
```bash
cd "E:\Easy P\backend"
python ingest.py
```

Or add this near the top of ingest.py (after imports):
```python
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
```

### Step 2 — Run the script and fix any parser errors
Each brand parser may have minor issues (off-by-one column indices, unexpected None values, etc.). Run the script and fix errors brand by brand. The structure is modular — each brand is a separate `ingest_xxx()` function.

### Step 3 — Verify data in Supabase
After ingestion, open the Supabase dashboard → Table Editor → check:
- `brands` table has ~17-18 rows
- `models` table has hundreds of rows
- `variants` table has hundreds of rows
- `plans` table has thousands of rows
- `tiers` table has tens of thousands of rows

### Step 4 — Test the frontend
Open the frontend (`E:\Easy P\frontend` → `npm run dev`) and verify:
- Brand dropdown populates
- Selecting a brand shows models
- Selecting a model shows variants
- Entering a purchase date and clicking "View Available Plans" returns prices

### Step 5 — Update frontend .env.local
The `E:\Easy P\frontend\.env.local` still has placeholder values:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
Replace with real values (anon key from Supabase Settings → API Keys → `anon public`).

---

## RLS Notes

Row Level Security is enabled on all tables with public read-only policies. The ingestion script uses the `service_role` key which bypasses RLS entirely. The frontend uses the `anon` key which only allows SELECT (read).

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| UnicodeEncodeError on ✓ | Windows cp1252 terminal | Replace ✓ with [OK] in prints |
| `KeyError: 'id'` on insert | Supabase schema not created yet | Run schema.sql in Supabase SQL Editor first |
| Plan insert fails (plan_code UNIQUE) | Duplicate plan_code | Script leaves plan_code as NULL — multiple NULLs are allowed in PostgreSQL UNIQUE columns |
| Prices show as 0 or None | MG sheet has string prices like `'  18,000'` | to_price() should handle this — verify it's being called |
| Brand dropdown empty | Supabase anon key not set in frontend | Update frontend/.env.local with real anon key |

---

## Schema SQL Location

The full schema is at `E:\Easy P\schema.sql`. If tables don't exist, run this file in the Supabase SQL Editor (Project → SQL Editor → paste and run).
