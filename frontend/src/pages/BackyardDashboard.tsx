import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getRace, getParticipants, startRace, nextLoop, finishRace,
  registerSplit, editSplit, deleteSplit, updateParticipant,
  addParticipant, removeParticipant, exportCsv,
  csvPreview, csvImport, fullName, toLocalInputValue, toUtcIso, formatDuration
} from '../api'
import type { Race, Participant, Split, RunnerStatus } from '../api'

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
  active_running: 'text-green-400',
  active_resting: 'text-blue-400',
  rtc: 'text-orange-400',
  dnc: 'text-red-400',
  over: 'text-yellow-400',
  dns: 'text-slate-500',
  dsq: 'text-red-600',
  winner: 'text-yellow-300',
}

const STATUS_ROW: Record<RunnerStatus, string> = {
  active_running: 'bg-slate-800 border-slate-700',
  active_resting: 'bg-blue-950/40 border-blue-800/40',
  rtc: 'bg-orange-950/30 border-orange-900/30',
  dnc: 'bg-red-950/30 border-red-900/30',
  over: 'bg-yellow-950/30 border-yellow-900/30',
  dns: 'bg-slate-900 border-slate-800',
  dsq: 'bg-red-950/50 border-red-900/50',
  winner: 'bg-yellow-900/30 border-yellow-700/50',
}

const ACTIVE: RunnerStatus[] = ['active_running', 'active_resting']
const DONE: RunnerStatus[] = ['rtc', 'dnc', 'over', 'dns', 'dsq', 'winner']

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

function fmtCd(secs: number) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
}

