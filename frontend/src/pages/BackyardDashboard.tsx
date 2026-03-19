import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getRace, getParticipants, addParticipant,
  startRace, nextLap, finishRace, registerLap,
  updateParticipant, removeParticipant,
  finishParticipant, getLastLap, editLap, deleteLap,
} from '../api'
// getParticipants is used inside LapsModal via closure
import type { Race, Participant, Lap } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '–'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function toLocalInputValue(isoUtc: string): string {
  // Konverter UTC ISO-streng til lokal datetime-local input-verdi
  const d = new Date(isoUtc + (isoUtc.endsWith('Z') ? '' : 'Z'))
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function toUtcIso(localValue: string): string {
  return new Date(localValue).toISOString()
}

// ─── Nedtellingstimer ─────────────────────────────────────────────────────────

function CountdownTimer({ lapStartTime, lapMinutes }: { lapStartTime: string | null; lapMinutes: number }) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!lapStartTime) return
    const tick = () => {
      const start = new Date(lapStartTime + 'Z').getTime()
      const deadline = start + lapMinutes * 60 * 1000
      setRemaining(Math.max(0, Math.floor((deadline - Date.now()) / 1000)))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [lapStartTime, lapMinutes])

  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const isUrgent = remaining < 300

  return (
    <div className={`text-4xl font-mono font-bold ${isUrgent ? 'text-red-400 animate-pulse' : 'text-green-400'}`}>
      {h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`}
    </div>
  )
}

// ─── Status-konstanter ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900 text-green-200 border-green-700',
  finished: 'bg-blue-900 text-blue-200 border-blue-700',
  rtc: 'bg-yellow-900 text-yellow-200 border-yellow-700',
  dnf: 'bg-red-900 text-red-200 border-red-700',
  dns: 'bg-slate-700 text-slate-400 border-slate-600',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  finished: 'Vinner 🏆',
  rtc: 'RTC',
  dnf: 'DNF',
  dns: 'DNS',
}

// ─── Modal: Fullfør løper ─────────────────────────────────────────────────────

function FinishModal({
  participant,
  raceId,
  onClose,
  onDone,
}: {
  participant: Participant
  raceId: number
  onClose: () => void
  onDone: () => void
}) {
  const [lastLap, setLastLap] = useState(participant.laps_completed)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLastLap(raceId, participant.id).then(data => {
      setLastLap(data.last_lap_number || participant.laps_completed)
      setLoading(false)
    })
  }, [raceId, participant.id, participant.laps_completed])

  const handleConfirm = async () => {
    await finishParticipant(raceId, participant.id, lastLap)
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-600 shadow-2xl">
        <h2 className="text-xl font-bold mb-1">Fullfør løper</h2>
        <p className="text-slate-400 text-sm mb-5">{participant.name} (#{participant.bib_number})</p>

        {loading ? (
          <p className="text-slate-400 text-sm">Henter siste runde...</p>
        ) : (
          <>
            <label className="block text-sm text-slate-400 mb-1">
              Siste fullførte runde (forslag basert på registreringer)
            </label>
            <div className="flex items-center gap-3 mb-5">
              <button onClick={() => setLastLap(Math.max(0, lastLap - 1))}
                className="bg-slate-700 hover:bg-slate-600 text-white w-10 h-10 rounded-lg text-xl font-bold transition-colors">
                −
              </button>
              <span className="text-3xl font-bold text-white w-16 text-center">{lastLap}</span>
              <button onClick={() => setLastLap(lastLap + 1)}
                className="bg-slate-700 hover:bg-slate-600 text-white w-10 h-10 rounded-lg text-xl font-bold transition-colors">
                +
              </button>
            </div>
            <p className="text-slate-500 text-xs mb-5">
              Løperen settes til RTC (Refuse To Continue) med {lastLap} fullførte runder.
            </p>
          </>
        )}

        <div className="flex gap-3">
          <button onClick={handleConfirm}
            className="flex-1 bg-yellow-700 hover:bg-yellow-600 text-white py-2 rounded-lg font-semibold transition-colors">
            Bekreft RTC
          </button>
          <button onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg transition-colors">
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Rediger runder ────────────────────────────────────────────────────

function LapsModal({
  participant,
  raceId,
  onClose,
  onDone,
}: {
  participant: Participant
  raceId: number
  onClose: () => void
  onDone: () => void
}) {
  const [laps, setLaps] = useState<Lap[]>(participant.laps)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const handleEdit = (lap: Lap) => {
    setEditingId(lap.id)
    setEditValue(toLocalInputValue(lap.finish_time))
  }

  const handleSave = async (lapId: number) => {
    await editLap(raceId, participant.id, lapId, toUtcIso(editValue))
    setEditingId(null)
    onDone()
    // Refresh laps
    const updated = await getParticipants(raceId)
    const p = updated.find(x => x.id === participant.id)
    if (p) setLaps(p.laps)
  }

  const handleDelete = async (lapId: number, lapNum: number) => {
    if (!confirm(`Slett runde ${lapNum}?`)) return
    await deleteLap(raceId, participant.id, lapId)
    setLaps(laps.filter(l => l.id !== lapId))
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-lg border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Runder</h2>
            <p className="text-slate-400 text-sm">{participant.name} (#{participant.bib_number})</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {laps.length === 0 ? (
          <p className="text-slate-500 text-center py-6">Ingen runder registrert</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {laps.map(lap => (
              <div key={lap.id} className="bg-slate-700 rounded-lg px-4 py-3 flex items-center gap-3">
                <span className="text-slate-400 text-sm w-16">Runde {lap.lap_number}</span>

                {editingId === lap.id ? (
                  <>
                    <input
                      type="datetime-local"
                      step="1"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="flex-1 bg-slate-600 border border-blue-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                    />
                    <button onClick={() => handleSave(lap.id)}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded transition-colors">
                      Lagre
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded transition-colors">
                      Avbryt
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-white text-sm font-mono">
                      {new Date(lap.finish_time + 'Z').toLocaleTimeString('no-NO')}
                      <span className="text-slate-400 ml-2 text-xs">({formatDuration(lap.lap_duration_seconds)})</span>
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${lap.recorded_by === 'rfid' ? 'bg-blue-900 text-blue-300' : 'bg-slate-600 text-slate-300'}`}>
                      {lap.recorded_by === 'rfid' ? '📡 RFID' : '✋ Manuell'}
                    </span>
                    <button onClick={() => handleEdit(lap)}
                      className="text-slate-400 hover:text-blue-400 text-xs transition-colors">
                      ✏️
                    </button>
                    <button onClick={() => handleDelete(lap.id, lap.lap_number)}
                      className="text-slate-400 hover:text-red-400 text-xs transition-colors">
                      🗑️
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose}
          className="mt-4 w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg transition-colors">
          Lukk
        </button>
      </div>
    </div>
  )
}

