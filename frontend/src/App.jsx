import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login'
import AdminPage from './AdminPage'

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatINR = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)

const getVehicleAge = (dateStr) => {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (days < 0) return { days, label: null, eligible: false }
  const years  = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  const parts  = []
  if (years  > 0) parts.push(`${years} yr${years  > 1 ? 's' : ''}`)
  if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`)
  return {
    days,
    label:    parts.length ? parts.join(' ') : 'Less than 1 month old',
    eligible: days >= 0 && days <= 1095,
  }
}

const FUEL_STYLES = {
  Petrol:  'bg-orange-500/20 text-orange-300 ring-orange-400/30',
  Diesel:  'bg-amber-500/20  text-amber-300  ring-amber-400/30',
  EV:      'bg-green-500/20  text-green-300  ring-green-400/30',
  CNG:     'bg-teal-500/20   text-teal-300   ring-teal-400/30',
  Hybrid:  'bg-purple-500/20 text-purple-300 ring-purple-400/30',
}

// Car brand logos
const BASE = 'https://ik.imagekit.io/salasarservices/easy-pricing'
const BRAND_LOGOS = [
  { name: 'Maruti',      url: `${BASE}/maruti.png` },
  { name: 'Hyundai',     url: `${BASE}/hyundai.png` },
  { name: 'Tata',        url: `${BASE}/tata.png` },
  { name: 'Mahindra',    url: `${BASE}/mahindra.png` },
  { name: 'Kia',         url: `${BASE}/Kia-Logo-PNG.png` },
  { name: 'Toyota',      url: `${BASE}/toyota.png` },
  { name: 'Honda',       url: `${BASE}/honda.png` },
  { name: 'Renault',     url: `${BASE}/renault.png` },
  { name: 'Skoda',       url: `${BASE}/skoda.png` },
  { name: 'Volkswagen',  url: `${BASE}/volkswagen.webp` },
  { name: 'Jeep',        url: `${BASE}/jeep.png` },
  { name: 'Citroen',     url: `${BASE}/citroen.png` },
  { name: 'MG',          url: `${BASE}/morris-garrage.jpg` },
  { name: 'Mercedes',    url: `${BASE}/mercedes.webp` },
  { name: 'BMW',         url: `${BASE}/bmw.jpg` },
  { name: 'MINI',        url: `${BASE}/mini.jpg` },
  { name: 'Jaguar',      url: `${BASE}/jaguar.png` },
  { name: 'Land Rover',  url: `${BASE}/landrover.png` },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function Badge({ label, styleKey }) {
  const cls = FUEL_STYLES[styleKey] ?? 'bg-white/10 text-slate-300 ring-white/20'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}>
      {label}
    </span>
  )
}

function SelectField({ step, label, value, onChange, options, disabled, placeholder }) {
  const filled  = Boolean(value)
  const stepCls = filled
    ? 'bg-blue-600 text-white'
    : disabled
    ? 'bg-white/5 text-slate-600'
    : 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40'

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-200 select-none">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 transition-colors ${stepCls}`}>
          {filled ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : step}
        </span>
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={`w-full appearance-none rounded-xl border px-4 py-3 pr-10 text-sm outline-none transition-all
            ${disabled
              ? 'bg-white/[0.03] border-white/[0.08] text-slate-600 cursor-not-allowed'
              : filled
              ? 'bg-slate-900/80 border-blue-400/60 text-white ring-2 ring-blue-400/20'
              : 'bg-slate-900/70 border-white/20 text-white hover:border-white/30 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20 cursor-pointer'
            }`}
        >
          <option value="" className="bg-slate-900 text-slate-300">{placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-slate-900 text-white">{o.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center">
          <svg className={`w-4 h-4 transition-colors ${disabled ? 'text-slate-700' : 'text-slate-400'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function PlanCard({ plan, rank }) {
  const isBest    = rank === 0
  const isPremium = rank === 2

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all hover:shadow-lg animate-slide-up backdrop-blur-sm
        ${isBest
          ? 'border-blue-400/50 bg-blue-500/[0.18] shadow-blue-500/10'
          : 'border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.10]'}`}
      style={{ animationDelay: `${rank * 60}ms` }}
    >
      {isBest && (
        <div className="absolute -top-3 left-4">
          <span className="inline-flex items-center gap-1 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Best Value
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mt-1">
        <div className="min-w-0">
          <p className={`font-semibold text-sm leading-snug truncate ${isBest ? 'text-blue-200' : 'text-slate-200'}`}>
            {plan.plan_name}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className={`inline-flex items-center gap-1 text-xs ${isBest ? 'text-blue-300' : 'text-slate-400'}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {plan.duration_months} months
            </span>
            <span className={`inline-flex items-center gap-1 text-xs ${isBest ? 'text-blue-300' : 'text-slate-400'}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {plan.max_kms ? `${Number(plan.max_kms).toLocaleString('en-IN')} km` : 'Unlimited km'}
            </span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className={`text-xl font-bold ${isBest ? 'text-blue-300' : isPremium ? 'text-slate-300' : 'text-emerald-400'}`}>
            {formatINR(plan.price)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">incl. GST</p>
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ step }) {
  const steps = ['Brand', 'Model', 'Variant', 'Date']
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
              ${i < step  ? 'bg-blue-600 text-white'
              : i === step ? 'bg-blue-500/30 text-blue-300 ring-2 ring-blue-400/50'
                           : 'bg-white/10 text-slate-500'}`}>
              {i < step ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-xs mt-1 font-medium hidden sm:block
              ${i <= step ? 'text-slate-300' : 'text-slate-600'}`}>
              {s}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1 mb-4 transition-all ${i < step ? 'bg-blue-500' : 'bg-white/10'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// Brand logo strip
function BrandLogoStrip() {
  return (
    <div className="max-w-lg mx-auto mt-8">
      <p className="text-center text-slate-600 text-xs uppercase tracking-widest mb-4 font-semibold">
        Supported Brands
      </p>
      <div className="flex flex-wrap justify-center gap-3.5">
        {BRAND_LOGOS.map((brand) => (
          <BrandLogo key={brand.name} brand={brand} />
        ))}
      </div>
    </div>
  )
}

function BrandLogo({ brand }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="group flex flex-col items-center gap-1.5 cursor-default">
      <div className="w-14 h-10 bg-white rounded-lg flex items-center justify-center overflow-hidden transition-all duration-200 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-white/20 shadow-sm">
        {imgFailed ? (
          <span className="text-slate-700 text-xs font-bold">{brand.name.slice(0, 2).toUpperCase()}</span>
        ) : (
          <img
            src={brand.url}
            alt={brand.name}
            className="w-12 h-8 object-contain p-0.5"
            onError={() => setImgFailed(true)}
          />
        )}
      </div>
      <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition-colors font-medium">
        {brand.name}
      </span>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />
  }

  return <Dashboard onLogout={() => setLoggedIn(false)} />
}

function Dashboard({ onLogout }) {
  const [showAdmin, setShowAdmin] = useState(false)

  const [brands,   setBrands]   = useState([])
  const [models,   setModels]   = useState([])
  const [variants, setVariants] = useState([])
  const [variant,  setVariant]  = useState(null)

  const [sel, setSel] = useState({ brandId: '', modelId: '', variantId: '', date: '' })
  const [results, setResults] = useState(null)

  const [busy, setBusy] = useState({
    brands: true, models: false, variants: false, calc: false,
  })
  const [error, setError] = useState(null)

  const age      = getVehicleAge(sel.date)
  const today    = new Date().toISOString().split('T')[0]
  const minDate  = new Date(Date.now() - 1095 * 86_400_000).toISOString().split('T')[0]
  const canCalc  = sel.variantId && sel.date && age?.eligible && !busy.calc

  const currentStep = sel.brandId ? sel.modelId ? sel.variantId ? 3 : 2 : 1 : 0

  useEffect(() => {
    supabase.from('brands').select('id, name').order('name')
      .then(({ data, error: e }) => {
        setBusy((b) => ({ ...b, brands: false }))
        if (e) setError('Could not load brands — check Supabase config.')
        else setBrands(data ?? [])
      })
  }, [])

  useEffect(() => {
    if (!sel.brandId) { setModels([]); return }
    setBusy((b) => ({ ...b, models: true }))
    setModels([]); setVariants([]); setVariant(null); setResults(null)
    setSel((s) => ({ ...s, modelId: '', variantId: '' }))
    supabase.from('models').select('id, name').eq('brand_id', sel.brandId).order('name')
      .then(({ data }) => { setModels(data ?? []); setBusy((b) => ({ ...b, models: false })) })
  }, [sel.brandId])

  useEffect(() => {
    if (!sel.modelId) { setVariants([]); return }
    setBusy((b) => ({ ...b, variants: true }))
    setVariants([]); setVariant(null); setResults(null)
    setSel((s) => ({ ...s, variantId: '' }))
    supabase.from('variants').select('*').eq('model_id', sel.modelId).order('name')
      .then(({ data }) => { setVariants(data ?? []); setBusy((b) => ({ ...b, variants: false })) })
  }, [sel.modelId])

  function handleVariantChange(e) {
    const id = e.target.value
    setSel((s) => ({ ...s, variantId: id }))
    setVariant(variants.find((v) => v.id === id) ?? null)
    setResults(null)
  }

  async function handleCalculate() {
    if (!canCalc) return
    setBusy((b) => ({ ...b, calc: true }))
    setError(null)
    try {
      const days = Math.floor((Date.now() - new Date(sel.date).getTime()) / 86_400_000)
      const { data, error: e } = await supabase
        .from('tiers')
        .select('price_inr, plans!inner(plan_name, plan_code, duration_months, max_kms, variant_id)')
        .eq('plans.variant_id', sel.variantId)
        .eq('is_active', true)
        .lte('min_days', days)
        .gte('max_days', days)
        .order('price_inr', { ascending: true })
      if (e) throw new Error(e.message)
      setResults((data ?? []).map((row) => ({
        plan_name:       row.plans.plan_name,
        plan_code:       row.plans.plan_code,
        duration_months: row.plans.duration_months,
        max_kms:         row.plans.max_kms,
        price:           parseFloat(row.price_inr),
      })))
    } catch (err) {
      setError(err.message)
      setResults([])
    } finally {
      setBusy((b) => ({ ...b, calc: false }))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 py-10 px-4 relative overflow-x-hidden">

      {/* Decorative ambient blobs */}
      <div className="fixed top-[-250px] left-[-250px] w-[700px] h-[700px] rounded-full bg-blue-700/15 blur-3xl pointer-events-none" />
      <div className="fixed bottom-[-250px] right-[-250px] w-[700px] h-[700px] rounded-full bg-indigo-800/15 blur-3xl pointer-events-none" />
      <div className="fixed top-1/3 right-0 w-[400px] h-[400px] rounded-full bg-blue-900/20 blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <header className="max-w-lg mx-auto mb-8 text-center animate-fade-in relative">
        {/* Top-right actions */}
        <div className="absolute right-0 top-0 flex items-center gap-1">
          {/* Manage Data */}
          <button
            onClick={() => setShowAdmin((v) => !v)}
            title="Manage Data"
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors px-3 py-1.5 rounded-lg
              ${showAdmin
                ? 'text-blue-300 bg-blue-500/20 hover:bg-blue-500/30'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {showAdmin ? 'Calculator' : 'Manage Data'}
          </button>
          {/* Sign out */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>

        <div className="inline-flex items-center gap-2 bg-white/[0.08] backdrop-blur-sm rounded-full px-4 py-1.5 text-blue-200 text-xs font-semibold mb-4 ring-1 ring-white/10">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          Salasar Services · Extended Warranty
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-2">
          Find Your Coverage Plan
        </h1>
        <p className="text-slate-400 text-sm">
          Instant pricing across 17+ brands · All prices include GST
        </p>
      </header>

      {/* ── Admin Panel ── */}
      {showAdmin && (
        <main className="max-w-lg mx-auto relative z-10 mb-10">
          <AdminPage onClose={() => setShowAdmin(false)} />
        </main>
      )}

      {/* ── Form Card (Glassmorphism) ── */}
      <main className={`max-w-lg mx-auto relative z-10 ${showAdmin ? 'hidden' : ''}`}>
        <div className="bg-white/[0.07] backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden animate-slide-up">

          {/* Card header */}
          <div className="bg-gradient-to-r from-blue-700/70 to-blue-600/70 backdrop-blur-sm px-6 py-4 border-b border-white/[0.08]">
            <p className="text-blue-100 text-xs font-semibold uppercase tracking-widest">
              Vehicle Details
            </p>
          </div>

          <div className="p-6 pt-5 space-y-5">
            {/* Progress */}
            <ProgressBar step={currentStep} />

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-3 p-3.5 bg-red-500/[0.15] border border-red-500/30 rounded-xl text-sm text-red-300 animate-fade-in">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* ① Brand */}
            <SelectField
              step="1" label="Brand"
              value={sel.brandId}
              onChange={(e) => setSel((s) => ({ ...s, brandId: e.target.value }))}
              options={brands.map((b) => ({ id: b.id, label: b.name }))}
              disabled={busy.brands}
              placeholder={busy.brands ? 'Loading brands…' : 'Select a brand'}
            />

            {/* ② Model */}
            <SelectField
              step="2" label="Model"
              value={sel.modelId}
              onChange={(e) => { setSel((s) => ({ ...s, modelId: e.target.value })); setResults(null) }}
              options={models.map((m) => ({ id: m.id, label: m.name }))}
              disabled={!sel.brandId || busy.models}
              placeholder={busy.models ? 'Loading models…' : 'Select a model'}
            />

            {/* ③ Variant */}
            <SelectField
              step="3" label="Variant"
              value={sel.variantId}
              onChange={handleVariantChange}
              options={variants.map((v) => ({
                id:    v.id,
                label: `${v.name}  ·  ${v.fuel}  ·  ${v.transmission}`,
              }))}
              disabled={!sel.modelId || busy.variants}
              placeholder={busy.variants ? 'Loading variants…' : 'Select a variant'}
            />

            {/* Variant badges */}
            {variant && (
              <div className="flex flex-wrap gap-2 -mt-1 pl-8 animate-fade-in">
                <Badge label={variant.fuel} styleKey={variant.fuel} />
                <Badge label={variant.transmission} />
                {variant.oem_warranty_months && (
                  <Badge label={`OEM: ${variant.oem_warranty_months}m / ${(variant.oem_warranty_kms / 1000).toFixed(0)}K km`} />
                )}
              </div>
            )}

            {/* ④ Purchase Date */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-200 select-none">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 transition-colors
                  ${sel.date && age?.eligible
                    ? 'bg-blue-600 text-white'
                    : sel.date && !age?.eligible
                    ? 'bg-red-500 text-white'
                    : !sel.variantId
                    ? 'bg-white/5 text-slate-600'
                    : 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40'}`}>
                  {sel.date && age?.eligible ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : '4'}
                </span>
                Purchase Date
              </label>
              <input
                type="date"
                value={sel.date}
                onChange={(e) => { setSel((s) => ({ ...s, date: e.target.value })); setResults(null) }}
                min={minDate}
                max={today}
                disabled={!sel.variantId}
                className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all
                  ${!sel.variantId
                    ? 'bg-white/[0.03] border-white/[0.08] text-slate-600 cursor-not-allowed'
                    : sel.date && !age?.eligible
                    ? 'bg-red-500/[0.12] border-red-400/40 text-red-300 ring-2 ring-red-400/20'
                    : sel.date
                    ? 'bg-slate-900/80 border-blue-400/60 text-white ring-2 ring-blue-400/20'
                    : 'bg-slate-900/70 border-white/20 text-white hover:border-white/30 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20 cursor-pointer'}`}
              />
              {age && (
                <p className={`text-xs pl-8 transition-colors ${age.eligible ? 'text-slate-500' : 'text-red-400 font-medium'}`}>
                  {age.eligible
                    ? `Vehicle age: ${age.label} (${age.days} days since purchase)`
                    : age.days < 0
                    ? 'Date cannot be in the future'
                    : 'Vehicle is over 3 years old — not eligible for extended warranty'}
                </p>
              )}
            </div>

            {/* CTA */}
            <button
              onClick={handleCalculate}
              disabled={!canCalc}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500
                disabled:bg-white/[0.05] disabled:text-slate-600 disabled:cursor-not-allowed
                text-white font-semibold py-3.5 rounded-xl transition-all text-sm
                shadow-lg hover:shadow-blue-500/25 active:scale-[0.99] mt-1"
            >
              {busy.calc ? (
                <><Spinner /> Calculating…</>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  View Available Plans
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Results (Glassmorphism) ── */}
        {results !== null && (
          <div className="mt-5 animate-slide-up">
            {results.length === 0 ? (
              <div className="bg-white/[0.07] backdrop-blur-2xl border border-white/[0.12] rounded-2xl p-8 text-center shadow-xl">
                <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-white font-semibold text-base">No plans available</p>
                <p className="text-slate-500 text-sm mt-1.5 max-w-xs mx-auto">
                  No coverage plans found for the selected variant and purchase date.
                </p>
              </div>
            ) : (
              <div className="bg-white/[0.07] backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-700/70 to-emerald-600/70 backdrop-blur-sm px-6 py-4 flex items-center justify-between border-b border-white/[0.08]">
                  <p className="text-emerald-100 text-xs font-semibold uppercase tracking-widest">
                    Available Plans
                  </p>
                  <span className="bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">
                    {results.length} plan{results.length !== 1 ? 's' : ''} found
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {results.map((plan, i) => (
                    <PlanCard key={i} plan={plan} rank={i} />
                  ))}

                  <div className="pt-2 pb-1 text-center space-y-0.5">
                    <p className="text-xs text-slate-600">
                      Prices sorted by value · Vehicle age: {age?.label}
                    </p>
                    <p className="text-xs text-slate-600">
                      All amounts inclusive of GST
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Brand Logos ── */}
      {!showAdmin && <BrandLogoStrip />}

      {/* ── Footer ── */}
      <footer className="max-w-lg mx-auto mt-6 text-center">
        <p className="text-slate-700 text-xs">
          © {new Date().getFullYear()} Salasar Services · Extended Warranty Pricing Engine
        </p>
      </footer>
    </div>
  )
}
