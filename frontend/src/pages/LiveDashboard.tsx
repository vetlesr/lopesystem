/**
 * LiveDashboard – Side 1 av 3 under et aktivt løp
 *
 * Viser:
 * - Nedtelling til neste runde
 * - Hvem som er i mål (active_resting) vs. fortsatt ute (active_running)
 * - Hvem som er ute av løpet (RTC, DNC, osv.)
 * - Rask registrering av runder (tap-to-record)
 * - Navigasjon til de andre sidene
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, startRace, nextLoop, finishRace,
  registerSplit, updateParticipant, addParticipant, removeParticipant,
  csvPreview, csvImport, exportCsv,
  fullName, toUtcIso, formatDuration
} from '../api'
import type { Race, Participant, RunnerStatus } from '../api'

// ─── Konstanter ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃 Ute på løypa',
  active_resting: '✅ I mål',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰ OVER',
  dns: '– DNS',
  dsq: '🚫 DSQ',
  winner: '🏆 VINNER',
}

const STATUS_COLOR: Record<RunnerStatus, string> = {
  active_running: 'text-emerald-400',
  active_resting: 'text-blue-400',
  rtc: 'text-orange-400',
  dnc: 'text-red-400',
  over: 'text-yellow-400',
  dns: 'text-slate-500',
  dsq: 'text-red-600',
  winner: 'text-yellow-300',
}

const ACTIVE: RunnerStatus[] = ['active_running', 'active_resting']
const DONE: RunnerStatus[] = ['rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']
const ALL_STATUSES: RunnerStatus[] = ['active_running', 'active_resting', 'rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────

function fmtCd(secs: number) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function fmtTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function useCountdown(race: Race | null) {
  const [remaining, setRemaining] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!race?.is_active || !race.loop_start_utc) return
    const tick = () => {
      const start = new Date(race.loop_start_utc! + 'Z').getTime()
      const elapsedMs = Date.now() - start
      const totalMs = race.loop_duration_minutes * 60 * 1000
      setElapsed(Math.floor(elapsedMs / 1000))
      setRemaining(Math.max(0, Math.floor((totalMs - elapsedMs) / 1000)))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [race?.loop_start_utc, race?.loop_duration_minutes, race?.is_active])
  return { remaining, elapsed }
}

// ─── Status-modal ─────────────────────────────────────────────────────────────

function QuickStatusModal({ race, participant, onClose, onRefresh }: {
  race: Race; participant: Participant; onClose: () => void; onRefresh: () => void
}) {
  const [status, setStatus] = useState<RunnerStatus>(participant.status)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    setBusy(true)
    try { await updateParticipant(race.id, participant.id, { status }); onRefresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-xs border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold">{fullName(participant)}</h3>
            <p className="text-slate-500 text-xs">#{participant.bib_number} · {participant.loops_completed} runder</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 text-xl">×</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {ALL_STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`py-2 px-3 rounded-xl text-sm font-medium border transition-colors text-left ${
                status === s ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
              }`}>
              {STATUS_LABEL[s].split(' ').slice(1).join(' ')}
              {status === s && <span className="float-right text-xs">✓</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold text-sm">
            {busy ? 'Lagrer...' : 'Lagre'}
          </button>
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl text-sm">Avbryt</button>
        </div>
      </div>
    </div>
  )
}

// ─── Legg til deltaker-modal ──────────────────────────────────────────────────

function AddParticipantModal({ race, onClose, onRefresh }: {
  race: Race; onClose: () => void; onRefresh: () => void
}) {
  const [form, setForm] = useState({ first_name: '', last_name: '', bib_number: '', gender: '', age: '', chip_id_1: '', chip_id_2: '' })
  const [busy, setBusy] = useState(false)
  const [csvMode, setCsvMode] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [csvMap, setCsvMap] = useState({ bib_col: 'Bib', first_name_col: 'FirstName', last_name_col: 'LastName', gender_col: '', age_col: '', chip_id_1_col: '' })
  const [csvResult, setCsvResult] = useState<{ added: number; skipped: number } | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await addParticipant(race.id, {
        first_name: form.first_name, last_name: form.last_name || undefined,
        bib_number: parseInt(form.bib_number), gender: form.gender || undefined,
        age: form.age ? parseInt(form.age) : undefined,
        chip_id_1: form.chip_id_1 || undefined, chip_id_2: form.chip_id_2 || undefined
      })
      onRefresh()
      setForm({ first_name: '', last_name: '', bib_number: '', gender: '', age: '', chip_id_1: '', chip_id_2: '' })
    } finally { setBusy(false) }
  }

  const handleCsvFile = async (file: File) => {
    setCsvFile(file)
    const r = await csvPreview(race.id, file)
    setCsvHeaders(r.headers); setCsvRows(r.preview)
    const h = r.headers
    setCsvMap({ bib_col: h.find(x => /bib/i.test(x)) || h[0] || '', first_name_col: h.find(x => /first|fornavn/i.test(x)) || h[1] || '', last_name_col: h.find(x => /last|etternavn/i.test(x)) || h[2] || '', gender_col: h.find(x => /gender|kjønn/i.test(x)) || '', age_col: h.find(x => /age|alder/i.test(x)) || '', chip_id_1_col: h.find(x => /chip|epc|tag/i.test(x)) || '' })
  }

  const handleImport = async () => {
    if (!csvFile) return; setBusy(true)
    try { const r = await csvImport(race.id, csvFile, csvMap); setCsvResult(r); onRefresh() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-lg border border-slate-600 shadow-2xl my-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Legg til deltakere</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700">×</button>
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setCsvMode(false)} className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${!csvMode ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Manuelt</button>
          <button onClick={() => setCsvMode(true)} className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${csvMode ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>CSV-import</button>
        </div>
        {!csvMode ? (
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[['Fornavn *', 'first_name', true], ['Etternavn', 'last_name', false], ['Startnummer *', 'bib_number', true], ['Chip ID 1', 'chip_id_1', false], ['Chip ID 2 (backup)', 'chip_id_2', false]].map(([label, key, req]) => (
                <div key={key as string} className={key === 'chip_id_2' ? 'col-span-2' : ''}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <input required={req as boolean} value={(form as Record<string, string>)[key as string]}
                    onChange={e => setForm({ ...form, [key as string]: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Kjønn</label>
                <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">–</option><option value="M">Mann</option><option value="F">Kvinne</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Alder</label>
                <input type="number" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold">{busy ? 'Legger til...' : '+ Legg til deltaker'}</button>
          </form>
        ) : csvResult ? (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-white font-semibold">{csvResult.added} deltakere importert</p>
            {csvResult.skipped > 0 && <p className="text-slate-400 text-sm">{csvResult.skipped} hoppet over</p>}
            <button onClick={onClose} className="mt-4 bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-xl">Lukk</button>
          </div>
        ) : !csvFile ? (
          <label className="block w-full border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-slate-500 transition-colors">
            <p className="text-slate-400">📂 Klikk for å velge CSV-fil</p>
            <input type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleCsvFile(e.target.files[0])} />
          </label>
        ) : (
          <div className="space-y-3">
            <p className="text-emerald-400 text-sm">✓ {csvFile.name}</p>
            {csvRows.length > 0 && (
              <div className="overflow-x-auto max-h-32 bg-slate-900 rounded-xl border border-slate-700">
                <table className="text-xs text-slate-300 w-full">
                  <thead><tr>{csvHeaders.map(h => <th key={h} className="text-left px-2 py-1.5 text-slate-500 border-b border-slate-700">{h}</th>)}</tr></thead>
                  <tbody>{csvRows.map((row, i) => <tr key={i} className="border-t border-slate-800">{csvHeaders.map(h => <td key={h} className="px-2 py-1">{row[h]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[['Startnr', 'bib_col'], ['Fornavn', 'first_name_col'], ['Etternavn', 'last_name_col'], ['Chip ID', 'chip_id_1_col']].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <select value={(csvMap as Record<string, string>)[key]} onChange={e => setCsvMap({ ...csvMap, [key]: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs">
                    <option value="">– Ikke bruk –</option>
                    {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={handleImport} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold">{busy ? 'Importerer...' : '⬆ Importer'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Hoveddashboard ───────────────────────────────────────────────────────────

export default function LiveDashboard() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [statusModal, setStatusModal] = useState<Participant | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)
  const { remaining, elapsed } = useCountdown(race)

  const showToast = (msg: string, type: 'ok' | 'err' | 'info' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([getRace(raceId), getParticipants(raceId)])
      setRace(r); setParticipants(ps)
    } finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  // WebSocket med auto-reconnect
  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    let cancelled = false
    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(`ws://localhost:8000/ws/races/${raceId}`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (['split_recorded', 'participant_updated', 'new_loop', 'race_started', 'mass_rtc', 'split_edited', 'split_deleted', 'race_finished'].includes(data.event)) load()
        if (data.event === 'split_recorded') showToast(`✅ ${data.participant_name} – Runde ${data.loop_number}${data.is_over_time ? ' (OVER)' : ''}`)
        if (data.event === 'potential_winner') showToast(`🏆 Potensiell vinner: ${data.participant_name}!`, 'info')
        if (data.event === 'new_loop') showToast(`🔔 Runde ${data.loop} startet${data.auto ? ' automatisk' : ''}!`, 'info')
      }
      ws.onclose = () => { if (!cancelled) setTimeout(connect, 3000) }
    }
    connect()
    return () => { cancelled = true; wsRef.current?.close() }
  }, [raceId, load])

  const handleStart = async () => {
    if (!confirm('Start løpet?')) return
    await startRace(raceId); load()
  }
  const handleNextLoop = async () => {
    if (!confirm(`Start runde ${(race?.current_loop ?? 0) + 1} manuelt nå?`)) return
    await nextLoop(raceId); load()
  }
  const handleFinish = async () => {
    if (!confirm('Avslutt løpet? Dette kan ikke angres.')) return
    await finishRace(raceId); load()
  }
  const handleFastTap = async (p: Participant) => {
    try {
      await registerSplit(raceId, p.id)
      showToast(`✅ ${fullName(p)} – Runde ${race?.current_loop}`)
      load()
    } catch (err: unknown) {
      showToast(`❌ ${(err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Feil'}`, 'err')
    }
  }
  const handleRemove = async (p: Participant) => {
    if (!confirm(`Fjern ${fullName(p)} fra løpet?`)) return
    await removeParticipant(raceId, p.id); load()
  }

  const active = participants.filter(p => ACTIVE.includes(p.status))
  const inGoal = active.filter(p => p.status === 'active_resting').sort((a, b) => {
    const aTime = a.splits.find(s => s.loop_number === race?.current_loop)?.finish_time_utc
    const bTime = b.splits.find(s => s.loop_number === race?.current_loop)?.finish_time_utc
    if (aTime && bTime) return new Date(aTime).getTime() - new Date(bTime).getTime()
    return a.bib_number - b.bib_number
  })
  const stillRunning = active.filter(p => p.status === 'active_running').sort((a, b) => b.loops_completed - a.loops_completed || a.bib_number - b.bib_number)
  const done = participants.filter(p => DONE.includes(p.status)).sort((a, b) => b.loops_completed - a.loops_completed || a.bib_number - b.bib_number)

  const cdPct = race ? Math.max(0, Math.min(100, (remaining / (race.loop_duration_minutes * 60)) * 100)) : 0
  const isUrgent = remaining < 120 && remaining > 0 && race?.is_active

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">⏱</div><p>Laster...</p></div>
    </div>
  )
  if (!race) return <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">Løp ikke funnet</div>

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium border transition-all ${
          toast.type === 'ok' ? 'bg-emerald-900 border-emerald-700 text-emerald-200' :
          toast.type === 'err' ? 'bg-red-900 border-red-700 text-red-200' :
          'bg-blue-900 border-blue-700 text-blue-200'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Navigasjonsbar */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-white text-sm transition-colors">← Hjem</Link>
            <span className="text-slate-700">|</span>
            <div>
              <h1 className="font-bold text-base leading-tight">{race.name}</h1>
              <p className="text-slate-500 text-xs">{race.location && `${race.location} · `}{race.loop_distance_km} km · {race.loop_duration_minutes} min/runde</p>
            </div>
          </div>
          {/* Side-navigasjon */}
          <nav className="flex items-center gap-1">
            <span className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium">🏃 Live</span>
            <Link to={`/race/${raceId}/edit`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">✏️ Rediger</Link>
            <Link to={`/race/${raceId}/loops`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📋 Runder</Link>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📺 TV</Link>
            <a href={exportCsv(raceId)} download className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">⬇ CSV</a>
          </nav>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">

        {/* Countdown-panel */}
        <div className={`rounded-2xl p-5 border ${isUrgent ? 'bg-red-950/40 border-red-800' : 'bg-slate-900 border-slate-800'}`}>
          <div className="flex flex-wrap items-center gap-6">

            {/* Timer */}
            <div className="flex-1 min-w-48">
              {race.is_active ? (
                <>
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Runde {race.current_loop} · Tid igjen</p>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className={`text-6xl font-mono font-black tracking-tight ${isUrgent ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                      {fmtCd(remaining)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div className={`h-3 rounded-full transition-all duration-1000 ${
                      isUrgent ? 'bg-red-500' : cdPct > 50 ? 'bg-emerald-500' : 'bg-yellow-500'
                    }`} style={{ width: `${cdPct}%` }} />
                  </div>
                  <p className="text-slate-600 text-xs mt-1">Elapsed: {formatDuration(elapsed)}</p>
                </>
              ) : race.is_finished ? (
                <div>
                  <p className="text-3xl font-bold text-slate-400">🏁 Løpet er avsluttet</p>
                  <p className="text-slate-600 text-sm mt-1">{race.current_loop - 1} runder gjennomført</p>
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-slate-400">⏳ Klar til start</p>
                  <p className="text-slate-600 text-sm mt-1">{participants.length} deltakere registrert</p>
                </div>
              )}
            </div>

            {/* Knapper */}
            <div className="flex flex-wrap gap-2">
              {!race.is_active && !race.is_finished && (
                <button onClick={handleStart} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-emerald-900/30">
                  ▶ Start løp
                </button>
              )}
              {race.is_active && (
                <>
                  <button onClick={handleNextLoop} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                    ⏭ Neste runde nå
                  </button>
                  <button onClick={handleFinish} className="bg-slate-700 hover:bg-red-900 text-white px-4 py-2.5 rounded-xl text-sm transition-colors">
                    🏁 Avslutt løp
                  </button>
                </>
              )}
              <button onClick={() => setShowAdd(true)} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl text-sm transition-colors">
                + Deltaker
              </button>
            </div>

            {/* Teller */}
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-4xl font-black text-emerald-400">{inGoal.length}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">I mål</p>
              </div>
              <div>
                <p className="text-4xl font-black text-slate-400">{stillRunning.length}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">Ute</p>
              </div>
              <div>
                <p className="text-4xl font-black text-red-500">{done.length}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">Ferdig</p>
              </div>
            </div>
          </div>
        </div>

        {/* I MÅL – fullførte runden */}
        {inGoal.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full inline-block"></span>
              I mål – Runde {race.current_loop} ({inGoal.length})
            </h2>
            <div className="space-y-1.5">
              {inGoal.map((p, idx) => {
                const thisSplit = p.splits.find(s => s.loop_number === race.current_loop)
                return (
                  <div key={p.id} className="bg-blue-950/40 border border-blue-800/40 rounded-xl p-3 flex items-center gap-3">
                    <span className="text-blue-600 text-sm w-6 text-center font-bold">{idx + 1}</span>
                    <span className="bg-slate-700 text-white text-xs font-bold px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm">{fullName(p)}</span>
                      {p.gender && <span className="text-slate-500 text-xs ml-1">({p.gender})</span>}
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-blue-300 text-sm font-mono font-semibold">
                        {thisSplit ? fmtTime(thisSplit.finish_time_utc) : '–'}
                      </p>
                      <p className="text-slate-600 text-xs">
                        {thisSplit?.loop_duration_secs ? formatDuration(thisSplit.loop_duration_secs) : ''}
                      </p>
                    </div>
                    <span className="text-blue-400 text-xs font-bold w-8 text-center">{p.loops_completed}</span>
                    <button onClick={() => setStatusModal(p)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded-lg transition-colors" title="Endre status">⚙️</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* UTE PÅ LØYPA – ikke registrert ennå */}
        {stillRunning.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block animate-pulse"></span>
              Ute på løypa ({stillRunning.length})
            </h2>
            <div className="space-y-1.5">
              {stillRunning.map((p) => (
                <div key={p.id} className="bg-slate-800/80 border border-slate-700 rounded-xl p-3 flex items-center gap-3">
                  <span className="bg-slate-700 text-white text-xs font-bold px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{fullName(p)}</span>
                    {p.gender && <span className="text-slate-500 text-xs ml-1">({p.gender})</span>}
                  </div>
                  <span className="text-slate-500 text-xs hidden sm:block">{p.loops_completed} runder</span>
                  <div className="flex gap-1.5">
                    {race.is_active && (
                      <button onClick={() => handleFastTap(p)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-xl font-bold transition-colors">
                        ✓ I mål
                      </button>
                    )}
                    <button onClick={() => setStatusModal(p)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-2 rounded-lg transition-colors" title="Endre status">⚙️</button>
                    <button onClick={() => handleRemove(p)} className="text-slate-700 hover:text-red-400 text-xs px-1.5 py-2 rounded-lg transition-colors" title="Fjern">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {active.length === 0 && !race.is_active && !race.is_finished && (
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
            <p className="text-3xl mb-3">👥</p>
            <p className="font-medium">Ingen deltakere ennå</p>
            <p className="text-sm mt-1">Legg til deltakere og start løpet</p>
          </div>
        )}

        {/* UTGÅTTE LØPERE */}
        {done.length > 0 && (
          <div>
            <button onClick={() => setShowDone(!showDone)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-300 transition-colors">
              <span>{showDone ? '▼' : '▶'}</span>
              Utgåtte løpere ({done.length})
            </button>
            {showDone && (
              <div className="space-y-1.5">
                {done.map((p) => (
                  <div key={p.id} className={`rounded-xl border p-3 flex items-center gap-3 opacity-60 ${
                    p.status === 'winner' ? 'bg-yellow-900/20 border-yellow-700/30' :
                    p.status === 'rtc' ? 'bg-orange-950/20 border-orange-900/20' :
                    'bg-slate-900 border-slate-800'
                  }`}>
                    <span className="bg-slate-800 text-slate-400 text-xs font-bold px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm text-slate-300">{fullName(p)}</span>
                    </div>
                    <span className={`text-xs font-medium ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    <span className="text-slate-500 text-sm font-bold w-8 text-center">{p.loops_completed}</span>
                    <button onClick={() => setStatusModal(p)} className="bg-slate-800 hover:bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg transition-colors">⚙️</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modaler */}
      {statusModal && <QuickStatusModal race={race} participant={statusModal} onClose={() => setStatusModal(null)} onRefresh={load} />}
      {showAdd && <AddParticipantModal race={race} onClose={() => setShowAdd(false)} onRefresh={load} />}
    </div>
  )
}
