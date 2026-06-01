import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, updateParticipant, removeParticipant,
  registerSplit, editSplit, deleteSplit, fullName, toLocalInputValue, toUtcIso, formatDuration
} from '../api'
import type { Race, Participant, Split, RunnerStatus } from '../api'

// ─── Konstanter ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃 Løper',
  active_resting: '✅ I mål',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰ Over tid',
  dns: '– DNS',
  dsq: '🚫 DSQ',
  winner: '🏆 Vinner',
}

const STATUS_BADGE: Record<RunnerStatus, string> = {
  active_running: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
  active_resting: 'bg-blue-900/60 text-blue-300 border border-blue-700',
  rtc: 'bg-orange-900/60 text-orange-300 border border-orange-700',
  dnc: 'bg-red-900/60 text-red-300 border border-red-700',
  over: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  dns: 'bg-slate-700 text-slate-400 border border-slate-600',
  dsq: 'bg-red-950 text-red-400 border border-red-800',
  winner: 'bg-yellow-800/60 text-yellow-200 border border-yellow-600',
}

const ALL_STATUSES: RunnerStatus[] = ['active_running', 'active_resting', 'rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']

function fmtTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Deltakerprofil-modal ─────────────────────────────────────────────────────

function ParticipantProfile({
  race, participant, allParticipants, onClose, onRefresh
}: {
  race: Race
  participant: Participant
  allParticipants: Participant[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [p, setP] = useState<Participant>(participant)
  const [tab, setTab] = useState<'splits' | 'info' | 'status'>('splits')
  const [editingSplit, setEditingSplit] = useState<number | null>(null)
  const [editSplitTime, setEditSplitTime] = useState('')
  const [showAddSplit, setShowAddSplit] = useState(false)
  const [addSplitTime, setAddSplitTime] = useState(() => {
    const now = new Date(), pad = (n: number) => n.toString().padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  })
  const [editField, setEditField] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({
    first_name: participant.first_name,
    last_name: participant.last_name || '',
    bib_number: participant.bib_number,
    gender: participant.gender || '',
    age: participant.age?.toString() || '',
    chip_id_1: participant.chip_id_1 || '',
    chip_id_2: participant.chip_id_2 || '',
    status: participant.status,
    loops_completed: participant.loops_completed,
  })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000) }

  const refresh = useCallback(async () => {
    const ps = await getParticipants(race.id)
    const updated = ps.find(x => x.id === p.id)
    if (updated) { setP(updated); onRefresh() }
  }, [race.id, p.id, onRefresh])

  const saveField = async (field: string, value: unknown) => {
    setBusy(true)
    try {
      await updateParticipant(race.id, p.id, { [field]: value })
      showToast('Lagret!')
      setEditField(null)
      refresh()
    } finally { setBusy(false) }
  }

  const saveStatus = async () => {
    setBusy(true)
    try {
      await updateParticipant(race.id, p.id, {
        status: editValues.status,
        loops_completed: editValues.loops_completed
      })
      showToast('Status oppdatert!')
      refresh()
    } finally { setBusy(false) }
  }

  const handleEditSplit = async (split: Split) => {
    setBusy(true)
    try {
      await editSplit(race.id, p.id, split.id, toUtcIso(editSplitTime))
      setEditingSplit(null)
      showToast('Rundetid oppdatert!')
      refresh()
    } finally { setBusy(false) }
  }

  const handleDeleteSplit = async (split: Split) => {
    if (!confirm(`Slett runde ${split.loop_number} for ${fullName(p)}?`)) return
    setBusy(true)
    try { await deleteSplit(race.id, p.id, split.id); showToast('Runde slettet'); refresh() }
    finally { setBusy(false) }
  }

  const handleAddSplit = async () => {
    setBusy(true)
    try {
      await registerSplit(race.id, p.id, toUtcIso(addSplitTime))
      setShowAddSplit(false)
      showToast('Runde lagt til!')
      refresh()
    } finally { setBusy(false) }
  }

  const sortedSplits = [...p.splits].sort((a, b) => a.loop_number - b.loop_number)

  // Beregn statistikk
  const durations = sortedSplits.filter(s => s.loop_duration_secs).map(s => s.loop_duration_secs!)
  const bestTime = durations.length ? Math.min(...durations) : null
  const worstTime = durations.length ? Math.max(...durations) : null
  const avgTime = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null

  // Finn rangering per runde (sammenlignet med alle deltakere)
  const getRankForLoop = (loopNum: number, mySecs: number | null): string => {
    if (!mySecs) return '–'
    const others = allParticipants
      .map(ap => ap.splits.find(s => s.loop_number === loopNum)?.loop_duration_secs)
      .filter((s): s is number => !!s)
      .sort((a, b) => a - b)
    const rank = others.indexOf(mySecs) + 1
    return rank > 0 ? `#${rank}` : '–'
  }

  return (
    <div className="fixed inset-0 bg-black/85 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 rounded-2xl w-full max-w-3xl border border-slate-700 shadow-2xl my-4">

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-t-2xl border-b border-slate-700 p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-slate-700 rounded-xl w-14 h-14 flex items-center justify-center text-2xl font-black text-white border border-slate-600">
                #{p.bib_number}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">{fullName(p)}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                  {p.gender && <span className="text-slate-400 text-sm">{p.gender === 'M' ? '♂' : '♀'}</span>}
                  {p.age && <span className="text-slate-400 text-sm">{p.age} år</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {toast && (
                <span className="text-emerald-400 text-sm bg-emerald-900/40 border border-emerald-700 px-3 py-1 rounded-lg">
                  ✓ {toast}
                </span>
              )}
              <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors">×</button>
            </div>
          </div>

          {/* Nøkkeltall */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: 'Runder', value: p.loops_completed, sub: `${p.total_km.toFixed(1)} km` },
              { label: 'Beste runde', value: bestTime ? formatDuration(bestTime) : '–', sub: 'raskeste' },
              { label: 'Snitt', value: avgTime ? formatDuration(avgTime) : '–', sub: 'per runde' },
              { label: 'Verste runde', value: worstTime ? formatDuration(worstTime) : '–', sub: 'tregeste' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
                <p className="text-white font-bold text-lg leading-tight">{value}</p>
                <p className="text-slate-500 text-xs">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {[
            { key: 'splits', label: `📊 Rundetider (${sortedSplits.length})` },
            { key: 'info', label: '👤 Personinfo' },
            { key: 'status', label: '⚙️ Status' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key as typeof tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === key
                  ? 'text-white border-b-2 border-blue-500 bg-slate-800/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">

          {/* ── Tab: Rundetider ─────────────────────────────────────────────── */}
          {tab === 'splits' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-slate-400 text-sm">
                  {sortedSplits.length === 0
                    ? 'Ingen runder registrert ennå'
                    : `${sortedSplits.length} runder registrert`}
                </p>
                <button onClick={() => setShowAddSplit(!showAddSplit)}
                  className="flex items-center gap-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
                  + Legg til runde
                </button>
              </div>

              {showAddSplit && (
                <div className="bg-slate-800 border border-slate-600 rounded-xl p-4 mb-4">
                  <p className="text-slate-300 text-sm font-medium mb-2">Tidspunkt for ny runde:</p>
                  <div className="flex gap-2">
                    <input type="datetime-local" step="1" value={addSplitTime}
                      onChange={e => setAddSplitTime(e.target.value)}
                      className="flex-1 bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    <button onClick={handleAddSplit} disabled={busy}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                      Legg til
                    </button>
                    <button onClick={() => setShowAddSplit(false)}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors">
                      Avbryt
                    </button>
                  </div>
                </div>
              )}

              {sortedSplits.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <p className="text-4xl mb-3">🏁</p>
                  <p>Ingen runder registrert for denne løperen ennå</p>
                </div>
              ) : (
                <>
                  {/* Tabell-header */}
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700 mb-1">
                    <div className="col-span-1">Runde</div>
                    <div className="col-span-3">Passeringstid</div>
                    <div className="col-span-2">Rundetid</div>
                    <div className="col-span-2">Kumulativ</div>
                    <div className="col-span-1 text-center">Rang</div>
                    <div className="col-span-1 text-center">Kilde</div>
                    <div className="col-span-2 text-right">Handlinger</div>
                  </div>

                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {sortedSplits.map((split, idx) => {
                      const cumSecs = sortedSplits
                        .slice(0, idx + 1)
                        .reduce((acc, s) => acc + (s.loop_duration_secs || 0), 0)
                      const rank = getRankForLoop(split.loop_number, split.loop_duration_secs)
                      const isBest = split.loop_duration_secs === bestTime && durations.length > 1
                      const isWorst = split.loop_duration_secs === worstTime && durations.length > 1

                      return (
                        <div key={split.id}>
                          {editingSplit === split.id ? (
                            <div className="bg-blue-950/40 border border-blue-700 rounded-xl px-3 py-3">
                              <p className="text-blue-300 text-xs mb-2">Rediger tidspunkt for runde {split.loop_number}:</p>
                              <div className="flex gap-2 items-center">
                                <input type="datetime-local" step="1" value={editSplitTime}
                                  onChange={e => setEditSplitTime(e.target.value)}
                                  className="flex-1 bg-slate-700 border border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
                                <button onClick={() => handleEditSplit(split)} disabled={busy}
                                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                                  Lagre
                                </button>
                                <button onClick={() => setEditingSplit(null)}
                                  className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm">
                                  Avbryt
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className={`grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-xl transition-colors hover:bg-slate-800/60 ${
                              isBest ? 'bg-emerald-950/30 border border-emerald-900/50' :
                              isWorst ? 'bg-red-950/20 border border-red-900/30' :
                              split.is_over_time ? 'bg-yellow-950/20 border border-yellow-900/30' :
                              'border border-transparent'
                            }`}>
                              {/* Runde */}
                              <div className="col-span-1">
                                <span className="text-white font-bold text-sm">{split.loop_number}</span>
                                {isBest && <span className="ml-1 text-emerald-400 text-xs">↑</span>}
                                {isWorst && <span className="ml-1 text-red-400 text-xs">↓</span>}
                              </div>

                              {/* Passeringstid */}
                              <div className="col-span-3">
                                <span className="text-white font-mono text-sm">{fmtTime(split.finish_time_utc)}</span>
                                <p className="text-slate-600 text-xs">{fmtDate(split.finish_time_utc)}</p>
                              </div>

                              {/* Rundetid */}
                              <div className="col-span-2">
                                {split.loop_duration_secs ? (
                                  <span className={`font-mono text-sm font-semibold ${
                                    isBest ? 'text-emerald-400' :
                                    isWorst ? 'text-red-400' :
                                    'text-slate-200'
                                  }`}>
                                    {formatDuration(split.loop_duration_secs)}
                                  </span>
                                ) : (
                                  <span className="text-slate-600 text-sm">–</span>
                                )}
                                {split.is_over_time && (
                                  <span className="ml-1 text-yellow-400 text-xs">OVER</span>
                                )}
                              </div>

                              {/* Kumulativ */}
                              <div className="col-span-2">
                                <span className="text-slate-400 font-mono text-sm">
                                  {cumSecs > 0 ? formatDuration(cumSecs) : '–'}
                                </span>
                              </div>

                              {/* Rangering */}
                              <div className="col-span-1 text-center">
                                <span className={`text-xs font-bold ${
                                  rank === '#1' ? 'text-yellow-400' :
                                  rank === '#2' ? 'text-slate-300' :
                                  rank === '#3' ? 'text-orange-400' :
                                  'text-slate-500'
                                }`}>{rank}</span>
                              </div>

                              {/* Kilde */}
                              <div className="col-span-1 text-center">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  split.recorded_by === 'rfid'
                                    ? 'bg-blue-900/60 text-blue-300'
                                    : 'bg-slate-700 text-slate-400'
                                }`} title={split.recorded_by}>
                                  {split.recorded_by === 'rfid' ? '📡' : '✋'}
                                </span>
                              </div>

                              {/* Handlinger */}
                              <div className="col-span-2 flex justify-end gap-1">
                                <button
                                  onClick={() => {
                                    setEditingSplit(split.id)
                                    setEditSplitTime(toLocalInputValue(split.finish_time_utc))
                                  }}
                                  className="text-slate-500 hover:text-blue-400 hover:bg-blue-900/30 px-2 py-1 rounded-lg text-xs transition-colors"
                                  title="Rediger tidspunkt">
                                  ✏️ Rediger
                                </button>
                                <button onClick={() => handleDeleteSplit(split)}
                                  className="text-slate-500 hover:text-red-400 hover:bg-red-900/30 px-2 py-1 rounded-lg text-xs transition-colors"
                                  title="Slett runde">
                                  🗑️
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Oppsummering */}
                  {sortedSplits.length > 1 && (
                    <div className="mt-4 bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                      <h4 className="text-slate-300 text-sm font-semibold mb-3">📈 Statistikk</h4>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-emerald-400 font-bold text-lg">{formatDuration(bestTime!)}</p>
                          <p className="text-slate-500 text-xs">Beste runde</p>
                        </div>
                        <div>
                          <p className="text-slate-200 font-bold text-lg">{formatDuration(avgTime!)}</p>
                          <p className="text-slate-500 text-xs">Snitt</p>
                        </div>
                        <div>
                          <p className="text-red-400 font-bold text-lg">{formatDuration(worstTime!)}</p>
                          <p className="text-slate-500 text-xs">Tregeste runde</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tab: Personinfo ─────────────────────────────────────────────── */}
          {tab === 'info' && (
            <div className="space-y-3">
              {[
                { label: 'Fornavn', field: 'first_name', value: editValues.first_name, required: true },
                { label: 'Etternavn', field: 'last_name', value: editValues.last_name },
                { label: 'Startnummer', field: 'bib_number', value: editValues.bib_number.toString(), type: 'number' },
                { label: 'Alder', field: 'age', value: editValues.age, type: 'number' },
                { label: 'Chip ID 1 (primær)', field: 'chip_id_1', value: editValues.chip_id_1 },
                { label: 'Chip ID 2 (backup)', field: 'chip_id_2', value: editValues.chip_id_2 },
              ].map(({ label, field, value, type, required }) => (
                <div key={field} className="flex items-center gap-3">
                  <label className="text-slate-400 text-sm w-40 shrink-0">
                    {label}{required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {editField === field ? (
                    <div className="flex-1 flex gap-2">
                      <input
                        type={type || 'text'}
                        value={(editValues as Record<string, string>)[field]}
                        onChange={e => setEditValues({
                          ...editValues,
                          [field]: type === 'number' ? (parseInt(e.target.value) || 0) : e.target.value
                        })}
                        autoFocus
                        className="flex-1 bg-slate-700 border border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveField(field, (editValues as Record<string, unknown>)[field])
                          if (e.key === 'Escape') setEditField(null)
                        }}
                      />
                      <button onClick={() => saveField(field, (editValues as Record<string, unknown>)[field])}
                        disabled={busy}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold">
                        Lagre
                      </button>
                      <button onClick={() => setEditField(null)}
                        className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm">
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditField(field)}
                      className="flex-1 text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 text-sm transition-colors group">
                      <span className={value ? 'text-white' : 'text-slate-600'}>
                        {value || 'Ikke satt'}
                      </span>
                      <span className="text-slate-600 group-hover:text-slate-400 float-right text-xs">✏️</span>
                    </button>
                  )}
                </div>
              ))}

              <div className="flex items-center gap-3">
                <label className="text-slate-400 text-sm w-40 shrink-0">Kjønn</label>
                <select value={editValues.gender}
                  onChange={e => { setEditValues({ ...editValues, gender: e.target.value }); saveField('gender', e.target.value) }}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Ikke satt</option>
                  <option value="M">Mann (M)</option>
                  <option value="F">Kvinne (F)</option>
                </select>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-700">
                <button
                  onClick={async () => {
                    if (!confirm(`Fjern ${fullName(p)} permanent fra løpet? Dette kan ikke angres.`)) return
                    await removeParticipant(race.id, p.id)
                    onRefresh()
                    onClose()
                  }}
                  className="flex items-center gap-2 bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-900 px-4 py-2 rounded-lg text-sm transition-colors">
                  🗑️ Fjern deltaker permanent fra løpet
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: Status ─────────────────────────────────────────────────── */}
          {tab === 'status' && (
            <div className="space-y-5">
              <div>
                <p className="text-slate-400 text-sm mb-3">Velg status for løperen:</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.map(s => (
                    <button key={s} onClick={() => setEditValues({ ...editValues, status: s })}
                      className={`py-3 px-4 rounded-xl text-sm font-medium border transition-all text-left ${
                        editValues.status === s
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:border-slate-500'
                      }`}>
                      {STATUS_LABEL[s]}
                      {editValues.status === s && <span className="float-right">✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-slate-400 text-sm mb-3">Fullførte runder (overstyrer automatisk beregning):</p>
                <div className="flex items-center gap-4">
                  <button onClick={() => setEditValues({ ...editValues, loops_completed: Math.max(0, editValues.loops_completed - 1) })}
                    className="bg-slate-700 hover:bg-slate-600 text-white w-12 h-12 rounded-xl text-2xl font-bold transition-colors">−</button>
                  <div className="text-center flex-1">
                    <span className="text-5xl font-black text-white">{editValues.loops_completed}</span>
                    <p className="text-slate-500 text-sm mt-1">
                      {(editValues.loops_completed * race.loop_distance_km).toFixed(1)} km totalt
                    </p>
                  </div>
                  <button onClick={() => setEditValues({ ...editValues, loops_completed: editValues.loops_completed + 1 })}
                    className="bg-slate-700 hover:bg-slate-600 text-white w-12 h-12 rounded-xl text-2xl font-bold transition-colors">+</button>
                </div>
              </div>

              <button onClick={saveStatus} disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors">
                {busy ? 'Lagrer...' : 'Lagre status og runder'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Hoved-side ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'active' | 'in_goal' | 'done' | RunnerStatus

export default function ParticipantManager() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)

  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'rank' | 'bib' | 'name' | 'loops'>('rank')
  const [selected, setSelected] = useState<Participant | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([getRace(raceId), getParticipants(raceId)])
      setRace(r); setParticipants(ps)
    } finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/races/${raceId}`)
    wsRef.current = ws
    ws.onmessage = () => load()
    return () => ws.close()
  }, [raceId, load])

  const filtered = participants
    .filter(p => {
      if (filter === 'all') return true
      if (filter === 'active') return ['active_running', 'active_resting'].includes(p.status)
      if (filter === 'in_goal') return p.status === 'active_resting'
      if (filter === 'done') return ['rtc', 'dnc', 'over', 'dns', 'dsq', 'winner'].includes(p.status)
      return p.status === filter
    })
    .filter(p => {
      if (!search) return true
      const q = search.toLowerCase()
      return fullName(p).toLowerCase().includes(q) ||
        p.bib_number.toString().includes(q) ||
        (p.chip_id_1 || '').toLowerCase().includes(q) ||
        (p.chip_id_2 || '').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortBy === 'bib') return a.bib_number - b.bib_number
      if (sortBy === 'name') return fullName(a).localeCompare(fullName(b))
      if (sortBy === 'loops') return b.loops_completed - a.loops_completed
      const aActive = ['active_running', 'active_resting'].includes(a.status)
      const bActive = ['active_running', 'active_resting'].includes(b.status)
      if (aActive && !bActive) return -1
      if (!aActive && bActive) return 1
      return b.loops_completed - a.loops_completed || a.bib_number - b.bib_number
    })

  const stats = {
    total: participants.length,
    active: participants.filter(p => ['active_running', 'active_resting'].includes(p.status)).length,
    running: participants.filter(p => p.status === 'active_running').length,
    inGoal: participants.filter(p => p.status === 'active_resting').length,
    rtc: participants.filter(p => p.status === 'rtc').length,
    dnc: participants.filter(p => p.status === 'dnc').length,
    winner: participants.filter(p => p.status === 'winner').length,
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">⏱</div>
        <p>Laster deltakere...</p>
      </div>
    </div>
  )
  if (!race) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">
      Løp ikke funnet
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link to={`/race/${raceId}`}
                className="text-slate-500 hover:text-white text-sm transition-colors flex items-center gap-1">
                ← Dashboard
              </Link>
              <span className="text-slate-700">|</span>
              <div>
                <h1 className="font-bold text-lg leading-tight">{race.name}</h1>
                <p className="text-slate-500 text-xs">
                  Runde {race.current_loop} · {race.loop_distance_km} km per runde
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to={`/race/${raceId}/scoreboard`}
                className="text-slate-400 hover:text-white text-sm px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">
                📺 TV
              </Link>
            </div>
          </div>

          {/* Statistikk-bar */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {[
              { key: 'all', label: 'Alle', count: stats.total, color: 'text-slate-300' },
              { key: 'active', label: '🏃 Aktive', count: stats.active, color: 'text-emerald-400' },
              { key: 'active_running', label: 'Løper nå', count: stats.running, color: 'text-emerald-300' },
              { key: 'in_goal', label: '✅ I mål', count: stats.inGoal, color: 'text-blue-400' },
              { key: 'rtc', label: '🛑 RTC', count: stats.rtc, color: 'text-orange-400' },
              { key: 'dnc', label: '❌ DNC', count: stats.dnc, color: 'text-red-400' },
              { key: 'winner', label: '🏆 Vinner', count: stats.winner, color: 'text-yellow-400' },
            ].map(({ key, label, count, color }) => (
              <button key={key} onClick={() => setFilter(key as FilterKey)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  filter === key
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-400'
                }`}>
                <span className={filter === key ? 'text-white' : color}>{label}</span>
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            ))}
          </div>

          {/* Søk og sortering */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Søk navn, startnummer, chip-ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-600"
              />
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="rank">↕ Rangering</option>
              <option value="loops">↕ Runder</option>
              <option value="bib">↕ Startnr</option>
              <option value="name">↕ Navn A–Å</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabell */}
      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* Tabell-header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
          <div className="col-span-1">#</div>
          <div className="col-span-1">Bib</div>
          <div className="col-span-3">Navn</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-center">Runder</div>
          <div className="col-span-2 text-center">Km totalt</div>
          <div className="col-span-2 text-right">Siste passering</div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-12 text-center text-slate-500">
            <p className="text-3xl mb-3">🔍</p>
            <p>Ingen deltakere matcher søket eller filteret</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((p, idx) => {
              const lastSplit = [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0]
              const isActive = ['active_running', 'active_resting'].includes(p.status)
              const isRunning = p.status === 'active_running'

              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`w-full text-left rounded-xl border px-4 py-3 grid grid-cols-12 gap-2 items-center transition-all hover:border-blue-600/50 hover:bg-slate-800/60 group ${
                    isRunning ? 'bg-slate-900 border-emerald-900/40' :
                    isActive ? 'bg-slate-900 border-blue-900/30' :
                    'bg-slate-950 border-slate-800/60 opacity-60 hover:opacity-80'
                  }`}
                >
                  {/* Rank */}
                  <div className="col-span-1 text-slate-600 text-sm font-medium">{idx + 1}</div>

                  {/* Bib */}
                  <div className="col-span-1">
                    <span className="bg-slate-800 text-white text-xs font-bold px-2 py-1 rounded-lg border border-slate-700">
                      {p.bib_number}
                    </span>
                  </div>

                  {/* Navn */}
                  <div className="col-span-3">
                    <p className="font-semibold text-sm text-white group-hover:text-blue-300 transition-colors">
                      {fullName(p)}
                    </p>
                    <p className="text-slate-600 text-xs">
                      {p.gender && `${p.gender} · `}{p.age && `${p.age}år`}
                      {p.chip_id_1 && ` · ${p.chip_id_1.slice(-6)}`}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-lg ${STATUS_BADGE[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>

                  {/* Runder */}
                  <div className="col-span-1 text-center">
                    <span className={`text-2xl font-black ${isActive ? 'text-white' : 'text-slate-600'}`}>
                      {p.loops_completed}
                    </span>
                  </div>

                  {/* Km */}
                  <div className="col-span-2 text-center">
                    <span className={`text-sm font-semibold ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>
                      {p.total_km.toFixed(1)} km
                    </span>
                  </div>

                  {/* Siste passering */}
                  <div className="col-span-2 text-right">
                    {lastSplit ? (
                      <div>
                        <p className="text-slate-300 text-sm font-mono">{fmtTime(lastSplit.finish_time_utc)}</p>
                        <p className="text-slate-600 text-xs">
                          R{lastSplit.loop_number}
                          {lastSplit.loop_duration_secs && ` · ${formatDuration(lastSplit.loop_duration_secs)}`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-slate-700 text-sm">–</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <p className="text-slate-700 text-xs text-center mt-4">
          Klikk på en deltaker for å se full rundehistorikk og redigere
        </p>
      </div>

      {/* Deltakerprofil-modal */}
      {selected && (
        <ParticipantProfile
          race={race}
          participant={selected}
          allParticipants={participants}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  )
}
