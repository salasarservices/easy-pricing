// xlsx is loaded lazily — only when the admin panel is first used.
// This keeps the main calculator bundle small.
let _xlsx = null
async function getXLSX() {
  if (!_xlsx) _xlsx = await import('xlsx')
  return _xlsx
}

// ── Column definitions ────────────────────────────────────────────────────────

export const REQUIRED_COLS = [
  'Brand', 'Model', 'Variant', 'Fuel', 'Transmission',
  'Plan_Name', 'Plan_Code', 'Duration_Months',
  'Age_Min_Days', 'Age_Max_Days', 'Price_INR', 'Is_Active',
]
export const OPTIONAL_COLS = ['OEM_Warranty_Months', 'OEM_Warranty_KMs', 'Max_KMs']
export const ALL_COLS       = [...REQUIRED_COLS, ...OPTIONAL_COLS]

export const VALID_FUEL         = ['Petrol', 'Diesel', 'EV', 'CNG', 'Hybrid']
export const VALID_TRANSMISSION = ['Manual', 'Automatic']

// ── Template download ─────────────────────────────────────────────────────────

export async function downloadTemplate() {
  const XLSX = await getXLSX()
  const wb = XLSX.utils.book_new()

  /* — Instructions sheet — */
  const instrRows = [
    ['EW Price Calculator — Data Import Template'],
    ['Salasar Services · Extended Warranty Pricing'],
    [],
    ['HOW TO USE THIS FILE'],
    ['1. Fill your data in the "Pricelist" sheet below (one row = one pricing tier).'],
    ['2. Do NOT rename or delete any column header in row 1.'],
    ['3. Upload this file through the app → Manage Data → Upload Excel.'],
    [],
    ['COLUMN GUIDE'],
    ['Column',             'Required?', 'Allowed values / format',               'Example'],
    ['Brand',              'Yes',       'Any text — must match existing brand name exactly', 'Maruti'],
    ['Model',              'Yes',       'Any text',                              'Swift'],
    ['Variant',            'Yes',       'Any text',                              'LXI'],
    ['Fuel',               'Yes',       'Petrol | Diesel | EV | CNG | Hybrid',   'Petrol'],
    ['Transmission',       'Yes',       'Manual | Automatic',                    'Manual'],
    ['OEM_Warranty_Months','No',        'Number (months)',                        '24'],
    ['OEM_Warranty_KMs',   'No',        'Number (kilometres)',                    '40000'],
    ['Plan_Name',          'Yes',       'Display name shown in app',             'Silver 12M 40K'],
    ['Plan_Code',          'Yes',       'Unique ID — no spaces or special chars','MARUTI_SWIFT_LXI_SIL_12M_40K'],
    ['Duration_Months',    'Yes',       'Number (months of coverage)',            '12'],
    ['Max_KMs',            'No',        'Number — leave blank for unlimited km',  '40000'],
    ['Age_Min_Days',       'Yes',       'Min vehicle age in days (0 = day of purchase)', '0'],
    ['Age_Max_Days',       'Yes',       'Max vehicle age in days (365 = up to 1 year)',  '365'],
    ['Price_INR',          'Yes',       'Amount inclusive of GST',               '15000'],
    ['Is_Active',          'Yes',       'TRUE = show in app | FALSE = hide',     'TRUE'],
    [],
    ['TIPS'],
    ['• One variant can have many plans (e.g. Silver 12M, Gold 12M, Platinum 24M).'],
    ['• One plan can have many age tiers (e.g. 0-365 days at ₹15,000 and 366-730 days at ₹17,500).'],
    ['• To update a price: change Price_INR and re-upload — existing rows are overwritten.'],
    ['• To deactivate a plan without deleting it: set Is_Active to FALSE and re-upload.'],
    ['• Plan_Code must be unique across the entire sheet. Tip: BRAND_MODEL_VARIANT_TIER_DURATION_KM'],
  ]
  const wsInstr = XLSX.utils.aoa_to_sheet(instrRows)
  wsInstr['!cols'] = [{ wch: 55 }, { wch: 12 }, { wch: 42 }, { wch: 36 }]
  // Bold the section titles
  ;['A1', 'A4', 'A9', 'A28'].forEach((ref) => {
    if (wsInstr[ref]) wsInstr[ref].s = { font: { bold: true, sz: 12 } }
  })
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  /* — Pricelist sheet — */
  const headers = ALL_COLS
  const examples = [
    ['Maruti',  'Swift',   'LXI',   'Petrol', 'Manual', 24, 40000, 'Silver 12M 40K',    'MARUTI_SWIFT_LXI_SIL_12M_40K',  12, 40000,  0,   365,  15000, 'TRUE'],
    ['Maruti',  'Swift',   'LXI',   'Petrol', 'Manual', 24, 40000, 'Silver 12M 40K',    'MARUTI_SWIFT_LXI_SIL_12M_40K',  12, 40000,  366, 730,  17500, 'TRUE'],
    ['Maruti',  'Swift',   'LXI',   'Petrol', 'Manual', 24, 40000, 'Gold 12M 40K',      'MARUTI_SWIFT_LXI_GLD_12M_40K',  12, 40000,  0,   365,  19000, 'TRUE'],
    ['Hyundai', 'Creta',   'S',     'Diesel', 'Manual', 36, 40000, 'Platinum 24M 40K',  'HYU_CRETA_S_DSL_PLT_24M_40K',   24, 40000,  0,   365,  28000, 'TRUE'],
    ['Hyundai', 'Creta',   'S',     'Diesel', 'Manual', 36, 40000, 'Platinum 24M 40K',  'HYU_CRETA_S_DSL_PLT_24M_40K',   24, 40000,  366, 730,  31000, 'TRUE'],
    ['Tata',    'Nexon',   'XZ+',   'EV',     'Automatic', 36, 60000, 'EV Shield 24M',  'TATA_NEXON_XZ_EV_SHD_24M',      24, null,   0,   365,  35000, 'TRUE'],
  ]
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...examples])
  const colWidths = [10, 12, 10, 10, 14, 22, 18, 20, 34, 18, 10, 14, 14, 12, 10]
  wsData['!cols'] = colWidths.map((w) => ({ wch: w }))
  wsData['!freeze'] = { xSplit: 0, ySplit: 1 } // freeze header row
  XLSX.utils.book_append_sheet(wb, wsData, 'Pricelist')

  XLSX.writeFile(wb, 'EW_Pricelist_Template.xlsx')
}

