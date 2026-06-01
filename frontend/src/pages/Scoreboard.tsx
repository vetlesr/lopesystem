import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRace, getParticipants, fullName, formatDuration } from '../api'
import type { Race, Participant, RunnerStatus } from '../api'

const STATUS_LABEL: Record<RunnerStatus, string> = {
  active_running: '🏃',
  active_resting: '✅',
  rtc: '🛑 RTC',
  dnc: '❌ DNC',
  over: '⏰',
  dns: 'DNS',
  dsq: 'DSQ',
  winner: '🏆',
}

const STATUS_COLOR: Record<RunnerStatus, string> = {
  active_running: 'text-green-400',
  active_resting: 'text-blue-300',
  rtc: 'text-orange-400',
  dnc: 'text-red-400',
  over: 'text-yellow-400',
  dns: 'text-slate-600',
  dsq: 'text-red-600',
  winner: 'text-yellow-300',
}

function useCountdown(race: Race | null) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (!race?.is_active || !race.loop_start_utc) return
    const tick = () => {
      const start = new Date(race.loop_start_utc! + 'Z').getTime()
      const totalMs = race.loop_duration_minutes * 60 * 1000
      setRemaining(Math.max(0, Math.floor((totalMs - (Date.now() - start)) / 1000)))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [race?.loop_start_utc, race?.loop_duration_minutes, race?.is_active])
  return remaining
}

function fmtCd(secs: number) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function Scoreboard() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const remaining = useCountdown(race)
  const isUrgent = remaining < 120 && remaining > 0 && race?.is_active

  const load = useCallback(async () => {
    const [r, ps] = await Promise.all([getRace(raceId), getParticipants(raceId)])
    setRace(r); setParticipants(ps)
  }, [raceId])

  useEffect(() => { load() }, [load])

  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/races/${raceId}`)
    wsRef.current = ws
    ws.onmessage = () => load()
    return () => ws.close()
  }, [raceId, load])

  const sorted = [...participants].sort((a, b) => {
    // Vinner øverst
    if (a.status === 'winner') return -1
    if (b.status === 'winner') return 1
    // Aktive over utgåtte
    const aActive = ['active_running', 'active_resting'].includes(a.status)
    const bActive = ['active_running', 'active_resting'].includes(b.status)
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    // Sorter etter runder
    return b.loops_completed - a.loops_completed || a.bib_number - b.bib_number
  })

  const activeCount = participants.filter(p => ['active_running', 'active_resting'].includes(p.status)).length
  const inGoal = participants.filter(p => p.status === 'active_resting').length

  if (!race) return <div className="flex items-center justify-center h-screen bg-black text-slate-400 text-2xl">Laster...</div>

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{race.name}</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {race.location && `📍 ${race.location} · `}
              {race.loop_distance_km} km per runde
            </p>
          </div>

          <div className="text-center">
            {race.is_active ? (
              <>
                <div className={`text-6xl font-bold tracking-widest ${isUrgent ? 'text-red-400 animate-pulse' : 'text-green-400'}`}>
                  {fmtCd(remaining)}
                </div>
                <p className="text-slate-400 text-sm mt-1">Runde {race.current_loop} · {isUrgent ? '⚠️ Snart slutt!' : 'Tid igjen'}</p>
              </>
            ) : race.is_finished ? (
              <div className="text-4xl font-bold text-slate-400">🏁 FERDIG</div>
            ) : (
              <div className="text-3xl font-bold text-slate-500">⏳ IKKE STARTET</div>
            )}
          </div>

          <div className="text-right">
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-4xl font-bold text-green-400">{activeCount}</p>
                <p className="text-slate-500 text-xs uppercase tracking-wide">Aktive</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-blue-400">{inGoal}</p>
                <p className="text-slate-500 text-xs uppercase tracking-wide">I mål</p>
              </div>
            </div>
            <Link to={`/race/${raceId}`} className="text-slate-600 hover:text-slate-400 text-xs mt-2 inline-block">← Admin</Link>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <table className="w-full">
          <thead>
            <tr className="text-slate-500 text-xs uppercase tracking-wider border-b border-slate-800">
              <th className="text-left py-2 w-12">#</th>
              <th className="text-left py-2 w-16">Bib</th>
              <th className="text-left py-2">Navn</th>
              <th className="text-center py-2 w-20">Runder</th>
              <th className="text-center py-2 w-20">Km</th>
              <th className="text-center py-2 w-28">Status</th>
              <th className="text-right py-2 w-32">Siste runde</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, idx) => {
              const lastSplit = [...p.splits].sort((a, b) => b.loop_number - a.loop_number)[0]
              const isActive = ['active_running', 'active_resting'].includes(p.status)
              return (
                <tr key={p.id}
                  className={`border-b border-slate-900 transition-colors ${
                    p.status === 'winner' ? 'bg-yellow-900/20' :
                    isActive ? 'bg-slate-900/50' : 'opacity-50'
                  }`}>
                  <td className="py-3 text-slate-500 text-lg">{idx + 1}</td>
                  <td className="py-3">
                    <span className="bg-slate-800 text-slate-300 text-sm font-bold px-2 py-0.5 rounded">
                      #{p.bib_number}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={`text-xl font-semibold ${p.status === 'winner' ? 'text-yellow-300' : isActive ? 'text-white' : 'text-slate-400'}`}>
                      {fullName(p)}
                    </span>
                    {p.gender && <span className="text-slate-600 text-sm ml-2">{p.gender}</span>}
                  </td>
                  <td className="py-3 text-center">
                    <span className={`text-3xl font-bold ${isActive ? 'text-white' : 'text-slate-500'}`}>
                      {p.loops_completed}
                    </span>
                  </td>
                  <td className="py-3 text-center text-slate-400 text-sm">
                    {p.total_km.toFixed(1)}
                  </td>
                  <td className="py-3 text-center">
                    <span className={`text-lg font-semibold ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="py-3 text-right text-slate-500 text-sm">
                    {lastSplit ? (
                      <>
                        <span className="text-slate-300">{new Date(lastSplit.finish_time_utc + 'Z').toLocaleTimeString('no-NO')}</span>
                        {lastSplit.loop_duration_secs && (
                          <span className="text-slate-600 ml-1 text-xs">({formatDuration(lastSplit.loop_duration_secs)})</span>
                        )}
                      </>
                    ) : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <div className="text-center py-20 text-slate-600 text-xl">Ingen deltakere ennå</div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/80 border-t border-slate-800 px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-slate-600 text-xs">
          <span>Løpesystem · Backyard Ultra Timing</span>
          <span>{new Date().toLocaleTimeString('no-NO')}</span>
        </div>
      </div>
    </div>
  )
}