// ─── Modal: Manuell runderegistrering med tidspunkt ───────────────────────────

function ManualLapModal({
  participant,
  raceId,
  onClose,
  onDone,
}: {
  participant: Participant
  raceId: number
  onClose: () => void
  onDone: () => void
}) {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const defaultTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const [time, setTime] = useState(defaultTime)

  const handleConfirm = async () => {
    await registerLap(raceId, participant.id, toUtcIso(time))
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm border border-slate-600 shadow-2xl">
        <h2 className="text-xl font-bold mb-1">Registrer runde</h2>
        <p className="text-slate-400 text-sm mb-5">{participant.name} (#{participant.bib_number})</p>

        <label className="block text-sm text-slate-400 mb-1">Tidspunkt for målpassering</label>
        <input
          type="datetime-local"
          step="1"
          value={time}
          onChange={e => setTime(e.target.value)}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 mb-5"
        />

        <div className="flex gap-3">
          <button onClick={handleConfirm}
            className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2 rounded-lg font-semibold transition-colors">
            ✓ Registrer
          </button>
          <button onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg transition-colors">
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Hoveddashboard ───────────────────────────────────────────────────────────

export default function BackyardDashboard() {
  const { raceId } = useParams<{ raceId: string }>()
  const navigate = useNavigate()
  const id = Number(raceId)

  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [newName, setNewName] = useState('')
  const [newBib, setNewBib] = useState('')
  const [newTag, setNewTag] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'info' | 'warn' } | null>(null)

  // Modaler
  const [finishModal, setFinishModal] = useState<Participant | null>(null)
  const [lapsModal, setLapsModal] = useState<Participant | null>(null)
  const [manualLapModal, setManualLapModal] = useState<Participant | null>(null)

  const showNotif = (msg: string, type: 'success' | 'info' | 'warn' = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const loadAll = useCallback(async () => {
    const [r, p] = await Promise.all([getRace(id), getParticipants(id)])
    setRace(r)
    setParticipants(p)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { event: string; participant_name?: string; lap_number?: number; auto?: boolean }
    if (msg.event === 'lap_registered') {
      showNotif(`✅ ${msg.participant_name} – runde ${msg.lap_number} registrert!`)
      loadAll()
    } else if (msg.event === 'new_lap') {
      showNotif(msg.auto ? `⏰ Automatisk start: runde ${msg.lap_number}` : `▶️ Runde ${msg.lap_number} startet`, 'info')
      loadAll()
    } else if (msg.event === 'race_started') {
      showNotif('🚀 Løpet er i gang!', 'info')
      loadAll()
    } else {
      loadAll()
    }
  }, [loadAll])

  useWebSocket(id, handleWsMessage)

  const handleStart = async () => {
    if (!confirm('Start løpet? Alle deltakere settes til aktive og nedtellingen begynner.')) return
    await startRace(id)
    loadAll()
  }

  const handleNextLap = async () => {
    if (!confirm(`Start runde ${(race?.current_lap ?? 0) + 1} manuelt? Løpere som ikke har fullført runde ${race?.current_lap} settes til DNF.`)) return
    await nextLap(id)
    loadAll()
  }

  const handleFinishRace = async () => {
    if (!confirm('Avslutt løpet?')) return
    await finishRace(id)
    loadAll()
  }

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addParticipant(id, { name: newName, bib_number: Number(newBib), rfid_tag: newTag || undefined })
      setNewName(''); setNewBib(''); setNewTag('')
      setShowAddForm(false)
      loadAll()
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      showNotif(`❌ ${error?.response?.data?.detail || 'Feil ved registrering'}`, 'warn')
    }
  }

  const handleStatusChange = async (participantId: number, status: string) => {
    await updateParticipant(id, participantId, { status: status as Participant['status'] })
    loadAll()
  }

  const handleRemove = async (participantId: number, name: string) => {
    if (!confirm(`Fjern ${name}?`)) return
    await removeParticipant(id, participantId)
    loadAll()
  }

  const sorted = [...participants].sort((a, b) => {
    const order: Record<string, number> = { active: 0, finished: 0, rtc: 1, dnf: 2, dns: 3 }
    const oa = order[a.status] ?? 9
    const ob = order[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return b.laps_completed - a.laps_completed
  })

  const activeCount = participants.filter(p => p.status === 'active').length

  const notifColors = {
    success: 'bg-green-700',
    info: 'bg-blue-700',
    warn: 'bg-yellow-700',
  }

  if (!race) return <div className="p-8 text-slate-400">Laster...</div>

  return (
    <div className="max-w-6xl mx-auto p-4">

      {/* Notifikasjon */}
      {notification && (
        <div className={`fixed top-4 right-4 ${notifColors[notification.type]} text-white px-5 py-3 rounded-xl shadow-lg z-50 text-sm font-medium max-w-sm`}>
          {notification.msg}
        </div>
      )}

      {/* Modaler */}
      {finishModal && (
        <FinishModal
          participant={finishModal}
          raceId={id}
          onClose={() => setFinishModal(null)}
          onDone={loadAll}
        />
      )}
      {lapsModal && (
        <LapsModal
          participant={lapsModal}
          raceId={id}
          onClose={() => setLapsModal(null)}
          onDone={loadAll}
        />
      )}
      {manualLapModal && (
        <ManualLapModal
          participant={manualLapModal}
          raceId={id}
          onClose={() => setManualLapModal(null)}
          onDone={loadAll}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors text-sm">
          ← Tilbake
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{race.name}</h1>
          <p className="text-slate-400 text-sm">
            {race.location && `📍 ${race.location} · `}
            🔄 Backyard Ultra · {race.lap_distance_km} km · {race.rfid_cooldown_seconds}s RFID-cooldown
          </p>
        </div>
      </div>

      {/* Status-panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Status</p>
          <p className="text-lg font-bold mt-1">
            {race.is_finished ? '🏁 Ferdig' : race.is_active ? '🟢 Pågår' : '⏳ Venter'}
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Runde</p>
          <p className="text-3xl font-bold mt-1 text-white">{race.current_lap}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Aktive løpere</p>
          <p className="text-3xl font-bold mt-1 text-green-400">{activeCount}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Tid igjen</p>
          {race.is_active
            ? <CountdownTimer lapStartTime={race.lap_start_time} lapMinutes={race.lap_time_minutes} />
            : <p className="text-slate-500 mt-1 text-lg">–</p>
          }
        </div>
      </div>

      {/* Kontrollknapper */}
      <div className="flex flex-wrap gap-3 mb-6">
        {!race.is_active && !race.is_finished && (
          <button onClick={handleStart}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
            🚀 Start løpet
          </button>
        )}
        {race.is_active && (
          <>
            <button onClick={handleNextLap}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
              ⏭ Neste runde (manuelt)
            </button>
            <button onClick={handleFinishRace}
              className="bg-red-700 hover:bg-red-800 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
              🏁 Avslutt løp
            </button>
          </>
        )}
        <button onClick={() => setShowAddForm(!showAddForm)}
          className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-lg transition-colors">
          + Legg til deltaker
        </button>
      </div>

      {/* Legg til deltaker-form */}
      {showAddForm && (
        <form onSubmit={handleAddParticipant} className="bg-slate-800 rounded-xl p-5 mb-5 border border-slate-700">
          <h3 className="font-semibold mb-3">Legg til deltaker</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Navn"
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
            <input required type="number" value={newBib} onChange={e => setNewBib(e.target.value)}
              placeholder="Startnummer"
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
            <input value={newTag} onChange={e => setNewTag(e.target.value)}
              placeholder="RFID-tag EPC (valgfritt)"
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex gap-3 mt-3">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
              Legg til
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors">
              Avbryt
            </button>
          </div>
        </form>
      )}

      {/* Deltakertabell */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700">
          <h2 className="font-semibold">Deltakere ({participants.length})</h2>
        </div>
        {participants.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Ingen deltakere ennå</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Navn</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Runder</th>
                  <th className="px-4 py-3 text-center">Siste tid</th>
                  <th className="px-4 py-3 text-center">RFID</th>
                  <th className="px-4 py-3 text-center">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const lastLap = p.laps.length > 0 ? p.laps[p.laps.length - 1] : null
                  const hasCurrentLap = p.laps.some(l => l.lap_number === race.current_lap)

                  return (
                    <tr key={p.id} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${hasCurrentLap && race.is_active ? 'bg-green-900/10' : ''}`}>
                      <td className="px-4 py-3 font-mono text-slate-300">{p.bib_number}</td>
                      <td className="px-4 py-3 font-medium text-white">
                        {p.name}
                        {hasCurrentLap && race.is_active && (
                          <span className="ml-2 text-green-400 text-xs">✓</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs border ${STATUS_COLORS[p.status]}`}>
                          {STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setLapsModal(p)}
                          className="text-xl font-bold text-white hover:text-blue-400 transition-colors"
                          title="Klikk for å se/redigere runder"
                        >
                          {p.laps_completed}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-300 font-mono text-xs">
                        {lastLap ? (
                          <span title={new Date(lastLap.finish_time + 'Z').toLocaleString('no-NO')}>
                            {new Date(lastLap.finish_time + 'Z').toLocaleTimeString('no-NO')}
                            <br />
                            <span className="text-slate-500">{formatDuration(lastLap.lap_duration_seconds)}</span>
                          </span>
                        ) : '–'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.rfid_tag
                          ? <span className="text-green-400 text-xs font-mono">📡 {p.rfid_tag.slice(-6)}</span>
                          : <span className="text-slate-600 text-xs">–</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {/* Manuell runderegistrering */}
                          {race.is_active && p.status === 'active' && !hasCurrentLap && (
                            <button
                              onClick={() => setManualLapModal(p)}
                              className="bg-green-700 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                              title="Registrer runde med tidspunkt"
                            >
                              ✓ Runde
                            </button>
                          )}

                          {/* Fullfør (RTC) */}
                          {race.is_active && p.status === 'active' && (
                            <button
                              onClick={() => setFinishModal(p)}
                              className="bg-yellow-800 hover:bg-yellow-700 text-yellow-200 text-xs px-2 py-1 rounded transition-colors"
                              title="Løper gir seg (RTC)"
                            >
                              Ferdig
                            </button>
                          )}

                          {/* Vinner */}
                          {race.is_active && p.status === 'active' && (
                            <button
                              onClick={() => handleStatusChange(p.id, 'finished')}
                              className="bg-blue-800 hover:bg-blue-700 text-blue-200 text-xs px-2 py-1 rounded transition-colors"
                              title="Sett som vinner"
                            >
                              🏆
                            </button>
                          )}

                          {/* Slett (kun når løpet ikke er aktivt) */}
                          {!race.is_active && (
                            <button
                              onClick={() => handleRemove(p.id, p.name)}
                              className="text-slate-500 hover:text-red-400 text-xs px-2 py-1 rounded transition-colors"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info om automatisk runde */}
      {race.is_active && (
        <p className="text-slate-500 text-xs text-center mt-4">
          ⏰ Neste runde starter automatisk etter {race.lap_time_minutes} minutter · Manuell override: "Neste runde"-knappen
        </p>
      )}
    </div>
  )
}