// ── Excel parser ──────────────────────────────────────────────────────────────

export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await getXLSX()
        const wb   = XLSX.read(e.target.result, { type: 'array' })
        // Prefer sheet named "Pricelist", fall back to first sheet
        const name = wb.SheetNames.includes('Pricelist') ? 'Pricelist' : wb.SheetNames[0]
        const ws   = wb.Sheets[name]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows)
      } catch (err) {
        reject(new Error('Could not read file: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Row validator ─────────────────────────────────────────────────────────────

export function validateRows(rows) {
  const issues = []

  if (rows.length === 0) {
    issues.push('The Pricelist sheet is empty.')
    return issues
  }

  const cols = Object.keys(rows[0])
  const missing = REQUIRED_COLS.filter((c) => !cols.includes(c))
  if (missing.length) {
    issues.push(`Missing required columns: ${missing.join(', ')}`)
    return issues // can't validate rows without columns
  }

  rows.forEach((row, i) => {
    const rowNum = i + 2 // +1 for header, +1 for 1-index
    if (!row.Brand?.toString().trim())       issues.push(`Row ${rowNum}: Brand is empty`)
    if (!row.Model?.toString().trim())       issues.push(`Row ${rowNum}: Model is empty`)
    if (!row.Variant?.toString().trim())     issues.push(`Row ${rowNum}: Variant is empty`)
    if (!row.Plan_Code?.toString().trim())   issues.push(`Row ${rowNum}: Plan_Code is empty`)
    if (!row.Plan_Name?.toString().trim())   issues.push(`Row ${rowNum}: Plan_Name is empty`)
    if (!VALID_FUEL.includes(row.Fuel))
      issues.push(`Row ${rowNum}: Fuel "${row.Fuel}" is invalid — use ${VALID_FUEL.join(' | ')}`)
    if (!VALID_TRANSMISSION.includes(row.Transmission))
      issues.push(`Row ${rowNum}: Transmission "${row.Transmission}" is invalid — use ${VALID_TRANSMISSION.join(' | ')}`)
    if (isNaN(Number(row.Duration_Months)) || Number(row.Duration_Months) <= 0)
      issues.push(`Row ${rowNum}: Duration_Months must be a positive number`)
    if (isNaN(Number(row.Age_Min_Days)) || Number(row.Age_Min_Days) < 0)
      issues.push(`Row ${rowNum}: Age_Min_Days must be 0 or more`)
    if (isNaN(Number(row.Age_Max_Days)) || Number(row.Age_Max_Days) <= 0)
      issues.push(`Row ${rowNum}: Age_Max_Days must be a positive number`)
    if (Number(row.Age_Min_Days) >= Number(row.Age_Max_Days))
      issues.push(`Row ${rowNum}: Age_Min_Days must be less than Age_Max_Days`)
    if (isNaN(Number(row.Price_INR)) || Number(row.Price_INR) <= 0)
      issues.push(`Row ${rowNum}: Price_INR must be a positive number`)
    const isActive = row.Is_Active?.toString().trim().toUpperCase()
    if (isActive !== 'TRUE' && isActive !== 'FALSE')
      issues.push(`Row ${rowNum}: Is_Active must be TRUE or FALSE`)
  })

  return issues
}

// ── Ingest engine ─────────────────────────────────────────────────────────────

export async function ingestRows(rows, adminClient, onProgress) {
  const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  // ── 1. Pre-load all existing data into memory maps ──────────────────────────
  onProgress({ phase: 'Loading existing data…', done: 0, total: rows.length })

  const [
    { data: exBrands   },
    { data: exModels   },
    { data: exVariants },
    { data: exPlans    },
    { data: exTiers    },
  ] = await Promise.all([
    adminClient.from('brands').select('id, name'),
    adminClient.from('models').select('id, brand_id, name'),
    adminClient.from('variants').select('id, model_id, name, fuel, transmission, oem_warranty_months, oem_warranty_kms'),
    adminClient.from('plans').select('id, variant_id, plan_code, plan_name, duration_months, max_kms'),
    adminClient.from('tiers').select('id, plan_id, min_days, max_days, price_inr, is_active'),
  ])

  const brandMap   = new Map((exBrands   ?? []).map((b) => [b.name.toLowerCase(), b]))
  const modelMap   = new Map((exModels   ?? []).map((m) => [`${m.brand_id}::${m.name.toLowerCase()}`, m]))
  const variantMap = new Map((exVariants ?? []).map((v) => [`${v.model_id}::${v.name.toLowerCase()}::${v.fuel.toLowerCase()}::${v.transmission.toLowerCase()}`, v]))
  const planMap    = new Map((exPlans    ?? []).map((p) => [p.plan_code, p]))
  const tierMap    = new Map((exTiers    ?? []).map((t) => [`${t.plan_id}::${t.min_days}::${t.max_days}`, t]))

  // ── 2. Process rows ─────────────────────────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    onProgress({ phase: `Processing rows…`, done: i + 1, total: rows.length })

    try {
      // ① Brand
      const brandKey = row.Brand.trim().toLowerCase()
      let brand = brandMap.get(brandKey)
      if (!brand) {
        const { data, error } = await adminClient
          .from('brands').insert({ name: row.Brand.trim() }).select().single()
        if (error) throw new Error(`Brand: ${error.message}`)
        brand = data
        brandMap.set(brandKey, brand)
        summary.inserted++
      }

      // ② Model
      const modelKey = `${brand.id}::${row.Model.trim().toLowerCase()}`
      let model = modelMap.get(modelKey)
      if (!model) {
        const { data, error } = await adminClient
          .from('models').insert({ brand_id: brand.id, name: row.Model.trim() }).select().single()
        if (error) throw new Error(`Model: ${error.message}`)
        model = data
        modelMap.set(modelKey, model)
        summary.inserted++
      }

      // ③ Variant
      const variantKey = `${model.id}::${row.Variant.trim().toLowerCase()}::${row.Fuel.toLowerCase()}::${row.Transmission.toLowerCase()}`
      let variant = variantMap.get(variantKey)
      if (!variant) {
        const { data, error } = await adminClient.from('variants').insert({
          model_id:             model.id,
          name:                 row.Variant.trim(),
          fuel:                 row.Fuel,
          transmission:         row.Transmission,
          oem_warranty_months:  row.OEM_Warranty_Months ? Number(row.OEM_Warranty_Months) : null,
          oem_warranty_kms:     row.OEM_Warranty_KMs    ? Number(row.OEM_Warranty_KMs)    : null,
        }).select().single()
        if (error) throw new Error(`Variant: ${error.message}`)
        variant = data
        variantMap.set(variantKey, variant)
        summary.inserted++
      }

      // ④ Plan
      const planCode = row.Plan_Code.trim()
      let plan = planMap.get(planCode)
      if (!plan) {
        const { data, error } = await adminClient.from('plans').insert({
          variant_id:      variant.id,
          plan_name:       row.Plan_Name.trim(),
          plan_code:       planCode,
          duration_months: Number(row.Duration_Months),
          max_kms:         row.Max_KMs ? Number(row.Max_KMs) : null,
        }).select().single()
        if (error) throw new Error(`Plan: ${error.message}`)
        plan = data
        planMap.set(planCode, plan)
        summary.inserted++
      } else {
        // Update plan metadata (name, duration, max_kms) if changed
        const durationChanged = plan.duration_months !== Number(row.Duration_Months)
        const kmsChanged      = plan.max_kms !== (row.Max_KMs ? Number(row.Max_KMs) : null)
        const nameChanged     = plan.plan_name !== row.Plan_Name.trim()
        if (durationChanged || kmsChanged || nameChanged) {
          const { error } = await adminClient.from('plans').update({
            plan_name:       row.Plan_Name.trim(),
            duration_months: Number(row.Duration_Months),
            max_kms:         row.Max_KMs ? Number(row.Max_KMs) : null,
          }).eq('id', plan.id)
          if (error) throw new Error(`Plan update: ${error.message}`)
          plan = { ...plan, plan_name: row.Plan_Name.trim(), duration_months: Number(row.Duration_Months), max_kms: row.Max_KMs ? Number(row.Max_KMs) : null }
          planMap.set(planCode, plan)
        }
      }

      // ⑤ Tier — this is where the price lives (the core upsert)
      const minDays  = Number(row.Age_Min_Days)
      const maxDays  = Number(row.Age_Max_Days)
      const priceINR = Number(row.Price_INR)
      const isActive = row.Is_Active.toString().trim().toUpperCase() === 'TRUE'
      const tierKey  = `${plan.id}::${minDays}::${maxDays}`
      const tier     = tierMap.get(tierKey)

      if (!tier) {
        const { error } = await adminClient.from('tiers').insert({
          plan_id:   plan.id,
          min_days:  minDays,
          max_days:  maxDays,
          price_inr: priceINR,
          is_active: isActive,
        })
        if (error) throw new Error(`Tier: ${error.message}`)
        summary.inserted++
      } else if (tier.price_inr !== priceINR || tier.is_active !== isActive) {
        const { error } = await adminClient.from('tiers').update({
          price_inr: priceINR,
          is_active: isActive,
        }).eq('id', tier.id)
        if (error) throw new Error(`Tier update: ${error.message}`)
        tierMap.set(tierKey, { ...tier, price_inr: priceINR, is_active: isActive })
        summary.updated++
      } else {
        summary.skipped++
      }

    } catch (err) {
      summary.errors.push({ row: i + 2, message: err.message })
    }
  }

  return summary
}
