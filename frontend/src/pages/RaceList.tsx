import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRaces, createRace, deleteRace } from '../api'
import type { Race } from '../api'

const DEFAULT_FORM = {
  name: '',
  race_date: new Date().toISOString().slice(0, 10),
  location: '',
  loop_distance_km: 6.706,
  loop_duration_minutes: 60,
  loop_start_time: '10:00:00',
  chip_lockout_seconds: 1800,
  grace_period_seconds: 0,
  auto_start_next_loop: true,
  dnc_auto_assign: true,
}

type FormData = typeof DEFAULT_FORM

export default function RaceList() {
  const navigate = useNavigate()
  const [races, setRaces] = useState<Race[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)

  const load = () => getRaces().then(setRaces)
  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const race = await createRace({ ...form, race_type: 'backyard_ultra' })
      setShowForm(false)
      setForm(DEFAULT_FORM)
      navigate(`/race/${race.id}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Slett løpet "${name}"? Dette kan ikke angres.`)) return
    await deleteRace(id)
    load()
  }

  const statusBadge = (r: Race) => {
    if (r.is_finished) return <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">🏁 Ferdig</span>
    if (r.is_active) return <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded animate-pulse">🟢 Pågår</span>
    return <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded">⏳ Ikke startet</span>
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Løpesystem</h1>
          <p className="text-slate-400 text-sm mt-1">Backyard Ultra Timing</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors">
          + Nytt løp
        </button>
      </div>

      {/* Opprett løp-modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-2xl border border-slate-600 shadow-2xl my-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">Opprett nytt løp</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
              {/* Grunninfo */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Grunnleggende info</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">Løpsnavn *</label>
                    <input required value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="f.eks. Ås Backyard Ultra 2026"
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Dato</label>
                    <input type="date" value={form.race_date}
                      onChange={e => setForm({ ...form, race_date: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Sted</label>
                    <input value={form.location}
                      onChange={e => setForm({ ...form, location: e.target.value })}
                      placeholder="f.eks. Ås"
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              </section>

              {/* Timing */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Timing-parametere</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Løypedistanse (km)</label>
                    <input type="number" step="0.001" min="0.1" value={form.loop_distance_km}
                      onChange={e => setForm({ ...form, loop_distance_km: parseFloat(e.target.value) })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      Rundevarighet (min)
                      {form.loop_duration_minutes < 10 && <span className="ml-2 text-yellow-400 text-xs">⚡ testmodus</span>}
                    </label>
                    <input type="number" min="1" value={form.loop_duration_minutes}
                      onChange={e => setForm({ ...form, loop_duration_minutes: parseInt(e.target.value) })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                    <p className="text-slate-500 text-xs mt-0.5">Standard: 60 min. Sett til 1–2 for testing.</p>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Starttid runde 1</label>
                    <input type="time" step="1" value={form.loop_start_time}
                      onChange={e => setForm({ ...form, loop_start_time: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Chip lockout (sek)</label>
                    <input type="number" min="5" value={form.chip_lockout_seconds}
                      onChange={e => setForm({ ...form, chip_lockout_seconds: parseInt(e.target.value) })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                    <p className="text-slate-500 text-xs mt-0.5">
                      = {(form.chip_lockout_seconds / 60).toFixed(1)} min. Standard: 1800s (30 min). Test: 30–60s.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Grace period (sek)</label>
                    <input type="number" min="0" value={form.grace_period_seconds}
                      onChange={e => setForm({ ...form, grace_period_seconds: parseInt(e.target.value) })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                    <p className="text-slate-500 text-xs mt-0.5">Ekstra sekunder etter runden før OVER-status. Standard: 0.</p>
                  </div>
                </div>
              </section>

              {/* Automatisering */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Automatisering</h3>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.auto_start_next_loop}
                      onChange={e => setForm({ ...form, auto_start_next_loop: e.target.checked })}
                      className="mt-0.5 w-4 h-4 accent-blue-500" />
                    <div>
                      <span className="text-sm text-white font-medium">Auto-start neste runde</span>
                      <p className="text-slate-500 text-xs">Neste runde starter automatisk ved 00:00 på nedtellingen.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.dnc_auto_assign}
                      onChange={e => setForm({ ...form, dnc_auto_assign: e.target.checked })}
                      className="mt-0.5 w-4 h-4 accent-blue-500" />
                    <div>
                      <span className="text-sm text-white font-medium">Auto-sett DNC</span>
                      <p className="text-slate-500 text-xs">Løpere som ikke er i mål settes automatisk til DNC ved rundeslutt.</p>
                    </div>
                  </label>
                </div>
              </section>

              <div className="flex gap-3 pt-2 border-t border-slate-700">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold transition-colors">
                  {saving ? 'Oppretter...' : '✓ Opprett løp'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg transition-colors">
                  Avbryt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Løpsliste */}
      {races.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-5xl mb-4">🏃</p>
          <p className="text-lg">Ingen løp ennå</p>
          <p className="text-sm mt-1">Klikk "+ Nytt løp" for å komme i gang</p>
        </div>
      ) : (
        <div className="space-y-3">
          {races.map(r => (
            <div key={r.id}
              className="bg-slate-800 rounded-xl border border-slate-700 p-5 hover:border-slate-500 transition-colors cursor-pointer"
              onClick={() => navigate(`/race/${r.id}`)}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h2 className="text-lg font-bold text-white">{r.name}</h2>
                    {statusBadge(r)}
                  </div>
                  <p className="text-slate-400 text-sm">
                    {r.race_date && `📅 ${r.race_date} · `}
                    {r.location && `📍 ${r.location} · `}
                    🔄 {r.loop_distance_km} km · {r.loop_duration_minutes} min/runde
                    {r.loop_duration_minutes < 10 && <span className="text-yellow-400 ml-1">⚡ test</span>}
                  </p>
                  {r.is_active && (
                    <p className="text-green-400 text-sm mt-1 font-medium">▶ Runde {r.current_loop} pågår</p>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(r.id, r.name) }}
                  className="text-slate-600 hover:text-red-400 text-sm ml-4 transition-colors flex-shrink-0">
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
