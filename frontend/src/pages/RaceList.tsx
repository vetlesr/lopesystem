import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRaces, createRace, deleteRace } from '../api'
import type { Race } from '../api'

export default function RaceList() {
  const [races, setRaces] = useState<Race[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', location: '', race_type: 'backyard_ultra' as const })
  const navigate = useNavigate()

  const load = () => getRaces().then(setRaces)

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createRace(form)
    setShowForm(false)
    setForm({ name: '', location: '', race_type: 'backyard_ultra' })
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Slett dette løpet?')) return
    await deleteRace(id)
    load()
  }

  const statusBadge = (race: Race) => {
    if (race.is_finished) return <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">Avsluttet</span>
    if (race.is_active) return <span className="px-2 py-0.5 rounded text-xs bg-green-700 text-green-200 animate-pulse">● Pågår</span>
    return <span className="px-2 py-0.5 rounded text-xs bg-yellow-800 text-yellow-200">Ikke startet</span>
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">🏃 Løpesystem</h1>
          <p className="text-slate-400 mt-1">Administrer dine løp</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          + Nytt løp
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-slate-800 rounded-xl p-6 mb-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Opprett nytt løp</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Navn *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                placeholder="f.eks. Backyard Ultra 2026"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Sted</label>
              <input
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                placeholder="f.eks. Trondheim"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Løpsformat</label>
              <select
                value={form.race_type}
                onChange={e => setForm({ ...form, race_type: e.target.value as 'backyard_ultra' })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="backyard_ultra">Backyard Ultra</option>
                <option value="track_10k">10 000 meter (kommer)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
              Opprett
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors">
              Avbryt
            </button>
          </div>
        </form>
      )}

      {races.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-5xl mb-4">🏁</p>
          <p className="text-lg">Ingen løp ennå. Opprett ditt første løp!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {races.map(race => (
            <div
              key={race.id}
              className="bg-slate-800 rounded-xl p-5 border border-slate-700 hover:border-slate-500 transition-colors cursor-pointer"
              onClick={() => navigate(`/races/${race.id}`)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-white">{race.name}</h2>
                    {statusBadge(race)}
                  </div>
                  <p className="text-slate-400 text-sm mt-1">
                    {race.race_type === 'backyard_ultra' ? '🔄 Backyard Ultra' : '🏟️ 10 000 m'}
                    {race.location && ` · 📍 ${race.location}`}
                    {race.is_active && ` · Runde ${race.current_lap}`}
                  </p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(race.id) }}
                  className="text-slate-500 hover:text-red-400 transition-colors p-2"
                  title="Slett løp"
                >
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
