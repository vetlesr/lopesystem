import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, startRace, nextLoop, finishRace,
  registerSplit, editSplit, deleteSplit, updateParticipant,
  addParticipant, removeParticipant, exportCsv,
  csvPreview, csvImport, fullName, toLocalInputValue, toUtcIso, formatDuration
} from '../api'
import type { Race, Participant, Split, RunnerStatus } from '../api'

// ─── Konstanter ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃 Løper',
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

const STATUS_ROW: Record<RunnerStatus, string> = {
  active_running: 'bg-slate-800/80 border-slate-700',
  active_resting: 'bg-blue-950/50 border-blue-800/50',
  rtc: 'bg-orange-950/30 border-orange-900/30',
  dnc: 'bg-red-950/30 border-red-900/30',
  over: 'bg-yellow-950/30 border-yellow-900/30',
  dns: 'bg-slate-900 border-slate-800',
  dsq: 'bg-red-950/50 border-red-900/50',
  winner: 'bg-yellow-900/30 border-yellow-700/50',
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

// ─── Rundehistorikk-ekspandert visning ────────────────────────────────────────

function LapHistoryRow({
  participant, allParticipants, race, onRefresh
}: {
  participant: Participant
  allParticipants: Participant[]
  race: Race
  onRefresh: () => void
}) {
  const [editingSplit, setEditingSplit] = useState<number | null>(null)
  const [editSplitTime, setEditSplitTime] = useState('')
  const [busy, setBusy] = useState(false)

  const sorted = [...participant.splits].sort((a, b) => a.loop_number - b.loop_number)
  const durations = sorted.filter(s => s.loop_duration_secs).map(s => s.loop_duration_secs!)
  const bestTime = durations.length ? Math.min(...durations) : null
  const worstTime = durations.length ? Math.max(...durations) : null

  const getRankForLoop = (loopNum: number, mySecs: number | null): string => {
    if (!mySecs) return '–'
    const others = allParticipants
      .map(ap => ap.splits.find(s => s.loop_number === loopNum)?.loop_duration_secs)
      .filter((s): s is number => !!s)
      .sort((a, b) => a - b)
    const rank = others.indexOf(mySecs) + 1
    return rank > 0 ? `#${rank}` : '–'
  }

  const handleEdit = async (split: Split) => {
    setBusy(true)
    try { await editSplit(race.id, participant.id, split.id, toUtcIso(editSplitTime)); setEditingSplit(null); onRefresh() }
    finally { setBusy(false) }
  }

  const handleDelete = async (split: Split) => {
    if (!confirm(`Slett runde ${split.loop_number} for ${fullName(participant)}?`)) return
    setBusy(true)
    try { await deleteSplit(race.id, participant.id, split.id); onRefresh() }
    finally { setBusy(false) }
  }

  if (sorted.length === 0) {
    return (
      <div className="px-4 py-3 text-slate-600 text-sm italic">
        Ingen runder registrert ennå
      </div>
    )
  }

  return (
    <div className="bg-slate-950/60 border-t border-slate-700/50">
      {/* Statistikk-linje */}
      {durations.length > 1 && (
        <div className="flex gap-6 px-4 py-2 border-b border-slate-800/60 text-xs">
          <span className="text-slate-500">Statistikk:</span>
          <span className="text-emerald-400">Beste: {formatDuration(bestTime!)}</span>
          <span className="text-slate-400">Snitt: {formatDuration(durations.reduce((a,b)=>a+b,0)/durations.length)}</span>
          <span className="text-red-400">Tregeste: {formatDuration(worstTime!)}</span>
        </div>
      )}

      {/* Runde-tabell */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-600 uppercase tracking-wider border-b border-slate-800">
              <th className="text-left px-4 py-2 font-semibold">Runde</th>
              <th className="text-left px-3 py-2 font-semibold">Passeringstid</th>
              <th className="text-left px-3 py-2 font-semibold">Rundetid</th>
              <th className="text-left px-3 py-2 font-semibold">Kumulativ</th>
              <th className="text-center px-3 py-2 font-semibold">Rang</th>
              <th className="text-center px-3 py-2 font-semibold">Kilde</th>
              <th className="text-right px-4 py-2 font-semibold">Handlinger</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((split, idx) => {
              const cumSecs = sorted.slice(0, idx + 1).reduce((acc, s) => acc + (s.loop_duration_secs || 0), 0)
              const rank = getRankForLoop(split.loop_number, split.loop_duration_secs)
              const isBest = split.loop_duration_secs === bestTime && durations.length > 1
              const isWorst = split.loop_duration_secs === worstTime && durations.length > 1

              return (
                <tr key={split.id} className={`border-b border-slate-800/40 ${
                  isBest ? 'bg-emerald-950/20' : isWorst ? 'bg-red-950/10' : ''
                }`}>
                  {editingSplit === split.id ? (
                    <td colSpan={7} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs w-16">Runde {split.loop_number}</span>
                        <input type="datetime-local" step="1" value={editSplitTime}
                          onChange={e => setEditSplitTime(e.target.value)}
                          className="flex-1 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-white text-xs focus:outline-none" />
                        <button onClick={() => handleEdit(split)} disabled={busy}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-semibold">Lagre</button>
                        <button onClick={() => setEditingSplit(null)}
                          className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded text-xs">Avbryt</button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-2">
                        <span className="font-bold text-white">{split.loop_number}</span>
                        {isBest && <span className="ml-1 text-emerald-400 text-xs">↑</span>}
                        {isWorst && <span className="ml-1 text-red-400 text-xs">↓</span>}
                        {split.is_over_time && <span className="ml-1 text-yellow-400 text-xs">OVER</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-200">{fmtTime(split.finish_time_utc)}</td>
                      <td className="px-3 py-2">
                        <span className={`font-mono font-semibold ${
                          isBest ? 'text-emerald-400' : isWorst ? 'text-red-400' : 'text-slate-200'
                        }`}>
                          {split.loop_duration_secs ? formatDuration(split.loop_duration_secs) : '–'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {cumSecs > 0 ? formatDuration(cumSecs) : '–'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`font-bold text-xs ${
                          rank === '#1' ? 'text-yellow-400' :
                          rank === '#2' ? 'text-slate-300' :
                          rank === '#3' ? 'text-orange-400' :
                          'text-slate-600'
                        }`}>{rank}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          split.recorded_by === 'rfid'
                            ? 'bg-blue-900/60 text-blue-300'
                            : 'bg-slate-700 text-slate-400'
                        }`}>
                          {split.recorded_by === 'rfid' ? '📡' : '✋'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setEditingSplit(split.id); setEditSplitTime(toLocalInputValue(split.finish_time_utc)) }}
                            className="text-slate-600 hover:text-blue-400 px-1.5 py-0.5 rounded hover:bg-blue-900/20 transition-colors text-xs">
                            ✏️
                          </button>
                          <button onClick={() => handleDelete(split)}
                            className="text-slate-600 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-900/20 transition-colors text-xs">
                            🗑️
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Status-modal ─────────────────────────────────────────────────────────────

function StatusModal({ race, participant, onClose, onRefresh }: {
  race: Race; participant: Participant; onClose: () => void; onRefresh: () => void
}) {
  const lastSplit = [...participant.splits].sort((a, b) => b.loop_number - a.loop_number)[0]
  const [loops, setLoops] = useState(participant.loops_completed)
  const [status, setStatus] = useState<RunnerStatus>(participant.status)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    setBusy(true)
    try { await updateParticipant(race.id, participant.id, { status, loops_completed: loops }); onRefresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-lg">{fullName(participant)}</h3>
            <p className="text-slate-400 text-xs">#{participant.bib_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700">×</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors text-left ${
                    status === s
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                  }`}>
                  {STATUS_LABEL[s]}
                  {status === s && <span className="float-right">✓</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Fullførte runder
              {lastSplit && <span className="ml-2 text-slate-500 text-xs">(siste registrert: R{lastSplit.loop_number})</span>}
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => setLoops(Math.max(0, loops - 1))} className="bg-slate-700 hover:bg-slate-600 text-white w-10 h-10 rounded-xl text-xl font-bold">−</button>
              <span className="text-3xl font-black w-16 text-center">{loops}</span>
              <button onClick={() => setLoops(loops + 1)} className="bg-slate-700 hover:bg-slate-600 text-white w-10 h-10 rounded-xl text-xl font-bold">+</button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold">
            {busy ? 'Lagrer...' : 'Lagre'}
          </button>
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl">Avbryt</button>
        </div>
      </div>
    </div>
  )
}

// ─── Manuell runde-modal ──────────────────────────────────────────────────────

function ManualSplitModal({ race, participant, onClose, onRefresh }: {
  race: Race; participant: Participant; onClose: () => void; onRefresh: () => void
}) {
  const now = new Date(), pad = (n: number) => n.toString().padStart(2, '0')
  const [time, setTime] = useState(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    setBusy(true)
    try { await registerSplit(race.id, participant.id, toUtcIso(time)); onRefresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Registrer runde – {fullName(participant)}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700">×</button>
        </div>
        <p className="text-slate-400 text-sm mb-3">Runde {race.current_loop}</p>
        <label className="block text-sm text-slate-300 mb-1">Nøyaktig tidspunkt</label>
        <input type="datetime-local" step="1" value={time} onChange={e => setTime(e.target.value)}
          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 mb-4" />
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={busy}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold">
            {busy ? 'Registrerer...' : '✓ Registrer'}
          </button>
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl">Avbryt</button>
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
            <p className="text-slate-600 text-xs mt-1">Støtter kolonner: Bib, FirstName, LastName, Chip, Gender, Age</p>
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

// ─── Deltaker-rad ─────────────────────────────────────────────────────────────

function ParticipantRow({
  participant, allParticipants, race, rank, onFastTap, onManualSplit, onStatusModal, onRemove, onRefresh
}: {
  participant: Participant
  allParticipants: Participant[]
  race: Race
  rank: number
  onFastTap: () => void
  onManualSplit: () => void
  onStatusModal: () => void
  onRemove: () => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const p = participant
  const isDone = DONE.includes(p.status)
  const lastSplit = [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0]

  return (
    <>
      <div className={`rounded-xl border transition-all ${STATUS_ROW[p.status]} ${isDone ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2 p-3">
          {/* Rang */}
          <span className="text-slate-600 text-sm w-6 text-center shrink-0">{rank}</span>

          {/* Bib */}
          <span className={`text-xs font-bold px-2 py-1 rounded-lg w-10 text-center shrink-0 ${
            isDone ? 'bg-slate-800 text-slate-500' : 'bg-slate-700 text-white border border-slate-600'
          }`}>
            #{p.bib_number}
          </span>

          {/* Navn */}
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm truncate block">{fullName(p)}</span>
            {p.gender && <span className="text-slate-500 text-xs">{p.gender}{p.age ? ` · ${p.age}år` : ''}</span>}
          </div>

          {/* Status */}
          <span className={`text-xs font-medium shrink-0 hidden sm:block ${STATUS_COLOR[p.status]}`}>
            {STATUS_LABEL[p.status]}
          </span>

          {/* Runder + km */}
          <div className="text-center shrink-0 w-16">
            <button onClick={() => setExpanded(!expanded)}
              className={`text-xl font-black w-full rounded-lg py-0.5 transition-colors ${
                isDone
                  ? 'text-slate-500 hover:bg-slate-800'
                  : 'text-white hover:bg-slate-700'
              }`}
              title="Klikk for å se/skjule rundehistorikk">
              {p.loops_completed}
            </button>
            <p className="text-slate-600 text-xs">{p.total_km.toFixed(1)} km</p>
          </div>

          {/* Siste passering */}
          {lastSplit ? (
            <div className="text-right shrink-0 w-24 hidden md:block">
              <p className="text-slate-300 text-xs font-mono">{fmtTime(lastSplit.finish_time_utc)}</p>
              <p className="text-slate-600 text-xs">
                R{lastSplit.loop_number}
                {lastSplit.loop_duration_secs && ` · ${formatDuration(lastSplit.loop_duration_secs)}`}
              </p>
            </div>
          ) : (
            <div className="w-24 hidden md:block" />
          )}

          {/* Handlinger */}
          <div className="flex gap-1 shrink-0">
            {race.is_active && p.status === 'active_running' && (
              <>
                <button onClick={onFastTap}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  ✓ Runde
                </button>
                <button onClick={onManualSplit}
                  className="bg-slate-600 hover:bg-slate-500 text-white text-xs px-2 py-1.5 rounded-lg transition-colors"
                  title="Registrer med nøyaktig tidspunkt">
                  🕐
                </button>
              </>
            )}
            <button onClick={onStatusModal}
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded-lg transition-colors"
              title="Endre status og runder">
              ⚙️
            </button>
            <button onClick={() => setExpanded(!expanded)}
              className={`text-xs px-2 py-1.5 rounded-lg transition-colors ${
                expanded
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
              title="Vis/skjul rundehistorikk">
              {expanded ? '▲' : '▼'}
            </button>
            {isDone && (
              <button onClick={onRemove}
                className="text-slate-700 hover:text-red-400 text-xs px-1.5 py-1.5 rounded-lg transition-colors"
                title="Fjern deltaker">
                🗑️
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Ekspandert rundehistorikk */}
      {expanded && (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden -mt-1 mb-1">
          <LapHistoryRow
            participant={p}
            allParticipants={allParticipants}
            race={race}
            onRefresh={onRefresh}
          />
        </div>
      )}
    </>
  )
}

// ─── Hoveddashboard ───────────────────────────────────────────────────────────

export default function BackyardDashboard() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [statusModal, setStatusModal] = useState<Participant | null>(null)
  const [splitModal, setSplitModal] = useState<Participant | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const { remaining, elapsed } = useCountdown(race)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([getRace(raceId), getParticipants(raceId)])
      setRace(r); setParticipants(ps)
    } finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://localhost:8000/ws/races/${raceId}`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (['split_recorded', 'participant_updated', 'new_loop', 'race_started', 'mass_rtc', 'split_edited', 'split_deleted'].includes(data.event)) load()
        if (data.event === 'split_recorded') showToast(`✅ ${data.participant_name} – Runde ${data.loop_number}${data.is_over_time ? ' (OVER)' : ''}`)
        if (data.event === 'potential_winner') showToast(`🏆 Potensiell vinner: ${data.participant_name}!`)
        if (data.event === 'new_loop') showToast(`🔔 Runde ${data.loop} startet automatisk!`)
      }
      ws.onclose = () => setTimeout(connect, 3000)
    }
    connect()
    return () => wsRef.current?.close()
  }, [raceId, load])

  const handleStart = async () => {
    if (!confirm('Start løpet?')) return
    await startRace(raceId); load()
  }
  const handleNextLoop = async () => {
    if (!confirm(`Start runde ${(race?.current_loop ?? 0) + 1} nå?`)) return
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

  const active = participants
    .filter(p => ACTIVE.includes(p.status))
    .sort((a, b) => {
      if (a.status === 'active_resting' && b.status !== 'active_resting') return -1
      if (b.status === 'active_resting' && a.status !== 'active_resting') return 1
      return b.loops_completed - a.loops_completed || a.bib_number - b.bib_number
    })
  const done = participants
    .filter(p => DONE.includes(p.status))
    .sort((a, b) => b.loops_completed - a.loops_completed || a.bib_number - b.bib_number)

  const cdPct = race ? Math.max(0, Math.min(100, (remaining / (race.loop_duration_minutes * 60)) * 100)) : 0
  const isUrgent = remaining < 120 && remaining > 0 && race?.is_active
  const inGoal = active.filter(p => p.status === 'active_resting').length

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">⏱</div>
        <p>Laster løp...</p>
      </div>
    </div>
  )
  if (!race) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">Løp ikke funnet</div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium border ${
          toast.type === 'ok'
            ? 'bg-emerald-900 border-emerald-700 text-emerald-200'
            : 'bg-red-900 border-red-700 text-red-200'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-white transition-colors text-sm">← Tilbake</Link>
            <span className="text-slate-700">|</span>
            <div>
              <h1 className="font-bold text-lg leading-tight">{race.name}</h1>
              <p className="text-slate-500 text-xs">
                {race.location && `📍 ${race.location} · `}
                {race.loop_distance_km} km · {race.loop_duration_minutes} min/runde
                {race.loop_duration_minutes < 10 && <span className="text-yellow-400 ml-1">⚡ testmodus</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={exportCsv(raceId)} download className="text-slate-500 hover:text-white text-sm px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">⬇ CSV</a>
            <Link to={`/race/${raceId}/participants`} className="text-slate-500 hover:text-white text-sm px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">👥 Deltakere</Link>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-500 hover:text-white text-sm px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📺 TV</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">

        {/* Kontroll-panel */}
        <div className={`rounded-2xl p-4 border ${isUrgent ? 'bg-red-950/40 border-red-800' : 'bg-slate-900 border-slate-800'}`}>
          <div className="flex flex-wrap items-center gap-4">

            {/* Countdown */}
            <div className="flex-1 min-w-48">
              {race.is_active ? (
                <>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`text-5xl font-mono font-black tracking-tight ${isUrgent ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                      {fmtCd(remaining)}
                    </span>
                    <div>
                      <p className="text-slate-400 text-sm">igjen</p>
                      <p className="text-slate-600 text-xs">Runde {race.current_loop}</p>
                    </div>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-1000 ${isUrgent ? 'bg-red-500' : cdPct > 50 ? 'bg-emerald-500' : 'bg-yellow-500'}`}
                      style={{ width: `${cdPct}%` }}
                    />
                  </div>
                  <p className="text-slate-600 text-xs mt-1">Elapsed: {formatDuration(elapsed)}</p>
                </>
              ) : race.is_finished ? (
                <div>
                  <p className="text-2xl font-bold text-slate-400">🏁 Løpet er avsluttet</p>
                  <p className="text-slate-600 text-sm mt-1">Totalt {race.current_loop - 1} runder gjennomført</p>
                </div>
              ) : (
                <div>
                  <p className="text-xl font-semibold text-slate-400">⏳ Klar til start</p>
                  <p className="text-slate-600 text-sm mt-1">{participants.length} deltakere registrert</p>
                </div>
              )}
            </div>

            {/* Knapper */}
            <div className="flex flex-wrap gap-2">
              {!race.is_active && !race.is_finished && (
                <button onClick={handleStart}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-emerald-900/30">
                  ▶ Start løp
                </button>
              )}
              {race.is_active && (
                <>
                  <button onClick={handleNextLoop}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                    ⏭ Neste runde
                  </button>
                  <button onClick={handleFinish}
                    className="bg-slate-700 hover:bg-red-900 text-white px-4 py-2.5 rounded-xl text-sm transition-colors">
                    🏁 Avslutt
                  </button>
                </>
              )}
              <button onClick={() => setShowAdd(true)}
                className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl text-sm transition-colors">
                + Deltaker
              </button>
            </div>

            {/* Statistikk */}
            <div className="flex gap-5 text-center">
              <div>
                <p className="text-3xl font-black text-emerald-400">{active.length}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider">Aktive</p>
              </div>
              <div>
                <p className="text-3xl font-black text-blue-400">{inGoal}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider">I mål</p>
              </div>
              <div>
                <p className="text-3xl font-black text-slate-500">{done.length}</p>
                <p className="text-slate-600 text-xs uppercase tracking-wider">Ute</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabell-header */}
        {(active.length > 0 || done.length > 0) && (
          <div className="grid px-3 py-1 text-xs font-semibold text-slate-600 uppercase tracking-wider"
            style={{ gridTemplateColumns: '1.5rem 2.5rem 1fr 5rem 4rem 6rem auto' }}>
            <span>#</span>
            <span>Bib</span>
            <span>Navn</span>
            <span className="hidden sm:block">Status</span>
            <span className="text-center">Runder</span>
            <span className="text-right hidden md:block">Siste</span>
            <span className="text-right">Handlinger</span>
          </div>
        )}

        {/* Aktive løpere */}
        {active.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block animate-pulse"></span>
              Aktive løpere ({active.length})
            </h2>
            <div className="space-y-1.5">
              {active.map((p, idx) => (
                <ParticipantRow
                  key={p.id}
                  participant={p}
                  allParticipants={participants}
                  race={race}
                  rank={idx + 1}
                  onFastTap={() => handleFastTap(p)}
                  onManualSplit={() => setSplitModal(p)}
                  onStatusModal={() => setStatusModal(p)}
                  onRemove={() => handleRemove(p)}
                  onRefresh={load}
                />
              ))}
            </div>
          </div>
        )}

        {active.length === 0 && !race.is_finished && !race.is_active && (
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
            <p className="text-3xl mb-3">👥</p>
            <p className="font-medium">Ingen deltakere ennå</p>
            <p className="text-sm mt-1">Legg til deltakere og start løpet</p>
          </div>
        )}

        {/* Utgåtte løpere */}
        {done.length > 0 && (
          <div>
            <button onClick={() => setShowDone(!showDone)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-300 transition-colors">
              <span>{showDone ? '▼' : '▶'}</span>
              Utgåtte løpere ({done.length})
            </button>
            {showDone && (
              <div className="space-y-1.5">
                {done.map((p, idx) => (
                  <ParticipantRow
                    key={p.id}
                    participant={p}
                    allParticipants={participants}
                    race={race}
                    rank={active.length + idx + 1}
                    onFastTap={() => {}}
                    onManualSplit={() => {}}
                    onStatusModal={() => setStatusModal(p)}
                    onRemove={() => handleRemove(p)}
                    onRefresh={load}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modaler */}
      {statusModal && <StatusModal race={race} participant={statusModal} onClose={() => setStatusModal(null)} onRefresh={load} />}
      {splitModal && <ManualSplitModal race={race} participant={splitModal} onClose={() => setSplitModal(null)} onRefresh={load} />}
      {showAdd && <AddParticipantModal race={race} onClose={() => setShowAdd(false)} onRefresh={load} />}
    </div>
  )
}