function SplitsModal({ race, participant, onClose, onRefresh }: { race: Race; participant: Participant; onClose: () => void; onRefresh: () => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [editTime, setEditTime] = useState('')
  const [busy, setBusy] = useState(false)

  const handleEdit = async (split: Split) => {
    setBusy(true)
    try { await editSplit(race.id, participant.id, split.id, toUtcIso(editTime)); setEditing(null); onRefresh() }
    finally { setBusy(false) }
  }
  const handleDelete = async (split: Split) => {
    if (!confirm(`Slett runde ${split.loop_number}?`)) return
    setBusy(true)
    try { await deleteSplit(race.id, participant.id, split.id); onRefresh() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-md border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{fullName(participant)} – Runder</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        {participant.splits.length === 0 ? (
          <p className="text-slate-500 text-center py-6">Ingen runder registrert</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {[...participant.splits].sort((a,b) => a.loop_number - b.loop_number).map(split => (
              <div key={split.id} className="bg-slate-700 rounded-lg p-3">
                {editing === split.id ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-slate-400 text-sm w-10">R{split.loop_number}</span>
                    <input type="datetime-local" step="1" value={editTime} onChange={e => setEditTime(e.target.value)}
                      className="flex-1 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-sm text-white" />
                    <button onClick={() => handleEdit(split)} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm">✓</button>
                    <button onClick={() => setEditing(null)} className="bg-slate-600 hover:bg-slate-500 text-white px-2 py-1 rounded text-sm">✕</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm">Runde {split.loop_number}</span>
                      {split.is_over_time && <span className="ml-2 text-yellow-400 text-xs">OVER</span>}
                      <p className="text-slate-400 text-xs">
                        {new Date(split.finish_time_utc+'Z').toLocaleTimeString('no-NO')}
                        {split.loop_duration_secs && ` · ${formatDuration(split.loop_duration_secs)}`}
                        <span className="ml-1 text-slate-500">({split.recorded_by})</span>
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(split.id); setEditTime(toLocalInputValue(split.finish_time_utc)) }}
                        className="text-slate-400 hover:text-blue-400 text-sm px-1.5">✏️</button>
                      <button onClick={() => handleDelete(split)} className="text-slate-400 hover:text-red-400 text-sm px-1.5">🗑️</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="w-full mt-4 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg">Lukk</button>
      </div>
    </div>
  )
}

function StatusModal({ race, participant, onClose, onRefresh }: { race: Race; participant: Participant; onClose: () => void; onRefresh: () => void }) {
  const lastSplit = [...participant.splits].sort((a,b) => b.loop_number - a.loop_number)[0]
  const [loops, setLoops] = useState(participant.loops_completed)
  const [status, setStatus] = useState<RunnerStatus>(participant.status)
  const [busy, setBusy] = useState(false)
  const ALL: RunnerStatus[] = ['active_running','active_resting','rtc','dnc','over','dns','dsq','winner']

  const handleSave = async () => {
    setBusy(true)
    try { await updateParticipant(race.id, participant.id, { status, loops_completed: loops }); onRefresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{fullName(participant)}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${status===s ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Fullførte runder
              {lastSplit && <span className="ml-2 text-slate-500 text-xs">(siste: R{lastSplit.loop_number})</span>}
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => setLoops(Math.max(0,loops-1))} className="bg-slate-700 hover:bg-slate-600 text-white w-9 h-9 rounded-lg text-lg font-bold">−</button>
              <span className="text-2xl font-bold w-12 text-center">{loops}</span>
              <button onClick={() => setLoops(loops+1)} className="bg-slate-700 hover:bg-slate-600 text-white w-9 h-9 rounded-lg text-lg font-bold">+</button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold">{busy?'Lagrer...':'Lagre'}</button>
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg">Avbryt</button>
        </div>
      </div>
    </div>
  )
}

function ManualSplitModal({ race, participant, onClose, onRefresh }: { race: Race; participant: Participant; onClose: () => void; onRefresh: () => void }) {
  const now = new Date(), pad = (n:number) => n.toString().padStart(2,'0')
  const [time, setTime] = useState(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    setBusy(true)
    try { await registerSplit(race.id, participant.id, toUtcIso(time)); onRefresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Registrer runde – {fullName(participant)}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <p className="text-slate-400 text-sm mb-3">Runde {race.current_loop}</p>
        <label className="block text-sm text-slate-300 mb-1">Tidspunkt</label>
        <input type="datetime-local" step="1" value={time} onChange={e => setTime(e.target.value)}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 mb-4" />
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={busy} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold">{busy?'Registrerer...':'✓ Registrer'}</button>
          <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg">Avbryt</button>
        </div>
      </div>
    </div>
  )
}

function AddParticipantModal({ race, onClose, onRefresh }: { race: Race; onClose: () => void; onRefresh: () => void }) {
  const [form, setForm] = useState({ first_name:'', last_name:'', bib_number:'', gender:'', age:'', chip_id_1:'', chip_id_2:'' })
  const [busy, setBusy] = useState(false)
  const [csvMode, setCsvMode] = useState(false)
  const [csvFile, setCsvFile] = useState<File|null>(null)
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([])
  const [csvMap, setCsvMap] = useState({ bib_col:'Bib', first_name_col:'FirstName', last_name_col:'LastName', gender_col:'', age_col:'', chip_id_1_col:'' })
  const [csvResult, setCsvResult] = useState<{added:number;skipped:number}|null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await addParticipant(race.id, { first_name:form.first_name, last_name:form.last_name||undefined, bib_number:parseInt(form.bib_number), gender:form.gender||undefined, age:form.age?parseInt(form.age):undefined, chip_id_1:form.chip_id_1||undefined, chip_id_2:form.chip_id_2||undefined })
      onRefresh(); setForm({ first_name:'', last_name:'', bib_number:'', gender:'', age:'', chip_id_1:'', chip_id_2:'' })
    } finally { setBusy(false) }
  }

  const handleCsvFile = async (file: File) => {
    setCsvFile(file)
    const r = await csvPreview(race.id, file)
    setCsvHeaders(r.headers); setCsvRows(r.preview)
    const h = r.headers
    setCsvMap({ bib_col:h.find(x=>/bib/i.test(x))||h[0]||'', first_name_col:h.find(x=>/first|fornavn/i.test(x))||h[1]||'', last_name_col:h.find(x=>/last|etternavn/i.test(x))||h[2]||'', gender_col:h.find(x=>/gender|kjønn/i.test(x))||'', age_col:h.find(x=>/age|alder/i.test(x))||'', chip_id_1_col:h.find(x=>/chip|epc|tag/i.test(x))||'' })
  }

  const handleImport = async () => {
    if (!csvFile) return; setBusy(true)
    try { const r = await csvImport(race.id, csvFile, csvMap); setCsvResult(r); onRefresh() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-lg border border-slate-600 shadow-2xl my-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Legg til deltakere</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setCsvMode(false)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!csvMode?'bg-blue-600 text-white':'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Manuelt</button>
          <button onClick={() => setCsvMode(true)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${csvMode?'bg-blue-600 text-white':'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>CSV-import</button>
        </div>
        {!csvMode ? (
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[['Fornavn *','first_name',true],['Etternavn','last_name',false],['Startnummer *','bib_number',true],['Chip ID 1','chip_id_1',false],['Chip ID 2 (backup)','chip_id_2',false]].map(([label,key,req]) => (
                <div key={key as string} className={key==='chip_id_2'?'col-span-2':''}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <input required={req as boolean} value={(form as Record<string,string>)[key as string]}
                    onChange={e => setForm({...form,[key as string]:e.target.value})}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Kjønn</label>
                <select value={form.gender} onChange={e => setForm({...form,gender:e.target.value})} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">–</option><option value="M">Mann</option><option value="F">Kvinne</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Alder</label>
                <input type="number" value={form.age} onChange={e => setForm({...form,age:e.target.value})} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <button type="submit" disabled={busy} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold">{busy?'Legger til...':'+ Legg til'}</button>
          </form>
        ) : csvResult ? (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-white font-semibold">{csvResult.added} deltakere importert</p>
            {csvResult.skipped>0 && <p className="text-slate-400 text-sm">{csvResult.skipped} hoppet over</p>}
            <button onClick={onClose} className="mt-4 bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg">Lukk</button>
          </div>
        ) : !csvFile ? (
          <label className="block w-full border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-slate-500">
            <p className="text-slate-400">📂 Klikk for å velge CSV-fil</p>
            <input type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleCsvFile(e.target.files[0])} />
          </label>
        ) : (
          <div className="space-y-3">
            <p className="text-green-400 text-sm">✓ {csvFile.name}</p>
            {csvRows.length>0 && (
              <div className="overflow-x-auto max-h-32">
                <table className="text-xs text-slate-300 w-full">
                  <thead><tr>{csvHeaders.map(h=><th key={h} className="text-left px-2 py-1 text-slate-500">{h}</th>)}</tr></thead>
                  <tbody>{csvRows.map((row,i)=><tr key={i} className="border-t border-slate-700">{csvHeaders.map(h=><td key={h} className="px-2 py-1">{row[h]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[['Startnr','bib_col'],['Fornavn','first_name_col'],['Etternavn','last_name_col'],['Chip ID','chip_id_1_col']].map(([label,key]) => (
                <div key={key}>
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <select value={(csvMap as Record<string,string>)[key]} onChange={e => setCsvMap({...csvMap,[key]:e.target.value})} className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white text-xs">
                    <option value="">– Ikke bruk –</option>
                    {csvHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={handleImport} disabled={busy} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold">{busy?'Importerer...':'⬆ Importer'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function BackyardDashboard() {
  const { id } = useParams<{ id: string }>()
  const raceId = parseInt(id!)
  const [race, setRace] = useState<Race|null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [splitsModal, setSplitsModal] = useState<Participant|null>(null)
  const [statusModal, setStatusModal] = useState<Participant|null>(null)
  const [splitModal, setSplitModal] = useState<Participant|null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [toast, setToast] = useState<{msg:string;type:'ok'|'err'}|null>(null)
  const { remaining, elapsed } = useCountdown(race)

  const showToast = (msg:string, type:'ok'|'err'='ok') => { setToast({msg,type}); setTimeout(()=>setToast(null),3500) }

  const load = useCallback(async () => {
    try { const [r,ps] = await Promise.all([getRace(raceId),getParticipants(raceId)]); setRace(r); setParticipants(ps) }
    finally { setLoading(false) }
  }, [raceId])

  useEffect(() => { load() }, [load])

  const wsRef = useRef<WebSocket|null>(null)
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/races/${raceId}`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (['split_recorded','participant_updated','new_loop','race_started','mass_rtc','split_edited','split_deleted'].includes(data.event)) load()
      if (data.event==='split_recorded') showToast(`✅ ${data.participant_name} – Runde ${data.loop_number}${data.is_over_time?' (OVER)':''}`)
      if (data.event==='potential_winner') showToast(`🏆 Potensiell vinner: ${data.participant_name}!`)
      if (data.event==='new_loop') showToast(`🔔 Runde ${data.loop} startet!`)
    }
    return () => ws.close()
  }, [raceId, load])

  const handleStart = async () => { if(!confirm('Start løpet?')) return; await startRace(raceId); load() }
  const handleNextLoop = async () => { if(!confirm(`Start runde ${(race?.current_loop??0)+1} nå?`)) return; await nextLoop(raceId); load() }
  const handleFinish = async () => { if(!confirm('Avslutt løpet?')) return; await finishRace(raceId); load() }

  const handleFastTap = async (p: Participant) => {
    try { await registerSplit(raceId, p.id); showToast(`✅ ${fullName(p)} – Runde ${race?.current_loop}`); load() }
    catch (err: unknown) { showToast(`❌ ${(err as {response?:{data?:{detail?:string}}})?.response?.data?.detail||'Feil'}`, 'err') }
  }

  const handleRemove = async (p: Participant) => {
    if(!confirm(`Fjern ${fullName(p)}?`)) return; await removeParticipant(raceId, p.id); load()
  }

  const active = participants.filter(p=>ACTIVE.includes(p.status)).sort((a,b) => {
    if(a.status==='active_resting'&&b.status!=='active_resting') return -1
    if(b.status==='active_resting'&&a.status!=='active_resting') return 1
    return b.loops_completed-a.loops_completed||a.bib_number-b.bib_number
  })
  const done = participants.filter(p=>DONE.includes(p.status)).sort((a,b)=>b.loops_completed-a.loops_completed||a.bib_number-b.bib_number)
  const cdPct = race ? Math.max(0,Math.min(100,(remaining/(race.loop_duration_minutes*60))*100)) : 0
  const isUrgent = remaining<120 && remaining>0 && race?.is_active

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">Laster...</div>
  if (!race) return <div className="flex items-center justify-center h-screen text-red-400">Løp ikke funnet</div>

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium ${toast.type==='ok'?'bg-green-700':'bg-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-400 hover:text-white transition-colors text-sm">← Tilbake</Link>
            <div>
              <h1 className="font-bold text-lg leading-tight">{race.name}</h1>
              <p className="text-slate-400 text-xs">
                {race.location&&`📍 ${race.location} · `}{race.loop_distance_km} km · {race.loop_duration_minutes} min/runde
                {race.loop_duration_minutes<10&&<span className="text-yellow-400 ml-1">⚡ test</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={exportCsv(raceId)} download className="text-slate-400 hover:text-white text-sm px-3 py-1.5 bg-slate-700 rounded-lg">⬇ CSV</a>
            <Link to={`/race/${raceId}/scoreboard`} className="text-slate-400 hover:text-white text-sm px-3 py-1.5 bg-slate-700 rounded-lg">📺 TV</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className={`rounded-2xl p-4 border ${isUrgent?'bg-red-950/50 border-red-700':'bg-slate-800 border-slate-700'}`}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-48">
              {race.is_active ? (
                <>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-4xl font-mono font-bold ${isUrgent?'text-red-400 animate-pulse':'text-white'}`}>{fmtCd(remaining)}</span>
                    <span className="text-slate-400 text-sm">igjen</span>
                    <span className="text-slate-500 text-xs ml-2">Runde {race.current_loop}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${isUrgent?'bg-red-500':'bg-green-500'}`} style={{width:`${cdPct}%`}} />
                  </div>
                  <p className="text-slate-500 text-xs mt-1">Elapsed: {formatDuration(elapsed)}</p>
                </>
              ) : race.is_finished ? (
                <span className="text-2xl font-bold text-slate-400">🏁 Løpet er avsluttet</span>
              ) : (
                <span className="text-xl font-semibold text-slate-400">⏳ Klar til start</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!race.is_active&&!race.is_finished&&<button onClick={handleStart} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-semibold">▶ Start løp</button>}
              {race.is_active&&<>
                <button onClick={handleNextLoop} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold">⏭ Neste runde</button>
                <button onClick={handleFinish} className="bg-slate-700 hover:bg-red-800 text-white px-4 py-2.5 rounded-xl">🏁 Avslutt</button>
              </>}
              <button onClick={() => setShowAdd(true)} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl">+ Deltaker</button>
            </div>
            <div className="flex gap-4 text-center">
              <div><p className="text-2xl font-bold text-green-400">{active.length}</p><p className="text-slate-500 text-xs">Aktive</p></div>
              <div><p className="text-2xl font-bold text-blue-400">{active.filter(p=>p.status==='active_resting').length}</p><p className="text-slate-500 text-xs">I mål</p></div>
              <div><p className="text-2xl font-bold text-slate-400">{done.length}</p><p className="text-slate-500 text-xs">Ute</p></div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Aktive løpere ({active.length})</h2>
          {active.length===0 ? (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center text-slate-500">Ingen aktive løpere</div>
          ) : (
            <div className="space-y-1.5">
              {active.map((p,idx) => (
                <div key={p.id} className={`rounded-xl border p-3 flex items-center gap-3 ${STATUS_ROW[p.status]}`}>
                  <span className="text-slate-500 text-sm w-5 text-center">{idx+1}</span>
                  <span className="bg-slate-700 text-white text-xs font-bold px-2 py-0.5 rounded w-10 text-center">#{p.bib_number}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{fullName(p)}</span>
                    {p.gender&&<span className="text-slate-500 text-xs ml-1">({p.gender})</span>}
                  </div>
                  <span className={`text-sm font-medium ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  <button onClick={() => setSplitsModal(p)} className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold px-3 py-1 rounded-lg min-w-12 text-center">{p.loops_completed}</button>
                  <div className="flex gap-1.5">
                    {race.is_active&&p.status==='active_running'&&<>
                      <button onClick={() => handleFastTap(p)} className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold">✓ Runde</button>
                      <button onClick={() => setSplitModal(p)} className="bg-slate-600 hover:bg-slate-500 text-white text-xs px-2 py-1.5 rounded-lg" title="Med tidspunkt">🕐</button>
                    </>}
                    <button onClick={() => setStatusModal(p)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded-lg" title="Endre status">⚙️</button>
                    <button onClick={() => handleRemove(p)} className="text-slate-600 hover:text-red-400 text-xs px-1.5 py-1.5 rounded-lg" title="Fjern">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {done.length>0&&(
          <div>
            <button onClick={() => setShowDone(!showDone)} className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-300">
              <span>{showDone?'▼':'▶'}</span> Utgåtte løpere ({done.length})
            </button>
            {showDone&&(
              <div className="space-y-1.5">
                {done.map((p,idx) => (
                  <div key={p.id} className={`rounded-xl border p-3 flex items-center gap-3 opacity-70 ${STATUS_ROW[p.status]}`}>
                    <span className="text-slate-600 text-sm w-5 text-center">{active.length+idx+1}</span>
                    <span className="bg-slate-700 text-slate-400 text-xs font-bold px-2 py-0.5 rounded w-10 text-center">#{p.bib_number}</span>
                    <div className="flex-1 min-w-0"><span className="font-semibold text-sm text-slate-300">{fullName(p)}</span></div>
                    <span className={`text-sm font-medium ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    <button onClick={() => setSplitsModal(p)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold px-3 py-1 rounded-lg min-w-12 text-center">{p.loops_completed}</button>
                    <button onClick={() => setStatusModal(p)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded-lg">⚙️</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {splitsModal&&<SplitsModal race={race} participant={splitsModal} onClose={()=>setSplitsModal(null)} onRefresh={load} />}
      {statusModal&&<StatusModal race={race} participant={statusModal} onClose={()=>setStatusModal(null)} onRefresh={load} />}
      {splitModal&&<ManualSplitModal race={race} participant={splitModal} onClose={()=>setSplitModal(null)} onRefresh={load} />}
      {showAdd&&<AddParticipantModal race={race} onClose={()=>setShowAdd(false)} onRefresh={load} />}
    </div>
  )
}
