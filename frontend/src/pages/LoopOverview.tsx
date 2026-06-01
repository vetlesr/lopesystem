/**
 * LoopOverview – Side 3 av 3 under et aktivt løp
 *
 * Viser alle runder med:
 * - Hvem fullførte runden (i stigende rekkefølge etter tid)
 * - Rundetid, kumulativ tid, rang
 * - Hvem som falt ut i denne runden (DNC)
 * - Statistikk per runde (raskeste, tregeste, snitt)
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRace, getParticipants, exportCsv, fullName, formatDuration } from '../api'
import type { Race, Participant } from '../api'

function fmtTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface LoopResult {
  loopNumber: number
  loopStartUtc: string | null
  finishers: {
    rank: number
    participant: Participant
    finishTime: string
    durationSecs: number | null
    cumulativeSecs: number
    isOverTime: boolean
  }[]
  dnc: Participant[]
  fastestSecs: number | null
  slowestSecs: number | null
  avgSecs: number | null
}

function buildLoopResults(race: Race, participants: Participant[]): LoopResult[] {
  if (race.current_loop === 0) return []

  const results: LoopResult[] = []

  for (let loop = 1; loop <= race.current_loop; loop++) {
    const finishers: LoopResult['finishers'] = []

    for (const p of participants) {
      const split = p.splits.find(s => s.loop_number === loop)
      if (!split) continue

      const cumSecs = p.splits
        .filter(s => s.loop_number <= loop)
        .reduce((acc, s) => acc + (s.loop_duration_secs || 0), 0)

      finishers.push({
        rank: 0, // beregnes under
        participant: p,
        finishTime: split.finish_time_utc,
        durationSecs: split.loop_duration_secs,
        cumulativeSecs: cumSecs,
        isOverTime: split.is_over_time,
      })
    }

    // Sorter etter passeringstid stigende
    finishers.sort((a, b) => new Date(a.finishTime).getTime() - new Date(b.finishTime).getTime())
    finishers.forEach((f, i) => { f.rank = i + 1 })

    const validDurations = finishers.filter(f => f.durationSecs && !f.isOverTime).map(f => f.durationSecs!)
    const fastestSecs = validDurations.length ? Math.min(...validDurations) : null
    const slowestSecs = validDurations.length ? Math.max(...validDurations) : null
    const avgSecs = validDurations.length ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length : null

    // Finn DNC i denne runden (de som ble satt til DNC og hadde siste split i forrige runde eller ingen splits)
    const dnc = participants.filter(p => {
      if (p.status !== 'dnc') return false
      const lastSplit = p.splits.length > 0 ? Math.max(...p.splits.map(s => s.loop_number)) : 0
      return lastSplit === loop - 1
    })

    results.push({
      loopNumber: loop,
      loopStartUtc: null, // ikke lagret per runde ennå
      finishers,
      dnc,
      fastestSecs,
      slowestSecs,
      avgSecs,
    })
  }

  return results.reverse() // Nyeste runde øverst
}

export default function LoopOverview() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLoop, setExpandedLoop] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([getRace(raceId), getParticipants(raceId)])
      setRace(r); setParticipants(ps)
      // Ekspander nåværende runde som standard
      if (r.current_loop > 0 && expandedLoop === null) setExpandedLoop(r.current_loop)
    } finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  // Auto-refresh hvert 30. sekund
  useEffect(() => {
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">⏱</div><p>Laster...</p></div>
    </div>
  )
  if (!race) return <div className="flex items-center justify-center h-screen bg-slate-950 text-red-400">Løp ikke funnet</div>

  const loopResults = buildLoopResults(race, participants)
  const totalActive = participants.filter(p => ['active_running', 'active_resting'].includes(p.status)).length

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
              <p className="text-slate-500 text-xs">Runde {race.current_loop} · {totalActive} aktive løpere</p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <Link to={`/race/${raceId}`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">🏃 Live</Link>
            <Link to={`/race/${raceId}/edit`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">✏️ Rediger</Link>
            <span className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium">📋 Runder</span>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">📺 TV</Link>
            <a href={exportCsv(raceId)} download className="text-slate-400 hover:text-white text-xs px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 transition-colors">⬇ CSV</a>
          </nav>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">

        {/* Løpssammendrag */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-3xl font-black text-white">{race.current_loop}</p>
            <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">Runder gjennomført</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black text-emerald-400">{totalActive}</p>
            <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">Aktive løpere</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black text-slate-400">{participants.length}</p>
            <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">Totalt deltakere</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black text-blue-400">{(race.current_loop * race.loop_distance_km).toFixed(1)}</p>
            <p className="text-slate-600 text-xs uppercase tracking-wider mt-0.5">km ledende</p>
          </div>
        </div>

        {loopResults.length === 0 ? (
          <div className="text-center py-20 text-slate-600">
            <p className="text-4xl mb-3">🏁</p>
            <p className="text-lg">Løpet har ikke startet ennå</p>
            <p className="text-sm mt-1">Runde-oversikten vises her når løpet er i gang</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loopResults.map(loop => {
              const isExpanded = expandedLoop === loop.loopNumber
              const isCurrent = loop.loopNumber === race.current_loop

              return (
                <div key={loop.loopNumber}
                  className={`rounded-2xl border overflow-hidden transition-colors ${
                    isCurrent ? 'border-blue-700/50 bg-blue-950/20' : 'border-slate-800 bg-slate-900'
                  }`}>

                  {/* Runde-header (alltid synlig) */}
                  <button
                    onClick={() => setExpandedLoop(isExpanded ? null : loop.loopNumber)}
                    className="w-full text-left p-4 flex items-center gap-4 hover:bg-white/5 transition-colors">

                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${
                        isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {loop.loopNumber}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">Runde {loop.loopNumber}</span>
                          {isCurrent && <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700/30 animate-pulse">Pågår</span>}
                        </div>
                        <p className="text-slate-500 text-xs">
                          {loop.finishers.length} fullførte
                          {loop.dnc.length > 0 && ` · ${loop.dnc.length} DNC`}
                          {loop.avgSecs && ` · Snitt: ${formatDuration(loop.avgSecs)}`}
                        </p>
                      </div>
                    </div>

                    {/* Statistikk-chips */}
                    <div className="hidden md:flex items-center gap-3">
                      {loop.fastestSecs && (
                        <div className="text-center">
                          <p className="text-emerald-400 font-mono text-sm font-bold">{formatDuration(loop.fastestSecs)}</p>
                          <p className="text-slate-600 text-xs">Raskest</p>
                        </div>
                      )}
                      {loop.avgSecs && (
                        <div className="text-center">
                          <p className="text-blue-400 font-mono text-sm font-bold">{formatDuration(loop.avgSecs)}</p>
                          <p className="text-slate-600 text-xs">Snitt</p>
                        </div>
                      )}
                      {loop.slowestSecs && loop.finishers.length > 1 && (
                        <div className="text-center">
                          <p className="text-red-400 font-mono text-sm font-bold">{formatDuration(loop.slowestSecs)}</p>
                          <p className="text-slate-600 text-xs">Tregeste</p>
                        </div>
                      )}
                    </div>

                    <span className={`text-slate-600 text-sm ml-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </button>

                  {/* Ekspandert innhold */}
                  {isExpanded && (
                    <div className="border-t border-slate-800">

                      {loop.finishers.length > 0 ? (
                        <div>
                          {/* Kolonneheader */}
                          <div className="grid grid-cols-12 gap-2 text-xs text-slate-600 uppercase tracking-wider px-4 py-2 bg-slate-950/30">
                            <span className="col-span-1">Rang</span>
                            <span className="col-span-1">Bib</span>
                            <span className="col-span-3">Navn</span>
                            <span className="col-span-2">Passeringstid</span>
                            <span className="col-span-2">Rundetid</span>
                            <span className="col-span-2">Kumulativ</span>
                            <span className="col-span-1">Kilde</span>
                          </div>

                          {loop.finishers.map((f, idx) => {
                            const isFastest = f.durationSecs === loop.fastestSecs && loop.fastestSecs !== null
                            const isSlowest = f.durationSecs === loop.slowestSecs && loop.slowestSecs !== null && loop.finishers.length > 1

                            return (
                              <div key={f.participant.id}
                                className={`grid grid-cols-12 gap-2 items-center px-4 py-2.5 text-sm border-t border-slate-800/50 ${
                                  f.isOverTime ? 'bg-yellow-950/10' :
                                  idx === 0 ? 'bg-emerald-950/10' : ''
                                }`}>
                                <div className="col-span-1">
                                  <span className={`font-bold text-sm ${
                                    f.rank === 1 ? 'text-yellow-400' :
                                    f.rank === 2 ? 'text-slate-300' :
                                    f.rank === 3 ? 'text-orange-400' :
                                    'text-slate-600'
                                  }`}>
                                    {f.rank === 1 ? '🥇' : f.rank === 2 ? '🥈' : f.rank === 3 ? '🥉' : `#${f.rank}`}
                                  </span>
                                </div>
                                <div className="col-span-1">
                                  <span className="bg-slate-800 text-slate-300 text-xs font-bold px-1.5 py-0.5 rounded">#{f.participant.bib_number}</span>
                                </div>
                                <div className="col-span-3">
                                  <p className="font-medium text-white">{fullName(f.participant)}</p>
                                  {f.participant.gender && <p className="text-slate-600 text-xs">{f.participant.gender}</p>}
                                </div>
                                <div className="col-span-2">
                                  <p className="font-mono text-white text-xs">{fmtTime(f.finishTime)}</p>
                                </div>
                                <div className="col-span-2">
                                  <p className={`font-mono text-sm font-semibold ${
                                    f.isOverTime ? 'text-yellow-400' :
                                    isFastest ? 'text-emerald-400' :
                                    isSlowest ? 'text-red-400' :
                                    'text-white'
                                  }`}>
                                    {f.durationSecs ? formatDuration(f.durationSecs) : '–'}
                                    {isFastest && !f.isOverTime && <span className="text-xs ml-1">↑</span>}
                                    {isSlowest && !f.isOverTime && <span className="text-xs ml-1">↓</span>}
                                  </p>
                                  {f.isOverTime && <span className="text-yellow-500 text-xs">OVER</span>}
                                </div>
                                <div className="col-span-2">
                                  <p className="font-mono text-slate-400 text-xs">{formatDuration(f.cumulativeSecs)}</p>
                                </div>
                                <div className="col-span-1">
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                                    f.participant.splits.find(s => s.loop_number === loop.loopNumber)?.recorded_by === 'rfid'
                                      ? 'bg-purple-900/40 text-purple-300'
                                      : 'bg-slate-800 text-slate-500'
                                  }`}>
                                    {f.participant.splits.find(s => s.loop_number === loop.loopNumber)?.recorded_by === 'rfid' ? '📡' : '✋'}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="px-4 py-6 text-slate-600 text-sm text-center">
                          Ingen fullføringer registrert ennå
                        </div>
                      )}

                      {/* DNC i denne runden */}
                      {loop.dnc.length > 0 && (
                        <div className="border-t border-slate-800 bg-red-950/10 px-4 py-3">
                          <p className="text-xs text-red-500 uppercase tracking-wider mb-2">❌ DNC i runde {loop.loopNumber}</p>
                          <div className="flex flex-wrap gap-2">
                            {loop.dnc.map(p => (
                              <span key={p.id} className="bg-red-950/30 border border-red-900/30 text-red-300 text-xs px-2 py-1 rounded-lg">
                                #{p.bib_number} {fullName(p)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
