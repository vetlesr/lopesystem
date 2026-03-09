import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getRace, getParticipants, addParticipant,
  startRace, nextLap, finishRace, registerLap,
  updateParticipant, removeParticipant,
} from '../api'
import type { Race, Participant } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'

function formatDuration(seconds: number | null): string {
  if (!seconds) return '–'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function CountdownTimer({ lapStartTime, lapMinutes }: { lapStartTime: string | null, lapMinutes: number }) {
  const [remaining, setRemaining] = useState<number>(0)

  useEffect(() => {
    if (!lapStartTime) return
    const interval = setInterval(() => {
      const start = new Date(lapStartTime + 'Z').getTime()
      const deadline = start + lapMinutes * 60 * 1000
      const now = Date.now()
      const diff = Math.max(0, Math.floor((deadline - now) / 1000))
      setRemaining(diff)
    }, 1000)
    return () => clearInterval(interval)
  }, [lapStartTime, lapMinutes])

  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  const isUrgent = remaining < 300 // siste 5 minutter

  return (
    <div className={`text-4xl font-mono font-bold ${isUrgent ? 'text-red-400 animate-pulse' : 'text-green-400'}`}>
      {m}:{s.toString().padStart(2, '0')}
    </div>
  )
}

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
  const [notification, setNotification] = useState<string | null>(null)

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const loadAll = useCallback(async () => {
    const [r, p] = await Promise.all([getRace(id), getParticipants(id)])
    setRace(r)
    setParticipants(p)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // WebSocket for live-oppdateringer
  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { event: string; participant_name?: string; lap_number?: number; lap?: number }
    if (msg.event === 'lap_registered') {
      showNotif(`✅ ${msg.participant_name} fullførte runde ${msg.lap_number}!`)
      loadAll()
    } else if (msg.event === 'new_lap' || msg.event === 'race_started') {
      loadAll()
    } else if (msg.event === 'participant_updated') {
      loadAll()
    }
  }, [loadAll])

  useWebSocket(id, handleWsMessage)

  const handleStart = async () => {
    if (!confirm('Start løpet?')) return
    await startRace(id)
    loadAll()
  }

  const handleNextLap = async () => {
    if (!confirm(`Start runde ${(race?.current_lap ?? 0) + 1}?`)) return
    await nextLap(id)
    loadAll()
  }

  const handleFinish = async () => {
    if (!confirm('Avslutt løpet?')) return
    await finishRace(id)
    loadAll()
  }

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault()
    await addParticipant(id, { name: newName, bib_number: Number(newBib), rfid_tag: newTag || undefined })
    setNewName(''); setNewBib(''); setNewTag('')
    setShowAddForm(false)
    loadAll()
  }

  const handleLap = async (participantId: number) => {
    await registerLap(id, participantId)
    loadAll()
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

  // Sorter: aktive øverst (etter runder), deretter RTC, DNF, DNS
  const sorted = [...participants].sort((a, b) => {
    const order = { active: 0, finished: 0, rtc: 1, dnf: 2, dns: 3 }
    const oa = order[a.status] ?? 9
    const ob = order[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return b.laps_completed - a.laps_completed
  })

  const activeCount = participants.filter(p => p.status === 'active').length

  if (!race) return <div className="p-8 text-slate-400">Laster...</div>

  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* Notifikasjon */}
      {notification && (
        <div className="fixed top-4 right-4 bg-green-700 text-white px-5 py-3 rounded-xl shadow-lg z-50 text-sm font-medium">
          {notification}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">← Tilbake</button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{race.name}</h1>
          <p className="text-slate-400 text-sm">
            {race.location && `📍 ${race.location} · `}
            🔄 Backyard Ultra · {race.lap_distance_km} km per runde
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
            : <p className="text-slate-500 mt-1">–</p>
          }
        </div>
      </div>

      {/* Kontrollknapper */}
      <div className="flex flex-wrap gap-3 mb-6">
        {!race.is_active && !race.is_finished && (
          <button onClick={handleStart} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
            🚀 Start løpet
          </button>
        )}
        {race.is_active && (
          <>
            <button onClick={handleNextLap} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
              ⏭ Neste runde
            </button>
            <button onClick={handleFinish} className="bg-red-700 hover:bg-red-800 text-white px-5 py-2 rounded-lg font-semibold transition-colors">
              🏁 Avslutt løp
            </button>
          </>
        )}
        {!race.is_active && (
          <button onClick={() => setShowAddForm(!showAddForm)} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-lg transition-colors">
            + Legg til deltaker
          </button>
        )}
      </div>

      {/* Legg til deltaker-form */}
      {showAddForm && (
        <form onSubmit={handleAddParticipant} className="bg-slate-800 rounded-xl p-5 mb-5 border border-slate-700">
          <h3 className="font-semibold mb-3">Legg til deltaker</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Navn" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
            <input required type="number" value={newBib} onChange={e => setNewBib(e.target.value)}
              placeholder="Startnummer" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
            <input value={newTag} onChange={e => setNewTag(e.target.value)}
              placeholder="RFID-tag EPC (valgfritt)" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex gap-3 mt-3">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">Legg til</button>
            <button type="button" onClick={() => setShowAddForm(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors">Avbryt</button>
          </div>
        </form>
      )}

      {/* Deltakertabell */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
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
                  <th className="px-4 py-3 text-center">Siste rundetid</th>
                  <th className="px-4 py-3 text-center">RFID</th>
                  <th className="px-4 py-3 text-center">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const lastLap = p.laps.length > 0 ? p.laps[p.laps.length - 1] : null
                  return (
                    <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-300">{p.bib_number}</td>
                      <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs border ${STATUS_COLORS[p.status]}`}>
                          {STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-lg text-white">{p.laps_completed}</td>
                      <td className="px-4 py-3 text-center text-slate-300 font-mono">
                        {formatDuration(lastLap?.lap_duration_seconds ?? null)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.rfid_tag
                          ? <span className="text-green-400 text-xs font-mono">📡 {p.rfid_tag.slice(-6)}</span>
                          : <span className="text-slate-600 text-xs">–</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {race.is_active && p.status === 'active' && (
                            <button onClick={() => handleLap(p.id)}
                              className="bg-green-700 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors">
                              ✓ Runde
                            </button>
                          )}
                          {race.is_active && p.status === 'active' && (
                            <>
                              <button onClick={() => handleStatusChange(p.id, 'rtc')}
                                className="bg-yellow-800 hover:bg-yellow-700 text-yellow-200 text-xs px-2 py-1 rounded transition-colors">
                                RTC
                              </button>
                              <button onClick={() => handleStatusChange(p.id, 'finished')}
                                className="bg-blue-800 hover:bg-blue-700 text-blue-200 text-xs px-2 py-1 rounded transition-colors">
                                🏆
                              </button>
                            </>
                          )}
                          {!race.is_active && (
                            <button onClick={() => handleRemove(p.id, p.name)}
                              className="text-slate-500 hover:text-red-400 text-xs px-2 py-1 rounded transition-colors">
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
    </div>
  )
}
