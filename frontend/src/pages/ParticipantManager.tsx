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
  active_running: 'bg-green-900/60 text-green-300 border border-green-700',
  active_resting: 'bg-blue-900/60 text-blue-300 border border-blue-700',
  rtc: 'bg-orange-900/60 text-orange-300 border border-orange-700',
  dnc: 'bg-red-900/60 text-red-300 border border-red-700',
  over: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  dns: 'bg-slate-700 text-slate-400 border border-slate-600',
  dsq: 'bg-red-950 text-red-400 border border-red-800',
  winner: 'bg-yellow-900/60 text-yellow-200 border border-yellow-600',
}

const ALL_STATUSES: RunnerStatus[] = ['active_running', 'active_resting', 'rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']

// ─── Deltaker-detaljpanel ─────────────────────────────────────────────────────

function ParticipantDetail({
  race, participant, onClose, onRefresh
}: {
  race: Race
  participant: Participant
  onClose: () => void
  onRefresh: () => void
}) {
  const [p, setP] = useState<Participant>(participant)
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
  const [editingSplit, setEditingSplit] = useState<number | null>(null)
  const [editSplitTime, setEditSplitTime] = useState('')
  const [addSplitTime, setAddSplitTime] = useState(() => {
    const now = new Date(), pad = (n: number) => n.toString().padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  })
  const [showAddSplit, setShowAddSplit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const refresh = async () => {
    const ps = await getParticipants(race.id)
    const updated = ps.find(x => x.id === p.id)
    if (updated) { setP(updated); onRefresh() }
  }

  const saveField = async (field: string, value: unknown) => {
    setBusy(true)
    try {
      await updateParticipant(race.id, p.id, { [field]: value })
      setSaved(true); setTimeout(() => setSaved(false), 1500)
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
      setSaved(true); setTimeout(() => setSaved(false), 1500)
      refresh()
    } finally { setBusy(false) }
  }

  const handleEditSplit = async (split: Split) => {
    setBusy(true)
    try {
      await editSplit(race.id, p.id, split.id, toUtcIso(editSplitTime))
      setEditingSplit(null)
      refresh()
    } finally { setBusy(false) }
  }

  const handleDeleteSplit = async (split: Split) => {
    if (!confirm(`Slett runde ${split.loop_number}?`)) return
    setBusy(true)
    try { await deleteSplit(race.id, p.id, split.id); refresh() }
    finally { setBusy(false) }
  }

  const handleAddSplit = async () => {
    setBusy(true)
    try {
      await registerSplit(race.id, p.id, toUtcIso(addSplitTime))
      setShowAddSplit(false)
      refresh()
    } finally { setBusy(false) }
  }

  const sortedSplits = [...p.splits].sort((a, b) => a.loop_number - b.loop_number)

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-slate-600 shadow-2xl my-4">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold">{fullName(p)}</h2>
            <p className="text-slate-400 text-sm">#{p.bib_number} · {p.total_km.toFixed(1)} km totalt</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-green-400 text-sm">✓ Lagret</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="p-5 space-y-6">

          {/* Status og runder */}
          <div className="bg-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Status og runder</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-2">Status</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_STATUSES.map(s => (
                    <button key={s} onClick={() => setEditValues({ ...editValues, status: s })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${
                        editValues.status === s
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                      }`}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">Fullførte runder</label>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setEditValues({ ...editValues, loops_completed: Math.max(0, editValues.loops_completed - 1) })}
                    className="bg-slate-600 hover:bg-slate-500 text-white w-9 h-9 rounded-lg text-lg font-bold">−</button>
                  <span className="text-3xl font-bold w-14 text-center">{editValues.loops_completed}</span>
                  <button onClick={() => setEditValues({ ...editValues, loops_completed: editValues.loops_completed + 1 })}
                    className="bg-slate-600 hover:bg-slate-500 text-white w-9 h-9 rounded-lg text-lg font-bold">+</button>
                </div>
                <button onClick={saveStatus} disabled={busy}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold">
                  {busy ? '...' : 'Lagre status'}
                </button>
              </div>
            </div>
          </div>

          {/* Personinfo */}
          <div className="bg-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Personinformasjon</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Fornavn', field: 'first_name', value: editValues.first_name },
                { label: 'Etternavn', field: 'last_name', value: editValues.last_name },
                { label: 'Startnummer', field: 'bib_number', value: editValues.bib_number.toString(), type: 'number' },
                { label: 'Alder', field: 'age', value: editValues.age, type: 'number' },
                { label: 'Chip ID 1', field: 'chip_id_1', value: editValues.chip_id_1 },
                { label: 'Chip ID 2', field: 'chip_id_2', value: editValues.chip_id_2 },
              ].map(({ label, field, value, type }) => (
                <div key={field}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  {editField === field ? (
                    <div className="flex gap-1">
                      <input
                        type={type || 'text'}
                        value={(editValues as Record<string, string>)[field]}
                        onChange={e => setEditValues({ ...editValues, [field]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value })}
                        autoFocus
                        className="flex-1 bg-slate-600 border border-blue-500 rounded px-2 py-1.5 text-white text-sm focus:outline-none"
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveField(field, (editValues as Record<string, unknown>)[field])
                          if (e.key === 'Escape') setEditField(null)
                        }}
                      />
                      <button onClick={() => saveField(field, (editValues as Record<string, unknown>)[field])}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 rounded text-sm">✓</button>
                      <button onClick={() => setEditField(null)}
                        className="bg-slate-600 hover:bg-slate-500 text-white px-2 rounded text-sm">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditField(field)}
                      className="w-full text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded px-2 py-1.5 text-white text-sm transition-colors">
                      {value || <span className="text-slate-500">–</span>}
                    </button>
                  )}
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Kjønn</label>
                <select value={editValues.gender}
                  onChange={e => { setEditValues({ ...editValues, gender: e.target.value }); saveField('gender', e.target.value) }}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">–</option>
                  <option value="M">Mann</option>
                  <option value="F">Kvinne</option>
                </select>
              </div>
            </div>
          </div>

          {/* Runder/splits */}
          <div className="bg-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Runder ({sortedSplits.length})
              </h3>
              <button onClick={() => setShowAddSplit(!showAddSplit)}
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg">
                + Legg til runde
              </button>
            </div>

            {showAddSplit && (
              <div className="bg-slate-700 rounded-lg p-3 mb-3 flex gap-2 items-center">
                <input type="datetime-local" step="1" value={addSplitTime}
                  onChange={e => setAddSplitTime(e.target.value)}
                  className="flex-1 bg-slate-600 border border-slate-500 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500" />
                <button onClick={handleAddSplit} disabled={busy}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-semibold">✓</button>
                <button onClick={() => setShowAddSplit(false)}
                  className="bg-slate-600 hover:bg-slate-500 text-white px-2 py-1.5 rounded text-sm">✕</button>
              </div>
            )}

            {sortedSplits.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Ingen runder registrert</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {sortedSplits.map(split => (
                  <div key={split.id} className="bg-slate-700 rounded-lg px-3 py-2">
                    {editingSplit === split.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-slate-400 text-xs w-10">R{split.loop_number}</span>
                        <input type="datetime-local" step="1" value={editSplitTime}
                          onChange={e => setEditSplitTime(e.target.value)}
                          className="flex-1 bg-slate-600 border border-blue-500 rounded px-2 py-1 text-white text-sm focus:outline-none" />
                        <button onClick={() => handleEditSplit(split)} disabled={busy}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm">✓</button>
                        <button onClick={() => setEditingSplit(null)}
                          className="bg-slate-600 hover:bg-slate-500 text-white px-2 py-1 rounded text-sm">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-white font-semibold text-sm w-16">Runde {split.loop_number}</span>
                          {split.is_over_time && (
                            <span className="text-yellow-400 text-xs bg-yellow-900/40 px-1.5 py-0.5 rounded">OVER</span>
                          )}
                          <span className="text-slate-300 text-sm font-mono">
                            {new Date(split.finish_time_utc + 'Z').toLocaleTimeString('no-NO')}
                          </span>
                          {split.loop_duration_secs && (
                            <span className="text-slate-500 text-xs">({formatDuration(split.loop_duration_secs)})</span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            split.recorded_by === 'rfid'
                              ? 'bg-blue-900/60 text-blue-300'
                              : 'bg-slate-600 text-slate-400'
                          }`}>
                            {split.recorded_by === 'rfid' ? '📡' : '✋'}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingSplit(split.id); setEditSplitTime(toLocalInputValue(split.finish_time_utc)) }}
                            className="text-slate-400 hover:text-blue-400 text-sm px-1.5 py-1 rounded hover:bg-slate-600 transition-colors">
                            ✏️
                          </button>
                          <button onClick={() => handleDeleteSplit(split)}
                            className="text-slate-400 hover:text-red-400 text-sm px-1.5 py-1 rounded hover:bg-slate-600 transition-colors">
                            🗑️
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Farlig sone */}
          <div className="border border-red-900/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">⚠️ Farlig sone</h3>
            <button
              onClick={async () => {
                if (!confirm(`Fjern ${fullName(p)} permanent fra løpet?`)) return
                await removeParticipant(race.id, p.id)
                onRefresh()
                onClose()
              }}
              className="bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-800 px-4 py-2 rounded-lg text-sm transition-colors">
              🗑️ Fjern deltaker fra løpet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Hoved-side ───────────────────────────────────────────────────────────────

type FilterStatus = 'all' | 'active' | 'in_goal' | 'done' | RunnerStatus

export default function ParticipantManager() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)

  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
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

  // ── Filtrering og sortering ────────────────────────────────────────────────

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
        (p.chip_id_1 || '').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortBy === 'bib') return a.bib_number - b.bib_number
      if (sortBy === 'name') return fullName(a).localeCompare(fullName(b))
      if (sortBy === 'loops') return b.loops_completed - a.loops_completed
      // rank: aktive først, deretter runder
      const aActive = ['active_running', 'active_resting'].includes(a.status)
      const bActive = ['active_running', 'active_resting'].includes(b.status)
      if (aActive && !bActive) return -1
      if (!aActive && bActive) return 1
      return b.loops_completed - a.loops_completed || a.bib_number - b.bib_number
    })

  // Statistikk
  const stats = {
    total: participants.length,
    active: participants.filter(p => ['active_running', 'active_resting'].includes(p.status)).length,
    inGoal: participants.filter(p => p.status === 'active_resting').length,
    rtc: participants.filter(p => p.status === 'rtc').length,
    dnc: participants.filter(p => p.status === 'dnc').length,
  }

  const FILTER_BUTTONS: { key: FilterStatus; label: string; count?: number }[] = [
    { key: 'all', label: 'Alle', count: stats.total },
    { key: 'active', label: '🏃 Aktive', count: stats.active },
    { key: 'in_goal', label: '✅ I mål', count: stats.inGoal },
    { key: 'done', label: '🛑 Ute', count: stats.rtc + stats.dnc },
    { key: 'rtc', label: 'RTC', count: stats.rtc },
    { key: 'dnc', label: 'DNC', count: stats.dnc },
  ]

  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400">Laster...</div>
  if (!race) return <div className="flex items-center justify-center h-screen bg-slate-900 text-red-400">Løp ikke funnet</div>

  return (
    <div className="min-h-screen bg-slate-900 text-white">

      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link to={`/race/${raceId}`} className="text-slate-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
              <div>
                <h1 className="font-bold text-lg leading-tight">Deltakeroversikt</h1>
                <p className="text-slate-400 text-xs">{race.name} · Runde {race.current_loop}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-400 font-semibold">{stats.active} aktive</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{stats.total} totalt</span>
            </div>
          </div>

          {/* Søk og sortering */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="🔍 Søk navn, startnr, chip..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
            />
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="rank">Sorter: Rangering</option>
              <option value="loops">Sorter: Runder</option>
              <option value="bib">Sorter: Startnr</option>
              <option value="name">Sorter: Navn</option>
            </select>
          </div>

          {/* Filterknapper */}
          <div className="flex gap-1.5 flex-wrap">
            {FILTER_BUTTONS.map(({ key, label, count }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}>
                {label} {count !== undefined && <span className="opacity-70">({count})</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabell */}
      <div className="max-w-7xl mx-auto p-4">
        <p className="text-slate-500 text-xs mb-3">
          Viser {filtered.length} av {participants.length} deltakere · Klikk på en rad for å redigere
        </p>

        {filtered.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center text-slate-500">
            Ingen deltakere matcher filteret
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((p, idx) => {
              const lastSplit = [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0]
              const isActive = ['active_running', 'active_resting'].includes(p.status)

              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-all hover:border-blue-600/50 hover:bg-slate-700/50 ${
                    isActive ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-70'
                  }`}
                >
                  {/* Rank */}
                  <span className="text-slate-500 text-sm w-6 text-right shrink-0">{idx + 1}</span>

                  {/* Bib */}
                  <span className="bg-slate-700 text-white text-xs font-bold px-2 py-0.5 rounded w-10 text-center shrink-0">
                    #{p.bib_number}
                  </span>

                  {/* Navn */}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{fullName(p)}</span>
                    {p.gender && <span className="text-slate-500 text-xs ml-1.5">{p.gender}</span>}
                    {p.age && <span className="text-slate-500 text-xs ml-1">{p.age}år</span>}
                    {p.chip_id_1 && (
                      <span className="text-slate-600 text-xs ml-2 font-mono">
                        {p.chip_id_1.slice(-8)}
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <span className={`text-xs font-medium px-2 py-1 rounded-lg shrink-0 ${STATUS_BADGE[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>

                  {/* Runder */}
                  <div className="text-center w-16 shrink-0">
                    <span className={`text-2xl font-bold ${isActive ? 'text-white' : 'text-slate-500'}`}>
                      {p.loops_completed}
                    </span>
                    <p className="text-slate-600 text-xs">{p.total_km.toFixed(1)} km</p>
                  </div>

                  {/* Siste runde */}
                  <div className="text-right w-28 shrink-0">
                    {lastSplit ? (
                      <>
                        <p className="text-slate-300 text-sm font-mono">
                          {new Date(lastSplit.finish_time_utc + 'Z').toLocaleTimeString('no-NO')}
                        </p>
                        {lastSplit.loop_duration_secs && (
                          <p className="text-slate-600 text-xs">{formatDuration(lastSplit.loop_duration_secs)}</p>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-600 text-sm">–</span>
                    )}
                  </div>

                  {/* Pil */}
                  <span className="text-slate-600 text-sm shrink-0">›</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Detaljpanel */}
      {selected && (
        <ParticipantDetail
          race={race}
          participant={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  )
}
