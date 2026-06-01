/**
 * ParticipantEditor – Side 2 av 3 under et aktivt løp
 *
 * Viser alle deltakere med:
 * - Filter på status (alle / aktive / i mål / ute)
 * - Søk på navn, bib, chip
 * - Sortering
 * - Klikk på deltaker → full profil med alle runder, redigering, statusendring
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, updateParticipant, removeParticipant,
  registerSplit, editSplit, deleteSplit, addParticipant,
  fullName, toLocalInputValue, toUtcIso, formatDuration, exportCsv
} from '../api'
import type { Race, Participant, Split, RunnerStatus } from '../api'

// ─── Konstanter ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃 Ute',
  active_resting: '✅ I mål',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰ OVER',
  dns: '– DNS',
  dsq: '🚫 DSQ',
  winner: '🏆 VINNER',
}

const STATUS_COLOR: Record<RunnerStatus, string> = {
  active_running: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  active_resting: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  rtc: 'bg-orange-900/30 text-orange-300 border-orange-800/30',
  dnc: 'bg-red-900/30 text-red-300 border-red-800/30',
  over: 'bg-yellow-900/30 text-yellow-300 border-yellow-800/30',
  dns: 'bg-slate-800 text-slate-500 border-slate-700',
  dsq: 'bg-red-950/50 text-red-400 border-red-900/50',
  winner: 'bg-yellow-900/40 text-yellow-200 border-yellow-700/50',
}

const ALL_STATUSES: RunnerStatus[] = ['active_running', 'active_resting', 'rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']

type FilterTab = 'all' | 'active' | 'goal' | 'out'
type SortKey = 'bib' | 'name' | 'loops' | 'status'

function fmtTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' })
}

// ─── Deltakerprofil (sidebar/modal) ──────────────────────────────────────────

function ParticipantProfile({ race, participant, onClose, onRefresh }: {
  race: Race
  participant: Participant
  onClose: () => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'splits' | 'info' | 'status'>('splits')
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState({
    first_name: participant.first_name,
    last_name: participant.last_name || '',
    bib_number: participant.bib_number.toString(),
    gender: participant.gender || '',
    age: participant.age?.toString() || '',
    chip_id_1: participant.chip_id_1 || '',
    chip_id_2: participant.chip_id_2 || '',
  })
  const [editingSplitId, setEditingSplitId] = useState<number | null>(null)
  const [editSplitVal, setEditSplitVal] = useState('')
  const [addSplitTime, setAddSplitTime] = useState('')
  const [showAddSplit, setShowAddSplit] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<RunnerStatus>(participant.status)
  const [loopsOverride, setLoopsOverride] = useState(participant.loops_completed)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const splits = [...participant.splits].sort((a, b) => a.loop_number - b.loop_number)

  // Statistikk
  const validSplits = splits.filter(s => s.loop_duration_secs && !s.is_over_time)
  const bestSplit = validSplits.length ? Math.min(...validSplits.map(s => s.loop_duration_secs!)) : null
  const worstSplit = validSplits.length ? Math.max(...validSplits.map(s => s.loop_duration_secs!)) : null
  const avgSplit = validSplits.length ? validSplits.reduce((a, b) => a + b.loop_duration_secs!, 0) / validSplits.length : null

  const handleSaveInfo = async () => {
    setBusy(true)
    try {
      await updateParticipant(race.id, participant.id, {
        first_name: infoForm.first_name,
        last_name: infoForm.last_name || undefined,
        bib_number: parseInt(infoForm.bib_number),
        gender: infoForm.gender || undefined,
        age: infoForm.age ? parseInt(infoForm.age) : undefined,
        chip_id_1: infoForm.chip_id_1 || undefined,
        chip_id_2: infoForm.chip_id_2 || undefined,
      })
      setEditingInfo(false); onRefresh(); showToast('✅ Lagret')
    } finally { setBusy(false) }
  }

  const handleSaveStatus = async () => {
    setBusy(true)
    try {
      await updateParticipant(race.id, participant.id, { status: selectedStatus, loops_completed: loopsOverride })
      onRefresh(); showToast('✅ Status oppdatert')
    } finally { setBusy(false) }
  }

  const handleEditSplit = async (split: Split) => {
    setBusy(true)
    try {
      await editSplit(race.id, participant.id, split.id, toUtcIso(editSplitVal))
      setEditingSplitId(null); onRefresh(); showToast('✅ Rundetid oppdatert')
    } finally { setBusy(false) }
  }

  const handleDeleteSplit = async (split: Split) => {
    if (!confirm(`Slett runde ${split.loop_number}?`)) return
    setBusy(true)
    try {
      await deleteSplit(race.id, participant.id, split.id)
      onRefresh(); showToast('🗑️ Runde slettet')
    } finally { setBusy(false) }
  }

  const handleAddSplit = async () => {
    setBusy(true)
    try {
      await registerSplit(race.id, participant.id, addSplitTime ? toUtcIso(addSplitTime) : undefined)
      setShowAddSplit(false); setAddSplitTime(''); onRefresh(); showToast('✅ Runde lagt til')
    } finally { setBusy(false) }
  }

  const handleRemove = async () => {
    if (!confirm(`Fjern ${fullName(participant)} fra løpet permanent?`)) return
    await removeParticipant(race.id, participant.id); onRefresh(); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start justify-end z-50">
      <div className="bg-slate-900 border-l border-slate-700 w-full max-w-xl h-full overflow-y-auto flex flex-col shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-start justify-between z-10">
          <div>
            <h2 className="text-xl font-bold">{fullName(participant)}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-slate-700 text-white text-xs font-bold px-2 py-0.5 rounded">#{participant.bib_number}</span>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLOR[participant.status]}`}>{STATUS_LABEL[participant.status]}</span>
              {participant.gender && <span className="text-slate-500 text-xs">{participant.gender}</span>}
              {participant.age && <span className="text-slate-500 text-xs">{participant.age} år</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-800 text-xl transition-colors">×</button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-5 mt-3 bg-emerald-900/50 border border-emerald-700 text-emerald-200 text-sm px-4 py-2 rounded-xl">{toast}</div>
        )}

        {/* Stats-linje */}
        <div className="px-5 py-3 grid grid-cols-4 gap-3 border-b border-slate-800">
          <div className="text-center">
            <p className="text-2xl font-black text-white">{participant.loops_completed}</p>
            <p className="text-slate-600 text-xs">Runder</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-white">{participant.total_km.toFixed(1)}</p>
            <p className="text-slate-600 text-xs">km</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-400">{bestSplit ? formatDuration(bestSplit) : '–'}</p>
            <p className="text-slate-600 text-xs">Beste</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-400">{avgSplit ? formatDuration(avgSplit) : '–'}</p>
            <p className="text-slate-600 text-xs">Snitt</p>
          </div>
        </div>

        {/* Faner */}
        <div className="flex border-b border-slate-800">
          {(['splits', 'info', 'status'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === t ? 'text-white border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}>
              {t === 'splits' ? `📊 Runder (${splits.length})` : t === 'info' ? '👤 Info' : '⚙️ Status'}
            </button>
          ))}
        </div>

        {/* Tab: Runder */}
        {tab === 'splits' && (
          <div className="flex-1 p-4 space-y-2">
            {splits.length === 0 ? (
              <div className="text-center py-10 text-slate-600">
                <p className="text-3xl mb-2">📭</p>
                <p>Ingen runder registrert ennå</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-12 gap-1 text-xs text-slate-600 uppercase tracking-wider px-3 pb-1">
                  <span className="col-span-1">Runde</span>
                  <span className="col-span-3">Passeringstid</span>
                  <span className="col-span-2">Rundetid</span>
                  <span className="col-span-2">Kumulativ</span>
                  <span className="col-span-2">Kilde</span>
                  <span className="col-span-2 text-right">Handlinger</span>
                </div>

                {splits.map((split, idx) => {
                  const cumSecs = splits.slice(0, idx + 1).reduce((a, s) => a + (s.loop_duration_secs || 0), 0)
                  const isBest = bestSplit !== null && split.loop_duration_secs === bestSplit && !split.is_over_time
                  const isWorst = worstSplit !== null && split.loop_duration_secs === worstSplit && !split.is_over_time && validSplits.length > 1
                  const isEditing = editingSplitId === split.id

                  return (
                    <div key={split.id} className={`rounded-xl border p-3 transition-colors ${
                      split.is_over_time ? 'bg-yellow-950/20 border-yellow-900/30' :
                      isBest ? 'bg-emerald-950/30 border-emerald-900/30' :
                      isWorst ? 'bg-red-950/20 border-red-900/20' :
                      'bg-slate-800/50 border-slate-700/50'
                    }`}>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-sm font-bold w-8">R{split.loop_number}</span>
                          <input type="datetime-local" step="1" value={editSplitVal}
                            onChange={e => setEditSplitVal(e.target.value)}
                            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500" />
                          <button onClick={() => handleEditSplit(split)} disabled={busy}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">✓</button>
                          <button onClick={() => setEditingSplitId(null)}
                            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm">✕</button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-12 gap-1 items-center text-sm">
                          <div className="col-span-1 flex items-center gap-1">
                            <span className="font-bold text-slate-300">R{split.loop_number}</span>
                            {isBest && <span className="text-emerald-400 text-xs">↑</span>}
                            {isWorst && <span className="text-red-400 text-xs">↓</span>}
                          </div>
                          <div className="col-span-3">
                            <p className="font-mono text-white text-xs">{fmtTime(split.finish_time_utc)}</p>
                            <p className="text-slate-600 text-xs">{fmtDate(split.finish_time_utc)}</p>
                          </div>
                          <div className="col-span-2">
                            <p className={`font-mono text-xs font-semibold ${isBest ? 'text-emerald-400' : isWorst ? 'text-red-400' : 'text-white'}`}>
                              {split.loop_duration_secs ? formatDuration(split.loop_duration_secs) : '–'}
                            </p>
                            {split.is_over_time && <span className="text-yellow-500 text-xs">OVER</span>}
                          </div>
                          <div className="col-span-2">
                            <p className="font-mono text-slate-400 text-xs">{formatDuration(cumSecs)}</p>
                          </div>
                          <div className="col-span-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${split.recorded_by === 'rfid' ? 'bg-purple-900/40 text-purple-300' : split.recorded_by === 'manual' ? 'bg-slate-700 text-slate-400' : 'bg-blue-900/30 text-blue-400'}`}>
                              {split.recorded_by === 'rfid' ? '📡' : split.recorded_by === 'manual' ? '✋' : '📥'} {split.recorded_by}
                            </span>
                          </div>
                          <div className="col-span-2 flex justify-end gap-1">
                            <button onClick={() => { setEditingSplitId(split.id); setEditSplitVal(toLocalInputValue(split.finish_time_utc)) }}
                              className="text-slate-500 hover:text-blue-400 p-1 rounded transition-colors" title="Rediger">✏️</button>
                            <button onClick={() => handleDeleteSplit(split)}
                              className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors" title="Slett">🗑️</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Statistikk-linje */}
                {validSplits.length > 1 && (
                  <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-3 mt-2">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Statistikk</p>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div><p className="text-emerald-400 font-mono text-sm font-bold">{formatDuration(bestSplit)}</p><p className="text-slate-600 text-xs">Beste</p></div>
                      <div><p className="text-blue-400 font-mono text-sm font-bold">{formatDuration(avgSplit)}</p><p className="text-slate-600 text-xs">Snitt</p></div>
                      <div><p className="text-red-400 font-mono text-sm font-bold">{formatDuration(worstSplit)}</p><p className="text-slate-600 text-xs">Tregeste</p></div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Legg til runde */}
            {showAddSplit ? (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-300">Legg til runde manuelt</p>
                <input type="datetime-local" step="1" value={addSplitTime}
                  onChange={e => setAddSplitTime(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                <p className="text-slate-600 text-xs">La stå tom for å bruke nåværende tidspunkt</p>
                <div className="flex gap-2">
                  <button onClick={handleAddSplit} disabled={busy} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2 rounded-xl text-sm font-semibold">
                    {busy ? 'Legger til...' : '+ Legg til'}
                  </button>
                  <button onClick={() => setShowAddSplit(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-xl text-sm">Avbryt</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddSplit(true)}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-700 text-slate-400 hover:text-white py-3 rounded-xl text-sm transition-colors">
                + Legg til runde manuelt
              </button>
            )}
          </div>
        )}

        {/* Tab: Info */}
        {tab === 'info' && (
          <div className="flex-1 p-4">
            {editingInfo ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[['Fornavn', 'first_name'], ['Etternavn', 'last_name'], ['Startnummer', 'bib_number'], ['Chip ID 1', 'chip_id_1'], ['Chip ID 2', 'chip_id_2']].map(([label, key]) => (
                    <div key={key} className={key === 'chip_id_2' ? 'col-span-2' : ''}>
                      <label className="block text-xs text-slate-400 mb-1">{label}</label>
                      <input value={(infoForm as Record<string, string>)[key]}
                        onChange={e => setInfoForm({ ...infoForm, [key]: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Kjønn</label>
                    <select value={infoForm.gender} onChange={e => setInfoForm({ ...infoForm, gender: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                      <option value="">–</option><option value="M">Mann</option><option value="F">Kvinne</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Alder</label>
                    <input type="number" value={infoForm.age} onChange={e => setInfoForm({ ...infoForm, age: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveInfo} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold text-sm">
                    {busy ? 'Lagrer...' : '✓ Lagre'}
                  </button>
                  <button onClick={() => setEditingInfo(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl text-sm">Avbryt</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  ['Fornavn', participant.first_name],
                  ['Etternavn', participant.last_name || '–'],
                  ['Startnummer', `#${participant.bib_number}`],
                  ['Kjønn', participant.gender || '–'],
                  ['Alder', participant.age ? `${participant.age} år` : '–'],
                  ['Chip ID 1', participant.chip_id_1 || '–'],
                  ['Chip ID 2', participant.chip_id_2 || '–'],
                  ['Total km', `${participant.total_km.toFixed(2)} km`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-slate-800">
                    <span className="text-slate-500 text-sm">{label}</span>
                    <span className="text-white text-sm font-medium">{value}</span>
                  </div>
                ))}
                <button onClick={() => setEditingInfo(true)}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-2.5 rounded-xl text-sm mt-2 transition-colors">
                  ✏️ Rediger informasjon
                </button>
                <button onClick={handleRemove}
                  className="w-full bg-red-950/30 hover:bg-red-900/40 border border-red-900/30 text-red-400 py-2.5 rounded-xl text-sm transition-colors">
                  🗑️ Fjern fra løpet
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab: Status */}
        {tab === 'status' && (
          <div className="flex-1 p-4 space-y-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Nåværende status</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_STATUSES.map(s => (
                  <button key={s} onClick={() => setSelectedStatus(s)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors text-left ${
                      selectedStatus === s ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {STATUS_LABEL[s]}
                    {selectedStatus === s && <span className="float-right">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Antall fullførte runder</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setLoopsOverride(Math.max(0, loopsOverride - 1))}
                  className="w-10 h-10 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold text-xl flex items-center justify-center">−</button>
                <span className="text-3xl font-black text-white w-12 text-center">{loopsOverride}</span>
                <button onClick={() => setLoopsOverride(loopsOverride + 1)}
                  className="w-10 h-10 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold text-xl flex items-center justify-center">+</button>
                <span className="text-slate-500 text-sm">runder</span>
              </div>
              <p className="text-slate-600 text-xs mt-1">Opprinnelig: {participant.loops_completed} runder</p>
            </div>

            <button onClick={handleSaveStatus} disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors">
              {busy ? 'Lagrer...' : '✓ Lagre status'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Hoveddashboard ───────────────────────────────────────────────────────────

export default function ParticipantEditor() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Participant | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('bib')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', bib_number: '', chip_id_1: '', chip_id_2: '', gender: '', age: '' })
  const [addBusy, setAddBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([
        getRace(raceId),
        getParticipants(raceId)
      ])
      setRace(r); setParticipants(ps)
      // Oppdater valgt deltaker hvis åpen
      if (selected) {
        const updated = ps.find(p => p.id === selected.id)
        if (updated) setSelected(updated)
      }
    } finally { setLoading(false) }
  }, [raceId, selected?.id])

  useEffect(() => { load() }, [raceId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setAddBusy(true)
    try {
      await addParticipant(raceId, {
        first_name: addForm.first_name,
        last_name: addForm.last_name || undefined,
        bib_number: parseInt(addForm.bib_number),
        chip_id_1: addForm.chip_id_1 || undefined,
        chip_id_2: addForm.chip_id_2 || undefined,
        gender: addForm.gender || undefined,
        age: addForm.age ? parseInt(addForm.age) : undefined,
      })
      setAddForm({ first_name: '', last_name: '', bib_number: '', chip_id_1: '', chip_id_2: '', gender: '', age: '' })
      setShowAddForm(false); load()
    } finally { setAddBusy(false) }
  }

  // Filtrer og sorter
  const filtered = participants
    .filter(p => {
      if (filter === 'active') return p.status === 'active_running'
      if (filter === 'goal') return p.status === 'active_resting'
      if (filter === 'out') return !['active_running', 'active_resting'].includes(p.status)
      return true
    })
    .filter(p => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        fullName(p).toLowerCase().includes(q) ||
        p.bib_number.toString().includes(q) ||
        (p.chip_id_1 || '').toLowerCase().includes(q) ||
        (p.chip_id_2 || '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === 'bib') return a.bib_number - b.bib_number
      if (sort === 'name') return fullName(a).localeCompare(fullName(b))
      if (sort === 'loops') return b.loops_completed - a.loops_completed || a.bib_number - b.bib_number
      if (sort === 'status') return a.status.localeCompare(b.status)
      return 0
    })

  const counts = {
    all: participants.length,
    active: participants.filter(p => p.status === 'active_running').length,
    goal: participants.filter(p => p.status === 'active_resting').length,
    out: participants.filter(p => !['active_running', 'active_resting'].includes(p.status)).length,
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">⏱</div><p>Laster...</p></div>
    </div>
  )
  if (!race) return <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">Løp ikke funnet</div>

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Navigasjonsbar */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-white text-sm transition-colors">← Hjem</Link>
            <span className="text-slate-700">|</span>
            <div>
              <h1 className="font-bold text-base leading-tight">{race.name}</h1>
              <p className="text-slate-500 text-xs">Runde {race.current_loop} · {participants.length} deltakere</p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <Link to={`/race/${raceId}`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">🏃 Live</Link>
            <span className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium">✏️ Rediger</span>
            <Link to={`/race/${raceId}/loops`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📋 Runder</Link>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📺 TV</Link>
            <a href={exportCsv(raceId)} download className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">⬇ CSV</a>
          </nav>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">

        {/* Kontrollpanel */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Filtertabs */}
          <div className="flex bg-slate-800 rounded-xl p-1 gap-1">
            {([['all', 'Alle'], ['active', '🏃 Ute'], ['goal', '✅ I mål'], ['out', '🛑 Ute av løp']] as [FilterTab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {label} <span className={`text-xs ml-1 ${filter === key ? 'text-blue-200' : 'text-slate-600'}`}>{counts[key]}</span>
              </button>
            ))}
          </div>

          {/* Søk */}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Søk navn, bib, chip..."
            className="flex-1 min-w-48 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-600" />

          {/* Sortering */}
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
            <option value="bib">Sorter: Startnr</option>
            <option value="loops">Sorter: Runder ↓</option>
            <option value="name">Sorter: Navn</option>
            <option value="status">Sorter: Status</option>
          </select>

          <button onClick={() => setShowAddForm(!showAddForm)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            + Deltaker
          </button>
        </div>

        {/* Legg til deltaker-form */}
        {showAddForm && (
          <form onSubmit={handleAdd} className="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-4 space-y-3">
            <h3 className="font-semibold text-sm text-slate-300">Ny deltaker</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['Fornavn *', 'first_name', true], ['Etternavn', 'last_name', false], ['Startnr *', 'bib_number', true], ['Chip ID', 'chip_id_1', false]].map(([label, key, req]) => (
                <div key={key as string}>
                  <label className="block text-xs text-slate-500 mb-1">{label}</label>
                  <input required={req as boolean} value={(addForm as Record<string, string>)[key as string]}
                    onChange={e => setAddForm({ ...addForm, [key as string]: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={addBusy} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-semibold">{addBusy ? 'Legger til...' : '+ Legg til'}</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-xl text-sm">Avbryt</button>
            </div>
          </form>
        )}

        {/* Deltakertabell */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-600">
            <p className="text-3xl mb-3">🔍</p>
            <p>Ingen deltakere matcher søket</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Kolonneheader */}
            <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-slate-600 uppercase tracking-wider px-4 pb-1">
              <span className="col-span-1">Bib</span>
              <span className="col-span-3">Navn</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-1 text-center">Runder</span>
              <span className="col-span-1 text-center">km</span>
              <span className="col-span-2">Siste runde</span>
              <span className="col-span-2">Chip</span>
            </div>

            {filtered.map(p => {
              const lastSplit = p.splits.length > 0 ? [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0] : null
              return (
                <button key={p.id} onClick={() => setSelected(p)}
                  className={`w-full text-left rounded-xl border p-3 transition-all hover:border-blue-600/50 hover:bg-slate-800 ${
                    selected?.id === p.id ? 'border-blue-600 bg-slate-800' : 'border-slate-800 bg-slate-900'
                  }`}>
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-1">
                      <span className="bg-slate-700 text-white text-xs font-bold px-2 py-1 rounded-lg">#{p.bib_number}</span>
                    </div>
                    <div className="col-span-3">
                      <p className="font-semibold text-sm">{fullName(p)}</p>
                      {p.gender && <p className="text-slate-600 text-xs">{p.gender}{p.age ? `, ${p.age}` : ''}</p>}
                    </div>
                    <div className="col-span-2">
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="text-white font-bold text-sm">{p.loops_completed}</span>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="text-slate-400 text-sm">{p.total_km.toFixed(1)}</span>
                    </div>
                    <div className="col-span-2">
                      {lastSplit ? (
                        <div>
                          <p className="text-slate-300 text-xs font-mono">{fmtTime(lastSplit.finish_time_utc)}</p>
                          <p className="text-slate-600 text-xs">{lastSplit.loop_duration_secs ? formatDuration(lastSplit.loop_duration_secs) : ''}</p>
                        </div>
                      ) : <span className="text-slate-700 text-xs">–</span>}
                    </div>
                    <div className="col-span-2">
                      <p className="text-slate-600 text-xs font-mono truncate">{p.chip_id_1 || '–'}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Deltakerprofil sidebar */}
      {selected && (
        <ParticipantProfile
          race={race}
          participant={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  )
}
