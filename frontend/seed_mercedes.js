/**
 * seed_mercedes.js — one-shot data seeder for Mercedes-Benz EW rate sheet
 *
 * Pricing source: "Rates for Advance Assurance (Extended Warranty)
 *                  for Mercedes-Benz vehicles (With GST)"
 *
 * Run from the frontend/ directory:
 *   node seed_mercedes.js
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ── Load .env.local ────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
try {
  const envText = readFileSync(join(__dir, '.env.local'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
} catch { /* .env.local not found — fall through to process.env */ }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌  Missing env vars:')
  if (!SUPABASE_URL) console.error('   VITE_SUPABASE_URL')
  if (!SUPABASE_KEY) console.error('   VITE_SUPABASE_SERVICE_KEY')
  console.error('   Make sure .env.local exists in the frontend/ folder.\n')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Age-tier brackets (same for every plan) ────────────────────────────────────
const AGE_TIERS = [
  { label: '0–6 Months',   min: 0,   max: 182  },
  { label: '6–12 Months',  min: 183, max: 365  },
  { label: '1–2 Years',    min: 366, max: 730  },
  { label: '2–3 Years',    min: 731, max: 1095 },
]

// ── Plan definitions ───────────────────────────────────────────────────────────
const PLAN_DEFS = [
  { name: '4th Year (Optional)',              suffix: '4Y',      months: 12 },
  { name: '4th + 5th Year (Optional)',        suffix: '4Y5Y',    months: 24 },
  { name: '4th + 5th + 6th Year (Optional)', suffix: '4Y5Y6Y',  months: 36 },
]

// ── Pricing matrix extracted from rate sheet ───────────────────────────────────
// Rows = plans (4Y / 4Y5Y / 4Y5Y6Y)
// Cols = age tiers (0-6M / 6-12M / 1-2Y / 2-3Y)

const C_CLASS_PRICES = [
  // 4th Year (Optional)
  [ 71_862,  97_468, 107_380, 133_340],
  // 4th + 5th Year (Optional)
  [141_364, 192_104, 211_810, 263_848],
  // 4th + 5th + 6th Year (Optional)
  [216_412, 298_540, 329_220, 410_522],
]

const E_CLASS_PRICES = [
  // 4th Year (Optional)
  [ 80_004, 108_796, 120_006, 149_506],
  // 4th + 5th Year (Optional)
  [156_940, 213_580, 235_882, 293_820],
  // 4th + 5th + 6th Year (Optional)
  [239_422, 331_108, 365_446, 455_598],
]

// ── Seed manifest ──────────────────────────────────────────────────────────────
// Each entry → 1 model with N variants; every variant gets the same 3 plans × 4 tiers
const SEED = [
  {
    brand:     'Mercedes-Benz',
    model:     'C Class',
    oemMonths: 36,
    prices:    C_CLASS_PRICES,
    // "All Models including 300d AMG Line" — same pricing for Petrol & Diesel;
    // DB unique constraint is on (model_id, name) so variants must have distinct names.
    variants: [
      { name: 'C Class',          fuel: 'Petrol', transmission: 'Automatic', codePrefix: 'MB_C_P_AT' },
      { name: 'C Class 300d AMG', fuel: 'Diesel', transmission: 'Automatic', codePrefix: 'MB_C_D_AT' },
    ],
  },
  {
    brand:     'Mercedes-Benz',
    model:     'E Class',
    oemMonths: 36,
    prices:    E_CLASS_PRICES,
    variants: [
      { name: 'E Class', fuel: 'Petrol', transmission: 'Automatic', codePrefix: 'MB_E_P_AT' },
    ],
  },
]

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function findOrCreate(table, matchCols, insertData) {
  const query = db.from(table).select('id')
  for (const [col, val] of Object.entries(matchCols)) query.eq(col, val)
  const { data: found } = await query.maybeSingle()
  if (found) return { id: found.id, created: false }

  const { data, error } = await db.from(table).insert(insertData).select('id').single()
  if (error) throw new Error(`[${table}] insert failed: ${error.message}`)
  return { id: data.id, created: true }
}

