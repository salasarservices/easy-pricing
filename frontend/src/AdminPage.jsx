import { useState, useRef, useCallback } from 'react'
import supabaseAdmin from './lib/supabaseAdmin'
import {
  downloadTemplate,
  parseExcelFile,
  validateRows,
  ingestRows,
  ALL_COLS,
} from './lib/excelIngest'

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function GlassCard({ children, className = '' }) {
  return (
    <div className={`bg-white/[0.07] backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-xl overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ icon, title, subtitle, accent = 'blue' }) {
  const grad = accent === 'emerald'
    ? 'from-emerald-700/70 to-emerald-600/70'
    : 'from-blue-700/70 to-blue-600/70'
  return (
    <div className={`bg-gradient-to-r ${grad} backdrop-blur-sm px-6 py-4 border-b border-white/[0.08] flex items-center gap-3`}>
      <div className="text-white/80">{icon}</div>
      <div>
        <p className="text-white text-sm font-semibold">{title}</p>
        {subtitle && <p className="text-white/60 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

// ── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({ rows }) {
  const preview = rows.slice(0, 6)
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.10]">
      <table className="text-xs w-full min-w-max">
        <thead>
          <tr className="bg-white/[0.08]">
            {ALL_COLS.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-slate-300 font-semibold whitespace-nowrap border-b border-white/[0.08]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.05] hover:bg-white/[0.04]">
              {ALL_COLS.map((c) => (
                <td key={c} className="px-3 py-1.5 text-slate-400 whitespace-nowrap max-w-[140px] truncate">
                  {row[c] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 6 && (
        <p className="text-center text-slate-600 text-xs py-2">
          …and {rows.length - 6} more rows
        </p>
      )}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ done, total, phase }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{phase}</span>
        <span>{done} / {total} rows ({pct}%)</span>
      </div>
      <div className="h-2 bg-white/[0.08] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Summary result ────────────────────────────────────────────────────────────

function Summary({ result }) {
  const { inserted, updated, skipped, errors } = result
  const total = inserted + updated + skipped + errors.length
  const allOk = errors.length === 0

  return (
    <div className={`rounded-xl border p-4 space-y-4 ${allOk ? 'border-emerald-400/30 bg-emerald-500/[0.08]' : 'border-amber-400/30 bg-amber-500/[0.08]'}`}>
      <div className="flex items-center gap-2">
        {allOk ? (
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        )}
        <p className={`font-semibold text-sm ${allOk ? 'text-emerald-300' : 'text-amber-300'}`}>
          {allOk ? `Import complete — ${total} rows processed` : `Import finished with ${errors.length} error${errors.length > 1 ? 's' : ''}`}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Inserted',  count: inserted, color: 'text-emerald-400' },
          { label: 'Updated',   count: updated,  color: 'text-blue-400'    },
          { label: 'Skipped',   count: skipped,  color: 'text-slate-400'   },
          { label: 'Errors',    count: errors.length, color: 'text-red-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="bg-white/[0.05] rounded-lg p-3 text-center">
            <p className={`text-xl font-bold ${color}`}>{count}</p>
            <p className="text-slate-500 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Errors</p>
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-300 bg-red-500/[0.10] rounded px-2.5 py-1">
              Row {e.row}: {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

export default function AdminPage({ onClose }) {
  const [file,        setFile]        = useState(null)
  const [rows,        setRows]        = useState(null)
  const [parseError,  setParseError]  = useState(null)
  const [validIssues, setValidIssues] = useState([])
  const [dragging,    setDragging]    = useState(false)
  const [progress,    setProgress]    = useState(null)   // { phase, done, total }
  const [result,      setResult]      = useState(null)
  const [running,     setRunning]     = useState(false)
  const fileRef = useRef(null)

  // ── File handling ───────────────────────────────────────────────────────────

  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setRows(null)
    setParseError(null)
    setValidIssues([])
    setResult(null)
    try {
      const parsed = await parseExcelFile(f)
      const issues = validateRows(parsed)
      setRows(parsed)
      setValidIssues(issues)
    } catch (err) {
      setParseError(err.message)
    }
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [])

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true) },  [])
  const onDragLeave = useCallback(()  => setDragging(false), [])

  // ── Ingest ──────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!rows || validIssues.length > 0 || running) return
    setRunning(true)
    setResult(null)
    try {
      const summary = await ingestRows(rows, supabaseAdmin, (prog) => setProgress(prog))
      setResult(summary)
    } catch (err) {
      setResult({ inserted: 0, updated: 0, skipped: 0, errors: [{ row: '?', message: err.message }] })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  function reset() {
    setFile(null); setRows(null); setParseError(null)
    setValidIssues([]); setResult(null); setProgress(null)
  }

  const canImport = rows && rows.length > 0 && validIssues.length === 0 && !running

  // ── Render ──────────────────────────────────────────────────────────────────

  // Service key not configured (e.g. Vercel env var missing)
  if (!supabaseAdmin) {
    return (
      <div className="animate-fade-in space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Data Management</h2>
          <button onClick={onClose} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white/[0.07] border-white/[0.12] text-slate-300 hover:bg-white/[0.13] hover:border-white/20 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Calculator
          </button>
        </div>
        <div className="bg-amber-500/[0.10] border border-amber-400/30 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Service key not configured
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            The admin panel requires <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono text-amber-200">VITE_SUPABASE_SERVICE_KEY</code> to be set as an environment variable.
          </p>
          <div className="text-xs text-slate-500 space-y-1 bg-white/[0.04] rounded-xl p-4 font-mono">
            <p className="text-slate-300 font-sans font-semibold text-xs mb-2">To fix on Vercel:</p>
            <p>1. Go to your Vercel project → Settings → Environment Variables</p>
            <p>2. Add: <span className="text-amber-300">VITE_SUPABASE_SERVICE_KEY</span></p>
            <p>3. Value: copy from <span className="text-slate-400">backend/.env</span> → SUPABASE_SERVICE_KEY</p>
            <p>4. Redeploy</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Data Management</h2>
          <p className="text-slate-400 text-sm mt-0.5">Upload a pricelist Excel to update brands, models, variants and rates</p>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white/[0.07] border-white/[0.12] text-slate-300 hover:bg-white/[0.13] hover:border-white/20 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Calculator
        </button>
      </div>

      {/* ── Download Template ── */}
      <GlassCard>
        <CardHeader
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          title="Step 1 — Download Template"
          subtitle="Get the pre-formatted Excel file with instructions and example rows"
        />
        <div className="p-6 flex items-center justify-between gap-6">
          <div className="space-y-1 text-sm text-slate-400 max-w-sm">
            <p>The template includes:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-500 mt-1">
              <li>All required columns with correct headers</li>
              <li>An Instructions sheet explaining every column</li>
              <li>3 example rows showing the exact format</li>
              <li>Frozen header row for easy scrolling</li>
            </ul>
          </div>
          <button
            onClick={downloadTemplate}
            className="shrink-0 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Template
          </button>
        </div>
      </GlassCard>

      {/* ── Upload & Ingest ── */}
      <GlassCard>
        <CardHeader
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
          title="Step 2 — Upload & Import"
          subtitle="Fill the template, save, then upload here — new rows are inserted, changed prices are updated"
          accent="emerald"
        />

        <div className="p-6 space-y-5">

          {/* Drop zone */}
          {!file && (
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => fileRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
                ${dragging
                  ? 'border-blue-400/70 bg-blue-500/[0.10]'
                  : 'border-white/[0.15] hover:border-white/30 hover:bg-white/[0.04]'}`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <svg className="w-10 h-10 mx-auto text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-slate-300 font-medium text-sm">Drop your Excel file here</p>
              <p className="text-slate-600 text-xs mt-1">or click to browse · .xlsx / .xls</p>
            </div>
          )}

          {/* File selected state */}
          {file && !running && (
            <div className="flex items-center justify-between gap-3 bg-white/[0.05] border border-white/[0.10] rounded-xl px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <svg className="w-8 h-8 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">{file.name}</p>
                  <p className="text-slate-500 text-xs">
                    {rows ? `${rows.length} data rows found` : 'Parsing…'}
                  </p>
                </div>
              </div>
              <button onClick={reset} className="text-slate-500 hover:text-slate-300 transition-colors text-xs shrink-0 px-2 py-1 rounded hover:bg-white/5">
                Change file
              </button>
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-500/[0.12] border border-red-500/30 rounded-xl text-sm text-red-300">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {parseError}
            </div>
          )}

          {/* Validation issues */}
          {validIssues.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {validIssues.length} issue{validIssues.length > 1 ? 's' : ''} found — fix before importing
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {validIssues.map((issue, i) => (
                  <p key={i} className="text-xs text-amber-300 bg-amber-500/[0.08] rounded px-2.5 py-1">{issue}</p>
                ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          {rows && rows.length > 0 && validIssues.length === 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Preview — first {Math.min(rows.length, 6)} of {rows.length} rows
              </p>
              <PreviewTable rows={rows} />
            </div>
          )}

          {/* Progress */}
          {running && progress && (
            <ProgressBar
              phase={progress.phase}
              done={progress.done}
              total={progress.total}
            />
          )}

          {/* Result */}
          {result && <Summary result={result} />}

          {/* Import button */}
          {!result && (
            <button
              onClick={handleImport}
              disabled={!canImport}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500
                disabled:bg-white/[0.05] disabled:text-slate-600 disabled:cursor-not-allowed
                text-white font-semibold py-3.5 rounded-xl transition-all text-sm
                shadow-lg hover:shadow-emerald-500/25 active:scale-[0.99]"
            >
              {running ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Importing…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {canImport ? `Start Import — ${rows?.length ?? 0} rows` : 'Upload a valid Excel file to continue'}
                </>
              )}
            </button>
          )}

          {/* Import again button */}
          {result && (
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.12] text-slate-300 font-semibold py-3 rounded-xl transition-all text-sm"
            >
              Upload another file
            </button>
          )}
        </div>
      </GlassCard>

      {/* How it works */}
      <GlassCard>
        <div className="p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">How the import works</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'New row',        desc: 'Brand / model / variant / plan not seen before → inserted automatically', color: 'text-emerald-400' },
              { label: 'Changed price',  desc: 'Same Plan_Code + age range, different Price_INR → price updated in DB',   color: 'text-blue-400'    },
              { label: 'Unchanged row',  desc: 'Everything matches what is already in DB → skipped (no DB write)',        color: 'text-slate-400'   },
            ].map(({ label, desc, color }) => (
              <div key={label} className="bg-white/[0.04] rounded-xl p-3.5 space-y-1">
                <p className={`text-xs font-bold ${color}`}>{label}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

    </div>
  )
}
