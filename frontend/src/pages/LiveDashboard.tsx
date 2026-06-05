/**
 * LiveDashboard – Hoved-operasjonssenter under et aktivt løp
 *
 * Layout: 3-kolonne på desktop, stacked på mobil
 *   Venstre:  Countdown + løpskontroll + statistikk
 *   Midtre:   Deltakertabell (hoveddelen)
 *   Høyre:    Hendelseslogg + hurtighandlinger
 *
 * Funksjoner:
 * - Live countdown til rundeslutt med fargeskift
 * - Rask ✓-knapp for å registrere runde (ett klikk)
 * - Klikk på deltaker → inline detaljer med full rundehistorikk
 * - Statusendring direkte i tabellen
 * - Manuell runde med nøyaktig tidspunkt
 * - Rediger/slett individuelle runder
 * - Legg til deltaker underveis
 * - Masse-RTC (alle som ikke er i mål)
 * - Søk og filter
 * - Live WebSocket-oppdateringer
 * - Hendelseslogg (siste handlinger)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, startRace, nextLoop, finishRace,
  registerSplit, editSplit, deleteSplit, updateParticipant,
  addParticipant, removeParticipant, massRtc, exportCsv,
  fullName, toLocalInputValue, toUtcIso, formatDuration
} from '../api'
import type { Race, Participant, Split, RunnerStatus } from '../api'

// ─── Konstanter ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃 Ute på løypa',
  active_resting: '✅ I mål',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰ Over tid',
  dns: '– DNS',
  dsq: '🚫 DSQ',
  winner: '🏆 Vinner',
}

const STATUS_SHORT: Record<RunnerStatus, string> = {
  active_running: '🏃',
  active_resting: '✅',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰',
  dns: 'DNS',
  dsq: 'DSQ',
  winner: '🏆',
}

const STATUS_ROW_BG: Record<RunnerStatus, string> = {
  active_running: 'bg-slate-900 border-slate-800 hover:border-slate-600',
  active_resting: 'bg-emerald-950/20 border-emerald-900/30 hover:border-emerald-700/50',
  rtc: 'bg-orange-950/10 border-orange-900/20 opacity-60',
  dnc: 'bg-red-950/10 border-red-900/20 opacity-60',
  over: 'bg-yellow-950/10 border-yellow-900/20 opacity-60',
  dns: 'bg-slate-900/50 border-slate-800/50 opacity-40',
  dsq: 'bg-red-950/10 border-red-900/20 opacity-50',
  winner: 'bg-yellow-900/20 border-yellow-700/40',
}

const ALL_STATUSES: RunnerStatus[] = [
  'active_running', 'active_resting', 'rtc', 'dnc', 'over', 'dns', 'dsq', 'winner'
]

function fmtClock(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Countdown-hook ────────────────────────────────────────────────────────────

function useCountdown(race: Race | null) {
  const [remaining, setRemaining] = useState<number>(0)
  const [elapsed, setElapsed] = useState<number>(0)
  const [pct, setPct] = useState<number>(0)

  useEffect(() => {
    if (!race?.is_active || !race.loop_start_utc) { setRemaining(0); return }
    const total = race.loop_duration_minutes * 60

    const tick = () => {
      const start = new Date(race.loop_start_utc!.endsWith('Z') ? race.loop_start_utc! : race.loop_start_utc! + 'Z').getTime()
      const now = Date.now()
      const el = Math.floor((now - start) / 1000)
      const rem = Math.max(0, total - el)
      setElapsed(el)
      setRemaining(rem)
      setPct(Math.min(100, (el / total) * 100))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [race?.loop_start_utc, race?.loop_duration_minutes, race?.is_active])

  return { remaining, elapsed, pct }
}

// ─── Hendelseslogg ────────────────────────────────────────────────────────────

interface LogEntry {
  id: number
  time: string
  msg: string
  type: 'split' | 'status' | 'loop' | 'info'
}

let logIdCounter = 0
function makeLog(msg: string, type: LogEntry['type']): LogEntry {
  return { id: ++logIdCounter, time: new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), msg, type }
}

// ─── Inline deltakerpanel ─────────────────────────────────────────────────────

function ParticipantPanel({ race, p, onClose, onRefresh, onLog }: {
  race: Race
  p: Participant
  onClose: () => void
  onRefresh: () => void
  onLog: (entry: LogEntry) => void
}) {
  const [tab, setTab] = useState<'splits' | 'status' | 'info'>('splits')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [showAddSplit, setShowAddSplit] = useState(false)
  const [addSplitTime, setAddSplitTime] = useState('')
  const [selStatus, setSelStatus] = useState<RunnerStatus>(p.status)
  const [loopsOvr, setLoopsOvr] = useState(p.loops_completed)
  const [infoEdit, setInfoEdit] = useState(false)
  const [infoForm, setInfoForm] = useState({
    first_name: p.first_name, last_name: p.last_name || '',
    bib_number: p.bib_number.toString(), gender: p.gender || '',
    age: p.age?.toString() || '', chip_id_1: p.chip_id_1 || '', chip_id_2: p.chip_id_2 || '',
  })
  const [busy, setBusy] = useState(false)

  const splits = [...p.splits].sort((a, b) => a.loop_number - b.loop_number)
  const validDurs = splits.filter(s => s.loop_duration_secs && !s.is_over_time).map(s => s.loop_duration_secs!)
  const best = validDurs.length ? Math.min(...validDurs) : null
  const worst = validDurs.length ? Math.max(...validDurs) : null
  const avg = validDurs.length ? validDurs.reduce((a, b) => a + b, 0) / validDurs.length : null

  const do_ = async (fn: () => Promise<void>, msg: string, logMsg: string, logType: LogEntry['type']) => {
    setBusy(true)
    try { await fn(); onLog(makeLog(logMsg, logType)); onRefresh() }
    finally { setBusy(false) }
  }

  return (
    <div className="bg-slate-950 border border-slate-700 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          <span className="bg-slate-700 text-white text-xs font-black px-2 py-1 rounded-lg">#{p.bib_number}</span>
          <div>
            <p className="font-bold text-sm">{fullName(p)}</p>
            <p className="text-slate-500 text-xs">{p.gender || ''}{p.age ? ` · ${p.age} år` : ''} · {p.total_km.toFixed(1)} km</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors">✕</button>
      </div>

      {/* Statistikk */}
      <div className="grid grid-cols-4 gap-0 border-b border-slate-800">
        {[
          [p.loops_completed.toString(), 'Runder', 'text-white'],
          [best ? formatDuration(best) : '–', 'Beste', 'text-emerald-400'],
          [avg ? formatDuration(avg) : '–', 'Snitt', 'text-blue-400'],
          [worst ? formatDuration(worst) : '–', 'Tregeste', 'text-red-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="text-center py-2.5 border-r border-slate-800 last:border-0">
            <p className={`font-black text-base font-mono ${color}`}>{val}</p>
            <p className="text-slate-600 text-xs">{label}</p>
          </div>
        ))}
      </div>

      {/* Faner */}
      <div className="flex border-b border-slate-800">
        {(['splits', 'status', 'info'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${tab === t ? 'text-white border-b-2 border-blue-500 bg-slate-900/50' : 'text-slate-600 hover:text-slate-400'}`}>
            {t === 'splits' ? `📊 Runder (${splits.length})` : t === 'status' ? '⚙️ Status' : '👤 Info'}
          </button>
        ))}
      </div>

      {/* Tab: Runder */}
      {tab === 'splits' && (
        <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
          {splits.length === 0 ? (
            <p className="text-center text-slate-600 text-sm py-4">Ingen runder registrert</p>
          ) : splits.map((s, idx) => {
            const cumSecs = splits.slice(0, idx + 1).reduce((a, x) => a + (x.loop_duration_secs || 0), 0)
            const isBest = best !== null && s.loop_duration_secs === best && !s.is_over_time
            const isWorst = worst !== null && s.loop_duration_secs === worst && !s.is_over_time && validDurs.length > 1
            const isEditing = editingId === s.id
            return (
              <div key={s.id} className={`rounded-xl border p-2.5 ${isBest ? 'bg-emerald-950/30 border-emerald-900/30' : isWorst ? 'bg-red-950/20 border-red-900/20' : s.is_over_time ? 'bg-yellow-950/10 border-yellow-900/20' : 'bg-slate-900 border-slate-800'}`}>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs w-6">R{s.loop_number}</span>
                    <input type="datetime-local" step="1" value={editVal} onChange={e => setEditVal(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500" />
                    <button onClick={() => do_(() => editSplit(race.id, p.id, s.id, toUtcIso(editVal)), '', `✏️ R${s.loop_number} for #${p.bib_number} oppdatert`, 'split')} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-lg text-xs">✓</button>
                    <button onClick={() => setEditingId(null)} className="bg-slate-700 text-white px-2 py-1 rounded-lg text-xs">✕</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-6 font-bold">R{s.loop_number}</span>
                    <span className="font-mono text-white w-20">{fmtClock(s.finish_time_utc)}</span>
                    <span className={`font-mono font-bold w-16 ${isBest ? 'text-emerald-400' : isWorst ? 'text-red-400' : s.is_over_time ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {s.loop_duration_secs ? formatDuration(s.loop_duration_secs) : '–'}
                      {isBest && ' ↑'}{isWorst && ' ↓'}
                    </span>
                    <span className="text-slate-600 w-16 font-mono">{formatDuration(cumSecs)}</span>
                    <span className={`text-xs px-1 rounded ${s.recorded_by === 'rfid' ? 'text-purple-400' : 'text-slate-600'}`}>{s.recorded_by === 'rfid' ? '📡' : '✋'}</span>
                    <div className="flex gap-1 ml-auto">
                      <button onClick={() => { setEditingId(s.id); setEditVal(toLocalInputValue(s.finish_time_utc)) }} className="text-slate-600 hover:text-blue-400 transition-colors px-1">✏️</button>
                      <button onClick={() => do_(() => deleteSplit(race.id, p.id, s.id).then(() => {}), '', `🗑️ R${s.loop_number} for #${p.bib_number} slettet`, 'split')} className="text-slate-600 hover:text-red-400 transition-colors px-1">🗑️</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {showAddSplit ? (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 space-y-2">
              <p className="text-xs text-slate-400 font-semibold">Legg til runde manuelt</p>
              <input type="datetime-local" step="1" value={addSplitTime} onChange={e => setAddSplitTime(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500" />
              <div className="flex gap-2">
                <button onClick={() => do_(
                  () => registerSplit(race.id, p.id, addSplitTime ? toUtcIso(addSplitTime) : undefined).then(() => {}),
                  '', `➕ Runde lagt til for #${p.bib_number}`, 'split'
                )} disabled={busy} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg text-xs font-semibold">
                  {busy ? '...' : '+ Legg til'}
                </button>
                <button onClick={() => { setShowAddSplit(false); setAddSplitTime('') }} className="flex-1 bg-slate-700 text-white py-1.5 rounded-lg text-xs">Avbryt</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddSplit(true)} className="w-full bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 text-slate-500 hover:text-white py-2 rounded-xl text-xs transition-colors">
              + Legg til runde manuelt
            </button>
          )}
        </div>
      )}

      {/* Tab: Status */}
      {tab === 'status' && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_STATUSES.map(s => (
              <button key={s} onClick={() => setSelStatus(s)}
                className={`py-2 px-2 rounded-xl text-xs font-medium border text-left transition-colors ${selStatus === s ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'}`}>
                {STATUS_LABEL[s]} {selStatus === s && '✓'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 bg-slate-900 rounded-xl p-2.5 border border-slate-800">
            <span className="text-slate-500 text-xs">Runder:</span>
            <button onClick={() => setLoopsOvr(Math.max(0, loopsOvr - 1))} className="w-7 h-7 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-bold flex items-center justify-center">−</button>
            <span className="text-white font-black text-lg w-8 text-center">{loopsOvr}</span>
            <button onClick={() => setLoopsOvr(loopsOvr + 1)} className="w-7 h-7 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-bold flex items-center justify-center">+</button>
          </div>
          <button onClick={() => do_(
            () => updateParticipant(race.id, p.id, { status: selStatus, loops_completed: loopsOvr }).then(() => {}),
            '', `⚙️ #${p.bib_number} → ${STATUS_LABEL[selStatus]}`, 'status'
          )} disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
            {busy ? 'Lagrer...' : '✓ Lagre status'}
          </button>
        </div>
      )}

      {/* Tab: Info */}
      {tab === 'info' && (
        <div className="p-3">
          {infoEdit ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {[['Fornavn', 'first_name'], ['Etternavn', 'last_name'], ['Startnr', 'bib_number'], ['Chip 1', 'chip_id_1'], ['Chip 2', 'chip_id_2']].map(([lbl, key]) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500 mb-0.5">{lbl}</label>
                    <input value={(infoForm as Record<string, string>)[key]} onChange={e => setInfoForm({ ...infoForm, [key]: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-slate-500 mb-0.5">Kjønn</label>
                  <select value={infoForm.gender} onChange={e => setInfoForm({ ...infoForm, gender: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500">
                    <option value="">–</option><option value="M">Mann</option><option value="F">Kvinne</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => do_(
                  () => updateParticipant(race.id, p.id, {
                    first_name: infoForm.first_name, last_name: infoForm.last_name || undefined,
                    bib_number: parseInt(infoForm.bib_number), gender: infoForm.gender || undefined,
                    age: infoForm.age ? parseInt(infoForm.age) : undefined,
                    chip_id_1: infoForm.chip_id_1 || undefined, chip_id_2: infoForm.chip_id_2 || undefined,
                  }).then(() => { setInfoEdit(false) }),
                  '', `✏️ Info for #${p.bib_number} oppdatert`, 'info'
                )} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-xs font-semibold">
                  {busy ? '...' : '✓ Lagre'}
                </button>
                <button onClick={() => setInfoEdit(false)} className="flex-1 bg-slate-700 text-white py-2 rounded-xl text-xs">Avbryt</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {[['Chip ID 1', p.chip_id_1 || '–'], ['Chip ID 2', p.chip_id_2 || '–'], ['Kjønn', p.gender || '–'], ['Alder', p.age ? `${p.age} år` : '–']].map(([lbl, val]) => (
                <div key={lbl} className="flex justify-between py-1.5 border-b border-slate-800 text-xs">
                  <span className="text-slate-500">{lbl}</span>
                  <span className="text-white font-mono">{val}</span>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setInfoEdit(true)} className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-2 rounded-xl text-xs transition-colors">✏️ Rediger</button>
                <button onClick={() => do_(
                  () => removeParticipant(race.id, p.id).then(() => { onClose() }),
                  '', `🗑️ #${p.bib_number} fjernet`, 'info'
                )} className="bg-red-950/30 hover:bg-red-900/40 border border-red-900/30 text-red-400 py-2 px-3 rounded-xl text-xs transition-colors">🗑️</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Legg til deltaker modal ──────────────────────────────────────────────────

function AddModal({ race, onClose, onRefresh, onLog }: {
  race: Race, onClose: () => void, onRefresh: () => void, onLog: (e: LogEntry) => void
}) {
  const [form, setForm] = useState({ first_name: '', last_name: '', bib_number: '', chip_id_1: '', chip_id_2: '', gender: '', age: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await addParticipant(race.id, {
        first_name: form.first_name, last_name: form.last_name || undefined,
        bib_number: parseInt(form.bib_number), chip_id_1: form.chip_id_1 || undefined,
        chip_id_2: form.chip_id_2 || undefined, gender: form.gender || undefined,
        age: form.age ? parseInt(form.age) : undefined,
      })
      onLog(makeLog(`➕ ${form.first_name} #${form.bib_number} lagt til`, 'info'))
      onRefresh(); onClose()
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Feil ved lagring')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="font-bold text-base">Ny deltaker</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-800 transition-colors">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {err && <p className="bg-red-950/30 border border-red-900/30 text-red-400 text-xs px-3 py-2 rounded-xl">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            {[['Fornavn *', 'first_name', true], ['Etternavn', 'last_name', false], ['Startnummer *', 'bib_number', true], ['Chip ID 1', 'chip_id_1', false], ['Chip ID 2', 'chip_id_2', false]].map(([lbl, key, req]) => (
              <div key={key as string} className={key === 'chip_id_2' ? 'col-span-2' : ''}>
                <label className="block text-xs text-slate-500 mb-1">{lbl}</label>
                <input required={req as boolean} value={(form as Record<string, string>)[key as string]}
                  onChange={e => setForm({ ...form, [key as string]: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            <div>
              <label className="block text-xs text-slate-500 mb-1">Kjønn</label>
              <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">–</option><option value="M">Mann</option><option value="F">Kvinne</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Alder</label>
              <input type="number" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm transition-colors">
              {busy ? 'Legger til...' : '+ Legg til'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-sm transition-colors">Avbryt</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Masse-RTC modal ──────────────────────────────────────────────────────────

function MassRtcModal({ race, participants, onClose, onRefresh, onLog }: {
  race: Race, participants: Participant[], onClose: () => void, onRefresh: () => void, onLog: (e: LogEntry) => void
}) {
  const stillOut = participants.filter(p => p.status === 'active_running')
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await massRtc(race.id, stillOut.map(p => p.bib_number))
      onLog(makeLog(`🛑 Masse-RTC: ${stillOut.length} løpere satt til RTC`, 'status'))
      onRefresh(); onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="p-5 text-center">
          <p className="text-3xl mb-3">🛑</p>
          <h3 className="font-bold text-base mb-2">Masse-RTC</h3>
          <p className="text-slate-400 text-sm mb-4">
            Sett alle <strong className="text-white">{stillOut.length} løpere</strong> som fortsatt er ute på løypa til RTC?
          </p>
          {stillOut.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-3 mb-4 text-left max-h-32 overflow-y-auto">
              {stillOut.map(p => (
                <p key={p.id} className="text-slate-400 text-xs">#{p.bib_number} {fullName(p)}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleConfirm} disabled={busy || stillOut.length === 0}
              className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm transition-colors">
              {busy ? 'Setter...' : `Sett ${stillOut.length} til RTC`}
            </button>
            <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-sm transition-colors">Avbryt</button>
          </div>
        </div>
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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showMassRtc, setShowMassRtc] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const addLog = useCallback((entry: LogEntry) => {
    setLog(prev => [entry, ...prev].slice(0, 50))
  }, [])

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([
        getRace(raceId),
        getParticipants(raceId)
      ])
      setRace(r); setParticipants(ps)
    } finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  // WebSocket
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.hostname}:8000/ws/race/${raceId}`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.event === 'loop_started') {
          addLog(makeLog(`🔔 Runde ${data.loop_number} startet!`, 'loop'))
        } else if (data.event === 'split_registered') {
          addLog(makeLog(`📡 RFID: Chip registrert`, 'split'))
        }
        load()
      } catch {}
    }
    return () => ws.close()
  }, [raceId, load, addLog])

  const { remaining, pct } = useCountdown(race)

  const doAction = async (key: string, fn: () => Promise<unknown>, logMsg: string, logType: LogEntry['type']) => {
    setBusyAction(key)
    try { await fn(); addLog(makeLog(logMsg, logType)); await load() }
    finally { setBusyAction(null) }
  }

  const handleFastTap = async (p: Participant) => {
    await doAction(`split-${p.id}`,
      () => registerSplit(raceId, p.id),
      `✅ #${p.bib_number} ${p.first_name} – Runde ${p.loops_completed + 1}`,
      'split'
    )
  }

  // Kategoriser deltakere
  const active = participants.filter(p => ['active_running', 'active_resting'].includes(p.status))
  const inGoal = participants.filter(p => p.status === 'active_resting')
  const stillRunning = participants.filter(p => p.status === 'active_running')
  const done = participants.filter(p => !['active_running', 'active_resting'].includes(p.status))

  // Søk
  const searchFilter = (p: Participant) => {
    if (!search) return true
    const q = search.toLowerCase()
    return fullName(p).toLowerCase().includes(q) || p.bib_number.toString().includes(q)
  }

  const selectedParticipant = participants.find(p => p.id === selectedId) || null

  // Countdown-farge
  const countdownColor = remaining > 600 ? 'text-emerald-400' : remaining > 120 ? 'text-yellow-400' : 'text-red-400'
  const progressColor = pct < 70 ? 'bg-emerald-500' : pct < 90 ? 'bg-yellow-500' : 'bg-red-500'

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center"><div className="text-5xl mb-3 animate-pulse">⏱</div><p>Laster...</p></div>
    </div>
  )
  if (!race) return <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">Løp ikke funnet</div>

  const fmtRemaining = () => {
    const h = Math.floor(remaining / 3600)
    const m = Math.floor((remaining % 3600) / 60)
    const s = remaining % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="text-slate-500 hover:text-white text-sm transition-colors shrink-0">← Hjem</Link>
            <div className="min-w-0">
              <h1 className="font-black text-base truncate">{race.name}</h1>
              <p className="text-slate-500 text-xs">{race.location || ''} · {race.loop_distance_km} km/runde</p>
            </div>
          </div>

          {/* Countdown */}
          {race.is_active && (
            <div className="text-center shrink-0">
              <p className={`font-black text-2xl font-mono leading-none ${countdownColor}`}>{fmtRemaining()}</p>
              <p className="text-slate-600 text-xs">Runde {race.current_loop}</p>
            </div>
          )}

          {/* Nav */}
          <nav className="flex items-center gap-1 shrink-0">
            <span className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium">🏃 Live</span>
            <Link to={`/race/${raceId}/edit`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">✏️ Rediger</Link>
            <Link to={`/race/${raceId}/loops`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📋 Runder</Link>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📺 TV</Link>
          </nav>
        </div>

        {/* Progress bar */}
        {race.is_active && (
          <div className="h-1 bg-slate-800">
            <div className={`h-full transition-all duration-1000 ${progressColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {/* ── Hoveddel ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex gap-0 overflow-hidden">

        {/* ── Venstre panel: Kontroll ──────────────────────────────────────── */}
        <div className="w-56 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto hidden lg:flex">

          {/* Løpskontroll */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <p className="text-xs text-slate-600 uppercase tracking-wider">Løpskontroll</p>

            {!race.is_active && !race.is_finished && (
              <button onClick={() => doAction('start', () => startRace(raceId), '🚀 Løpet startet!', 'loop')}
                disabled={busyAction === 'start'}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm transition-colors">
                {busyAction === 'start' ? '...' : '🚀 Start løp'}
              </button>
            )}

            {race.is_active && (
              <>
                <button onClick={() => doAction('next', () => nextLoop(raceId), `🔔 Runde ${race.current_loop + 1} startet manuelt`, 'loop')}
                  disabled={busyAction === 'next'}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm transition-colors">
                  {busyAction === 'next' ? '...' : `▶ Neste runde`}
                </button>
                <button onClick={() => setShowMassRtc(true)}
                  className="w-full bg-orange-600/20 hover:bg-orange-600/30 border border-orange-700/30 text-orange-300 py-2 rounded-xl text-xs font-medium transition-colors">
                  🛑 Masse-RTC ({stillRunning.length})
                </button>
                <button onClick={() => { if (confirm('Avslutt løpet?')) doAction('finish', () => finishRace(raceId), '🏁 Løpet avsluttet', 'loop') }}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 py-2 rounded-xl text-xs transition-colors">
                  🏁 Avslutt løp
                </button>
              </>
            )}

            {race.is_finished && (
              <div className="bg-slate-800 rounded-xl p-3 text-center">
                <p className="text-slate-400 text-sm font-semibold">🏁 Løpet er avsluttet</p>
              </div>
            )}
          </div>

          {/* Statistikk */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <p className="text-xs text-slate-600 uppercase tracking-wider">Statistikk</p>
            {[
              ['Runde', race.current_loop.toString(), 'text-white'],
              ['Aktive', active.length.toString(), 'text-emerald-400'],
              ['I mål', inGoal.length.toString(), 'text-blue-400'],
              ['Ute på løypa', stillRunning.length.toString(), 'text-yellow-400'],
              ['Utgått', done.length.toString(), 'text-slate-500'],
              ['Totalt', participants.length.toString(), 'text-slate-400'],
            ].map(([lbl, val, color]) => (
              <div key={lbl} className="flex justify-between items-center">
                <span className="text-slate-600 text-xs">{lbl}</span>
                <span className={`font-black text-sm ${color}`}>{val}</span>
              </div>
            ))}
          </div>

          {/* Handlinger */}
          <div className="p-3 space-y-1.5">
            <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Handlinger</p>
            <button onClick={() => setShowAdd(true)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-2 rounded-xl text-xs transition-colors">
              + Legg til deltaker
            </button>
            <a href={exportCsv(raceId)} download className="block w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-2 rounded-xl text-xs text-center transition-colors">
              ⬇ Eksporter CSV
            </a>
          </div>

          {/* Hendelseslogg */}
          <div className="flex-1 p-3 overflow-y-auto">
            <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Hendelseslogg</p>
            {log.length === 0 ? (
              <p className="text-slate-700 text-xs">Ingen hendelser ennå</p>
            ) : log.map(entry => (
              <div key={entry.id} className={`mb-1.5 text-xs rounded-lg px-2 py-1.5 ${
                entry.type === 'split' ? 'bg-emerald-950/30 text-emerald-300' :
                entry.type === 'loop' ? 'bg-blue-950/30 text-blue-300' :
                entry.type === 'status' ? 'bg-orange-950/20 text-orange-300' :
                'bg-slate-800 text-slate-400'
              }`}>
                <span className="text-slate-600 mr-1">{entry.time}</span>{entry.msg}
              </div>
            ))}
          </div>
        </div>

        {/* ── Midtre panel: Deltakertabell ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Søk + filter */}
          <div className="bg-slate-900/80 border-b border-slate-800 px-4 py-2.5 flex items-center gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Søk navn eller startnr..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-600" />
            <button onClick={() => setShowAdd(true)} className="lg:hidden bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors">+ Deltaker</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

            {/* ── I MÅL ─────────────────────────────────────────────────── */}
            {inGoal.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">I mål ({inGoal.length})</h2>
                  <div className="flex-1 h-px bg-emerald-900/30"></div>
                </div>
                <div className="space-y-1">
                  {inGoal.filter(searchFilter).map((p, idx) => {
                    const thisSplit = p.splits.find(s => s.loop_number === race.current_loop)
                    const isSelected = selectedId === p.id
                    return (
                      <div key={p.id}>
                        <div
                          onClick={() => setSelectedId(isSelected ? null : p.id)}
                          className={`rounded-xl border p-3 cursor-pointer transition-all ${isSelected ? 'border-emerald-600/60 bg-emerald-950/20' : STATUS_ROW_BG[p.status]}`}>
                          <div className="flex items-center gap-3">
                            {/* Rang */}
                            <span className="text-emerald-500 font-black text-sm w-6 text-center">{idx + 1}</span>
                            {/* Bib */}
                            <span className="bg-slate-700 text-white text-xs font-black px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                            {/* Navn */}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{fullName(p)}</p>
                              {thisSplit && (
                                <p className="text-emerald-400 text-xs font-mono">
                                  {fmtClock(thisSplit.finish_time_utc)}
                                  {thisSplit.loop_duration_secs && ` · ${formatDuration(thisSplit.loop_duration_secs)}`}
                                </p>
                              )}
                            </div>
                            {/* Runder */}
                            <div className="text-right">
                              <p className="text-white font-black text-base">{p.loops_completed}</p>
                              <p className="text-slate-600 text-xs">runder</p>
                            </div>
                            {/* Knapper */}
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                onClick={e => { e.stopPropagation(); handleFastTap(p) }}
                                disabled={busyAction === `split-${p.id}`}
                                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-xl font-bold transition-colors">
                                {busyAction === `split-${p.id}` ? '...' : '✓'}
                              </button>
                            </div>
                          </div>
                        </div>
                        {isSelected && selectedParticipant && (
                          <div className="mt-1 ml-3">
                            <ParticipantPanel race={race} p={selectedParticipant} onClose={() => setSelectedId(null)} onRefresh={load} onLog={addLog} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ── UTE PÅ LØYPA ──────────────────────────────────────────── */}
            {stillRunning.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <h2 className="text-xs font-bold text-yellow-400 uppercase tracking-wider">Ute på løypa ({stillRunning.length})</h2>
                  <div className="flex-1 h-px bg-yellow-900/20"></div>
                </div>
                <div className="space-y-1">
                  {stillRunning.filter(searchFilter).map(p => {
                    const isSelected = selectedId === p.id
                    const lastSplit = p.splits.length > 0 ? [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0] : null
                    return (
                      <div key={p.id}>
                        <div
                          onClick={() => setSelectedId(isSelected ? null : p.id)}
                          className={`rounded-xl border p-3 cursor-pointer transition-all ${isSelected ? 'border-blue-600/60 bg-blue-950/10' : STATUS_ROW_BG[p.status]}`}>
                          <div className="flex items-center gap-3">
                            <span className="bg-slate-700 text-white text-xs font-black px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{fullName(p)}</p>
                              {lastSplit ? (
                                <p className="text-slate-500 text-xs">Sist: R{lastSplit.loop_number} · {fmtClock(lastSplit.finish_time_utc)}</p>
                              ) : <p className="text-slate-600 text-xs">Ingen runder ennå</p>}
                            </div>
                            <div className="text-right">
                              <p className="text-white font-black text-base">{p.loops_completed}</p>
                              <p className="text-slate-600 text-xs">runder</p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                onClick={e => { e.stopPropagation(); handleFastTap(p) }}
                                disabled={busyAction === `split-${p.id}`}
                                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-xl font-bold transition-colors">
                                {busyAction === `split-${p.id}` ? '...' : '✓ I mål'}
                              </button>
                            </div>
                          </div>
                        </div>
                        {isSelected && selectedParticipant && (
                          <div className="mt-1 ml-3">
                            <ParticipantPanel race={race} p={selectedParticipant} onClose={() => setSelectedId(null)} onRefresh={load} onLog={addLog} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ── UTGÅTTE ───────────────────────────────────────────────── */}
            {done.length > 0 && (
              <section>
                <button onClick={() => setShowDone(!showDone)}
                  className="flex items-center gap-2 mb-2 w-full text-left hover:text-slate-300 transition-colors">
                  <span className="text-slate-600 text-xs">{showDone ? '▼' : '▶'}</span>
                  <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Utgåtte ({done.length})</h2>
                  <div className="flex-1 h-px bg-slate-800"></div>
                </button>
                {showDone && (
                  <div className="space-y-1">
                    {done.filter(searchFilter).map(p => {
                      const isSelected = selectedId === p.id
                      return (
                        <div key={p.id}>
                          <div
                            onClick={() => setSelectedId(isSelected ? null : p.id)}
                            className={`rounded-xl border p-3 cursor-pointer transition-all ${isSelected ? 'border-slate-600 bg-slate-800' : STATUS_ROW_BG[p.status]}`}>
                            <div className="flex items-center gap-3">
                              <span className="bg-slate-800 text-slate-500 text-xs font-black px-2 py-1 rounded-lg w-10 text-center">#{p.bib_number}</span>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm text-slate-400 truncate">{fullName(p)}</p>
                              </div>
                              <span className="text-xs text-slate-500">{STATUS_SHORT[p.status]}</span>
                              <span className="text-slate-500 font-bold text-sm">{p.loops_completed}</span>
                            </div>
                          </div>
                          {isSelected && selectedParticipant && (
                            <div className="mt-1 ml-3">
                              <ParticipantPanel race={race} p={selectedParticipant} onClose={() => setSelectedId(null)} onRefresh={load} onLog={addLog} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Tom tilstand */}
            {active.length === 0 && done.length === 0 && (
              <div className="text-center py-20 text-slate-600">
                <p className="text-5xl mb-4">👥</p>
                <p className="font-semibold text-base">Ingen deltakere ennå</p>
                <p className="text-sm mt-1">Legg til deltakere og start løpet</p>
                <button onClick={() => setShowAdd(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                  + Legg til deltaker
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Høyre panel: Mobil-logg (skjult på desktop, vises i venstre) ── */}
        {/* På mobil vises kontroll og logg i en collapsible drawer – utelatt for nå */}
      </div>

      {/* Modaler */}
      {showAdd && <AddModal race={race} onClose={() => setShowAdd(false)} onRefresh={load} onLog={addLog} />}
      {showMassRtc && <MassRtcModal race={race} participants={participants} onClose={() => setShowMassRtc(false)} onRefresh={load} onLog={addLog} />}
    </div>
  )
}