async function upsertTier(planId, min, max, price) {
  const { data: existing } = await db
    .from('tiers').select('id, price_inr')
    .eq('plan_id', planId).eq('min_days', min).eq('max_days', max)
    .maybeSingle()

  if (!existing) {
    const { error } = await db.from('tiers').insert({
      plan_id: planId, min_days: min, max_days: max, price_inr: price, is_active: true,
    })
    if (error) throw new Error(`[tiers] insert failed: ${error.message}`)
    return 'inserted'
  }
  if (Number(existing.price_inr) !== price) {
    const { error } = await db.from('tiers').update({ price_inr: price }).eq('id', existing.id)
    if (error) throw new Error(`[tiers] update failed: ${error.message}`)
    return 'updated'
  }
  return 'skipped'
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🚀  Mercedes-Benz EW data seeder starting…\n')
  const counts = { inserted: 0, updated: 0, skipped: 0 }

  for (const entry of SEED) {
    console.log(`━━━  ${entry.brand}  ›  ${entry.model}`)

    const { id: brandId } = await findOrCreate(
      'brands',
      { name: entry.brand },
      { name: entry.brand }
    )

    const { id: modelId } = await findOrCreate(
      'models',
      { brand_id: brandId, name: entry.model },
      { brand_id: brandId, name: entry.model }
    )

    for (const v of entry.variants) {
      console.log(`\n  🚗  ${v.name}  ·  ${v.fuel}  ·  ${v.transmission}`)

      // Variant uniqueness in DB is on (model_id, name) — match only those two cols
      const { id: variantId, created: vCreated } = await findOrCreate(
        'variants',
        { model_id: modelId, name: v.name },
        {
          model_id:            modelId,
          name:                v.name,
          fuel:                v.fuel,
          transmission:        v.transmission,
          oem_warranty_months: entry.oemMonths,
          oem_warranty_kms:    null,
        }
      )
      if (vCreated) counts.inserted++

      for (let pi = 0; pi < PLAN_DEFS.length; pi++) {
        const pd       = PLAN_DEFS[pi]
        const planCode = `${v.codePrefix}_${pd.suffix}`

        const { id: planId, created: pCreated } = await findOrCreate(
          'plans',
          { plan_code: planCode },
          {
            variant_id:      variantId,
            plan_code:       planCode,
            plan_name:       pd.name,
            duration_months: pd.months,
            max_kms:         null,
          }
        )
        if (pCreated) counts.inserted++

        console.log(`\n    📋  ${pd.name}`)

        for (let ti = 0; ti < AGE_TIERS.length; ti++) {
          const t      = AGE_TIERS[ti]
          const price  = entry.prices[pi][ti]
          const result = await upsertTier(planId, t.min, t.max, price)

          const icon = result === 'inserted' ? '✅' : result === 'updated' ? '🔄' : '⏭️ '
          console.log(`      ${icon}  ${t.label.padEnd(13)}  days ${String(t.min).padStart(3)}–${String(t.max).padEnd(4)}  →  ₹${price.toLocaleString('en-IN')}  (${result})`)

          if (result === 'inserted')     counts.inserted++
          else if (result === 'updated') counts.updated++
          else                           counts.skipped++
        }
      }
    }

    console.log()
  }

  const { inserted: ins, updated: upd, skipped: skip } = counts
  console.log('─'.repeat(60))
  console.log(`🎉  Done!   ✅ Inserted: ${ins}   🔄 Updated: ${upd}   ⏭️  Skipped: ${skip}`)
  console.log('─'.repeat(60) + '\n')
}

run().catch((err) => {
  console.error('\n❌  Fatal error:', err.message)
  process.exit(1)
})
