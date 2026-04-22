# Easy Pricing — Extended Warranty Calculator
### Project Reference & Change Log

> **Salasar Services** · Internal tool for quoting Advance Assurance (Extended Warranty) prices across 17+ car brands.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Database Schema](#4-database-schema)
5. [Core Application Logic](#5-core-application-logic)
6. [Feature Reference](#6-feature-reference)
7. [Environment Variables](#7-environment-variables)
8. [Running Locally](#8-running-locally)
9. [Deployment (Vercel)](#9-deployment-vercel)
10. [Data Management](#10-data-management)
11. [Change Log](#11-change-log)

---

## 1. Project Overview

A single-page web application that lets Salasar Services staff instantly price Extended Warranty plans for customer vehicles. Staff select a brand → model → variant → enter the vehicle purchase date, and the app returns all applicable EW plans with pricing from the Supabase database.

**Live URL:** Deployed on Vercel (connected to GitLab main branch via auto-deploy)  
**GitLab Repo:** https://gitlab.com/salasarservices/easy-pricing  
**Local path:** `E:\Easy P`

**Access:** Password-protected login (bcryptjs hash stored in source). Session persists across page refresh. Auto-logout after 40 minutes of inactivity with a 2-minute warning banner.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Vite | SPA, no backend at runtime |
| Styling | Tailwind CSS 3 | Glassmorphism design system |
| DB | Supabase (PostgreSQL) | Direct frontend ↔ DB queries |
| DB client (read) | `@supabase/supabase-js` anon key | RLS: public SELECT only |
| DB client (write) | `@supabase/supabase-js` service_role key | Bypasses RLS — admin panel only |
| Date picker | `react-datepicker` v9 | React 18 native, glassmorphism themed |
| Excel parsing | `xlsx` (SheetJS) | Lazy-loaded; admin panel only |
| Auth | `bcryptjs` | Frontend hash comparison |
| Deployment | Vercel | Auto-deploys from GitLab main |
| Images | ImageKit CDN | Brand logos + Salasar logo |

---

## 3. Project Structure

```
E:\Easy P\
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main app — Dashboard, all calculator logic
│   │   ├── Login.jsx            # Login page (Salasar logo, bcrypt auth)
│   │   ├── AdminPage.jsx        # Manage Data panel (Excel upload → Supabase)
│   │   ├── index.css            # Tailwind + react-datepicker glassmorphism overrides
│   │   └── lib/
│   │       ├── supabase.js      # Anon client (read-only, safe to expose)
│   │       ├── supabaseAdmin.js # Service-role client (write) — lazy initialised
│   │       └── excelIngest.js   # Excel parse → validate → upsert pipeline
│   ├── .env.local               # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
│   │                            # VITE_SUPABASE_SERVICE_KEY  (gitignored)
│   ├── vite.config.js           # Proxy + manualChunks (datepicker, xlsx)
│   ├── package.json
│   └── seed_mercedes.js         # One-shot data seed: Mercedes C & E Class
├── backend/
│   ├── ingest.py                # Python script: original Excel → Supabase ingestion
│   │                            # (pre-dates browser-based admin panel)
│   └── .env                     # SUPABASE_URL, SUPABASE_SERVICE_KEY (gitignored)
├── schema.sql                   # Supabase table definitions (run once to set up)
├── PROJECT.md                   # This file
├── INGESTION_HANDOFF.md         # Legacy handoff doc from early project phase
└── README.md                    # GitLab default (not project-specific)
```

---

## 4. Database Schema

Five tables. All reads use the anon key (RLS: public SELECT). All writes use the service_role key.

```
brands
  id        UUID  PK
  name      TEXT  UNIQUE

models
  id        UUID  PK
  brand_id  UUID  → brands.id
  name      TEXT
  UNIQUE (brand_id, name)

variants
  id                    UUID  PK
  model_id              UUID  → models.id
  name                  TEXT
  fuel                  TEXT  -- Petrol | Diesel | EV | CNG | Hybrid
  transmission          TEXT  -- Manual | Automatic
  oem_warranty_months   INT   -- OEM warranty period (months)
  oem_warranty_kms      INT   -- OEM warranty km limit (NULL = unlimited)
  UNIQUE (model_id, name)     -- ⚠ name alone distinguishes variants in a model

plans
  id               UUID  PK
  variant_id       UUID  → variants.id
  plan_name        TEXT  -- Display name, e.g. "4th Year (Optional)"
  plan_code        TEXT  UNIQUE  -- e.g. "MB_E_P_AT_4Y"
  duration_months  INT   -- Coverage period in months
  max_kms          INT   -- KM cap (NULL = unlimited)

tiers
  id          UUID     PK
  plan_id     UUID     → plans.id
  min_days    INT      -- Vehicle age (days) min for this price to apply
  max_days    INT      -- Vehicle age (days) max for this price to apply
  price_inr   DECIMAL  -- Price inclusive of GST
  is_active   BOOLEAN  -- FALSE = hidden from calculator
```

**Pricing logic:** When a customer selects a variant and enters a purchase date, the app calculates `days_since_purchase` and fetches all tiers for that variant. Each plan picks its price from the tier whose `min_days ≤ age ≤ max_days`. Plans whose coverage window hasn't started yet (min_days > age) are shown as "Optional Coverage" in amber.

---

## 5. Core Application Logic

### 5.1 Calculator Query (handleCalculate)

**Old approach (pre v1.4):** Filtered tiers directly by age:
```
WHERE min_days <= vehicle_age AND max_days >= vehicle_age
```
**Problem:** Plans for future coverage (e.g. "4th Year Optional" with min_days=1095) were invisible to a 2-year-old vehicle (age=730 days) even though the customer should see and price those plans.

**Current approach (v1.4+):** Fetches ALL active tiers for the variant, then classifies client-side:

```
For each plan:
  1. Find tier where min_days ≤ age ≤ max_days → "current" plan (blue)
  2. No match? Find earliest tier where min_days > age → "optional" plan (amber)
  3. All tiers have max_days < age → window has passed, hide
```

Results are sorted cheapest-first within each group. Current plans appear first; optional plans appear below an amber "Optional Extended Coverage" divider.

### 5.2 Mercedes Pricing — Entry Age Tiers

Mercedes EW can only be purchased while the vehicle is under OEM warranty (0–3 years). The price depends on how old the vehicle is at time of purchase (entry age):

| Entry Age | Days Range | Notes |
|---|---|---|
| 0–6 Months | 0–182 | Cheapest — buy early |
| 6–12 Months | 183–365 | |
| 1–2 Years | 366–730 | |
| 2–3 Years | 731–1095 | Most expensive within OEM |

A vehicle older than 3 years (> 1095 days) shows "No plans available" — correct, as EW cannot be purchased after OEM expiry.

### 5.3 Session Persistence & Inactivity

- **Storage:** `localStorage` keys `ew_auth` (flag) and `ew_last_active` (timestamp)
- **On login:** Both keys set; `readSession()` called on `useState` initialiser so login survives page refresh
- **Activity events:** `mousemove / keydown / click / scroll / touchstart` — each updates `ew_last_active`
- **Timer:** `setInterval` every 30 seconds checks elapsed time:
  - ≥ 38 min → show amber warning banner
  - ≥ 40 min → call `onLogout()` (clears localStorage, returns to login)

### 5.4 Admin Panel (Manage Data)

- Lazy-loaded via `React.lazy()` so `supabaseAdmin.js` never initialises on the main calculator — prevents crash when `VITE_SUPABASE_SERVICE_KEY` is not set
- Excel ingest pipeline: **parse** (SheetJS) → **validate** (column/value checks) → **upsert** (brand→model→variant→plan→tier in order, skip identical rows, update changed prices)
- `supabaseAdmin.js` returns `null` if service key is missing; `AdminPage` shows a friendly setup card instead of crashing

### 5.5 Purchase Date Range

- **Min date:** `2020-01-01` — allows vehicles purchased from January 2020 onward
- **Max date:** Today
- **Eligibility:** Any past date from 2020 is allowed. If no DB tiers match the vehicle's age, the app returns "No plans available" — no hard eligibility cap in the UI

---

## 6. Feature Reference

| Feature | File | Key Detail |
|---|---|---|
| Login page | `Login.jsx` | Salasar logo (ImageKit), bcrypt hash compare |
| Brand selector | `App.jsx` — `SelectField` | Loads from `brands` table on mount |
| Model selector | `App.jsx` — `SelectField` | Loads on brand change |
| Variant selector | `App.jsx` — `SelectField` | Shows fuel/transmission badges |
| Date picker | `App.jsx` — `DatePicker` | react-datepicker, glassmorphism CSS, green icon |
| Progress bar | `App.jsx` — `ProgressBar` | Steps 1–4; step 4 ticks when results shown |
| Plan cards | `App.jsx` — `PlanCard` | Blue = current, amber = optional coverage |
| Optional coverage | `App.jsx` — `handleCalculate` | See §5.1 — amber divider + badge |
| Brand logo strip | `App.jsx` — `BrandLogoStrip` | 18 brands, round white circle, ImageKit CDN |
| Session / auto-logout | `App.jsx` — Dashboard `useEffect` | See §5.3 |
| Manage Data panel | `AdminPage.jsx` | Excel upload, drag-drop, progress, summary |
| Excel template download | `excelIngest.js` — `downloadTemplate()` | 2-sheet workbook with instructions |
| Data ingest engine | `excelIngest.js` — `ingestRows()` | Upsert: insert new, update changed, skip identical |
| Service key guard | `supabaseAdmin.js` | Returns null if key missing; lazy-loaded |
| Bundle splitting | `vite.config.js` — `manualChunks` | `datepicker` and `xlsx` in separate chunks |

---

## 7. Environment Variables

### `frontend/.env.local` (gitignored — never commit)

```env
VITE_SUPABASE_URL=https://oloqmcryyunhubzgppyv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key from Supabase Settings → API>
VITE_SUPABASE_SERVICE_KEY=<service_role key — admin panel writes only>
```

### Vercel Environment Variables (project settings)

Same three variables must be added in Vercel → Project → Settings → Environment Variables.  
`VITE_SUPABASE_SERVICE_KEY` is only needed for the Manage Data panel. The calculator works without it.

> **Security note:** The service_role key bypasses RLS and can write/delete any row. It is acceptable here because this is an internal single-user tool behind a login. Do not expose it in a public-facing app.

---

## 8. Running Locally

```bash
cd "E:\Easy P\frontend"
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8000` (legacy, not used in current architecture).

### Running the Mercedes seed script

```bash
cd "E:\Easy P\frontend"
node seed_mercedes.js
# Requires VITE_SUPABASE_SERVICE_KEY in .env.local
```

---

## 9. Deployment (Vercel)

- Vercel is connected to the GitLab repo (`salasarservices/easy-pricing`)
- Every push to `main` triggers an automatic redeploy
- Build command: `vite build` (from `frontend/` directory)
- Output directory: `frontend/dist`
- All three env vars must be present in Vercel project settings for full functionality

---

## 10. Data Management

### Option A — Excel Upload (recommended for bulk data)

1. Open app → **Manage Data**
2. Download the template (pre-filled with example rows and instructions)
3. Fill in your data — one row per pricing tier
4. Upload via drag-drop or file picker
5. The ingest engine upserts: inserts new rows, updates changed prices, skips identical rows

**Excel column reference:**

| Column | Required | Format / Allowed values |
|---|---|---|
| Brand | Yes | Must match existing brand name exactly |
| Model | Yes | Any text |
| Variant | Yes | Any text — must be unique within a model |
| Fuel | Yes | `Petrol` \| `Diesel` \| `EV` \| `CNG` \| `Hybrid` |
| Transmission | Yes | `Manual` \| `Automatic` |
| OEM_Warranty_Months | No | Number (months) |
| OEM_Warranty_KMs | No | Number (km) |
| Plan_Name | Yes | Display name shown in app |
| Plan_Code | Yes | Unique ID, no spaces — e.g. `MB_E_P_AT_4Y` |
| Duration_Months | Yes | Number (months of EW coverage) |
| Max_KMs | No | Leave blank for unlimited |
| Age_Min_Days | Yes | Vehicle age in days (min) for this price tier |
| Age_Max_Days | Yes | Vehicle age in days (max) for this price tier |
| Price_INR | Yes | Amount inclusive of GST |
| Is_Active | Yes | `TRUE` \| `FALSE` |

**Multi-tier plans:** Same `Plan_Code`, same `Plan_Name`, different `Age_Min_Days` / `Age_Max_Days` / `Price_INR` — one row per tier.

### Option B — Seed Script (for programmatic one-off loads)

See `frontend/seed_mercedes.js` as a template. Duplicate and adapt for other brands. Run with `node seed_mercedes.js` from the `frontend/` directory.

### Option C — Python Ingestion Script (legacy)

`backend/ingest.py` — original script for bulk-loading the 18-brand Excel pricelist. Requires Python + `openpyxl supabase python-dotenv`. See `INGESTION_HANDOFF.md` for full details on sheet structures per brand.

---

## 11. Change Log

All commits listed newest-first. Grouped by feature area.

---

### v1.5 — Mercedes-Benz Data Seed · `86b4390`

**Commit:** `chore: add Mercedes-Benz EW data seed script`

- Added `frontend/seed_mercedes.js` — standalone Node.js script that seeds Mercedes-Benz C Class and E Class EW pricing directly into Supabase
- Data extracted from "Rates for Advance Assurance (Extended Warranty) for Mercedes-Benz vehicles (With GST)" rate sheet
- Variants created:
  - C Class · Petrol · Automatic (`MB_C_P_AT`)
  - C Class 300d AMG · Diesel · Automatic (`MB_C_D_AT`)
  - E Class · Petrol · Automatic (`MB_E_P_AT`)
- Each variant: 3 plans × 4 age-tier brackets = 12 tier rows
- Plans: `4th Year (Optional)` / `4th + 5th Year (Optional)` / `4th + 5th + 6th Year (Optional)`
- Age brackets: 0–182 days / 183–365 / 366–730 / 731–1095 (matching 0–6M / 6–12M / 1–2Y / 2–3Y from rate sheet)
- Script is idempotent: re-running skips existing rows, updates changed prices

---

### v1.4 — Optional Coverage Plans · `4d3f37e`

**Commit:** `feat: show optional extended coverage plans regardless of vehicle age`

**Problem solved:** Plans named "4th Year (Optional)" were invisible to vehicles still under OEM warranty. The old query filtered `min_days ≤ age ≤ max_days`, so a 2-year-old car never saw plans whose coverage starts at year 4.

**Logic change in `handleCalculate`:**
- Removed `.lte('min_days', days)` and `.gte('max_days', days)` from Supabase query
- Now fetches ALL active tiers for the variant
- Client-side classification per plan:
  - **Exact tier match** (`min_days ≤ age ≤ max_days`) → current plan, blue styling
  - **Future tier** (earliest tier where `min_days > age`) → optional plan, amber styling
  - **All tiers expired** (all `max_days < age`) → hidden
- Multi-tier pricing still works: if a plan has different prices at different ages, the correct tier is selected

**UI changes:**
- `PlanCard` gains `is_optional` prop → amber card border, amber text, "Optional Coverage" badge (warning icon)
- Results section splits into two groups with amber divider: "Optional Extended Coverage"
- "Best Value" badge only applies to rank-0 non-optional plan

---

### v1.3 — Purchase Date Range Extended to 2020 · `ccc8987`

**Commit:** `Extend purchase date range back to Jan 2020`

- `minDate` changed from rolling 3-year window to fixed `'2020-01-01'`
- Removed `&& days <= 1095` cap from `eligible` check — any past date from 2020 is allowed
- Removed "Vehicle is over 3 years old — not eligible" error message
- DB naturally returns 0 plans for ages with no tier coverage — no UI-level blocking needed
- Allows quoting for vehicles purchased 2020–2022 that are now 3–5 years old

---

### v1.2 — UI Polish & Admin Cleanup · `a571968` · `1419660`

**Commits:**
- `Remove 'How the import works' section from admin panel`
- `Fix step 4 progress indicator: show checkmark after plans are displayed`

- Removed "How the import works" GlassCard from `AdminPage.jsx` (reduces clutter)
- Progress bar step 4 (Date) now shows checkmark only after `results !== null` (plans displayed), not just when a date is selected:
  ```javascript
  const currentStep = sel.brandId ? sel.modelId ? sel.variantId ? results !== null ? 4 : 3 : 2 : 1 : 0
  ```

---

### v1.1 — Date Picker Upgrade · `7395a5f`

**Commit:** `Replace native date input with react-datepicker, green calendar icon`

**Why react-datepicker instead of react-modern-calendar-datepicker:**
- `react-modern-calendar-datepicker` (user's suggestion) was last updated in 2021 and is incompatible with React 18
- `react-datepicker` v9.1.0 is actively maintained and React 18 native

**Changes:**
- Added `react-datepicker@^9.1.0` dependency
- `@import 'react-datepicker/dist/react-datepicker.css'` added to `index.css`
- Created `DateInput` forwardRef component — glassmorphism-styled text input that triggers the datepicker popup
- Full glassmorphism CSS override for the calendar popup in `index.css` (dark bg, blue selected, green today)
- Calendar icon: inline SVG inside `DateInput`, `text-[#0eca2d]`, `w-5 h-5`
- Native `<input type="date">` CSS also updated: 20px calendar icon with CSS filter for `#0eca2d` green
- `vite.config.js` updated with `manualChunks: { datepicker: ['react-datepicker'] }` to split bundle

---

### v1.0 — Session Persistence & Auto-Logout · `05e1efb`

**Commit:** `Add session persistence and 40-min inactivity auto-logout`

**Problem:** App returned to login on every page refresh.

**Solution — localStorage session:**
```javascript
AUTH_KEY    = 'ew_auth'        // '1' when logged in
ACTIVE_KEY  = 'ew_last_active' // Unix timestamp of last activity
```
- `readSession()` called in `useState` initialiser — immediately restores session on mount
- `saveSession()` sets both keys on login
- `clearSession()` removes both on logout
- `touchSession()` updates timestamp on any user activity

**Inactivity tracker (Dashboard `useEffect`):**
- Listens to `mousemove / keydown / click / scroll / touchstart` → calls `touchSession()`
- `setInterval` every 30 seconds checks elapsed time:
  - ≥ 38 min → `setWarnExpiry(true)` → amber warning banner
  - ≥ 40 min → `onLogout()`
- Warning dismisses automatically on any user activity

---

### v0.9 — Header & Logo UI Polish · `865f939` · `5cde952`

**Commits:**
- `UI polish: header layout, glass buttons, round brand logos`
- `Fix header overlap: move action buttons to their own row above title`

**Header fix:** "Manage Data" button (previously `absolute` positioned) was overlapping the badge. Replaced with flex row: badge left, buttons right — same line, no absolute positioning.

**Button styling:** All three action buttons (Manage Data, Sign Out, Back to Calculator) use consistent glass style:
```
bg-white/[0.07] border-white/[0.12] text-slate-300
hover:bg-white/[0.13] hover:border-white/20
```
Active "Manage Data" highlighted with blue tint.

**Brand logos:**
- `overflow-hidden` removed from `rounded-full` container (was clipping logo edges at radius)
- White circle background (`bg-white rounded-full`)
- `p-2.5` padding + `object-contain` keeps logos within circle without clipping
- `w-16 h-16` size with `group-hover:scale-110` animation

---

### v0.8 — Admin Panel + Crash Fix · `a85f947` · `6b82f63`

**Commits:**
- `Fix: lazy-load AdminPage to prevent crash when service key is missing`
- `Add Excel upload & data management admin panel`

**Crash fix:** `supabaseAdmin.js` was statically imported → `createClient(url, undefined)` called at app startup → crashed on Vercel (service key not in env vars).

**Fix:** 
- `AdminPage` changed to `React.lazy(() => import('./AdminPage'))`
- Wrapped in `<Suspense>` with loading spinner
- `supabaseAdmin.js` returns `null` instead of crashing when key is missing
- `AdminPage` shows friendly setup instructions card when `supabaseAdmin === null`

**Admin panel features:**
- Download Excel template (2 sheets: Instructions + Pricelist with examples)
- Drag-and-drop file upload
- Client-side validation (column names, fuel/transmission values, numeric ranges)
- Progress bar during ingest
- Summary: inserted / updated / skipped / errors

---

### v0.7 — Brand Logos · `4a92acb`

**Commit:** `Replace Clearbit logos with ImageKit brand images`

- Replaced 18 Clearbit CDN URLs with ImageKit URLs under `ik.imagekit.io/salasarservices/easy-pricing/`
- Logos hosted on ImageKit for reliability and performance
- Audi removed from the brand logo strip (not in supported brands list)

---

### v0.6 — Login Page Branding · `70e5117`

**Commit:** `Login: replace icon with Salasar logo, update heading text`

- Replaced shield/checkmark SVG with Salasar Services logo (ImageKit, `min-width: 250px`)
- Heading changed from "Welcome back" to "Extended Warranty Calculator"
- Subtitle "Salasar Services · EW Pricing" removed

---

### v0.5 — Glassmorphism UI · `9cbf2f2`

**Commit:** `Redesign UI: glassmorphism, login page, brand logos`

Full UI redesign:
- Dark background `from-slate-900 via-blue-950 to-slate-900`
- Glassmorphism cards: `bg-white/[0.07] backdrop-blur-2xl border border-white/[0.12] rounded-2xl`
- Progress bar (4 steps)
- Fuel/transmission badges with colour coding (Petrol=orange, Diesel=amber, EV=green, etc.)
- Plan cards with "Best Value" badge for cheapest plan
- Brand logo strip
- Ambient decorative blobs (fixed, pointer-events-none)

---

### v0.4 — Vercel + Supabase Migration · `d1cfbe5`

**Commit:** `Migrate to Vercel + Supabase (remove Express backend)`

- Removed Node.js/Express backend
- Frontend queries Supabase directly via anon key
- Deployed to Vercel; backend on Supabase

---

### v0.3 — bcryptjs Login · `d7408fc`

**Commit:** `Add bcryptjs dependency for frontend login password hashing`

- `bcryptjs` added for client-side password hash comparison
- Hardcoded hash in `Login.jsx` — acceptable for internal single-user tool

---

### v0.1–0.2 — Project Foundation

- Initial React + Vite scaffold
- Supabase schema (`schema.sql`)
- GitLab CI/CD configured
- Python ingestion script (`backend/ingest.py`) for bulk 18-brand Excel load (see `INGESTION_HANDOFF.md`)

---

*Last updated: 2026-04-22*
