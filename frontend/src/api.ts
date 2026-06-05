import axios from 'axios'

const api = axios.create({ baseURL: '/api' })
export default api

// ─── Types ────────────────────────────────────────────────────────────────────

export type RaceType = 'backyard_ultra' | 'track_10k'

export type RunnerStatus =
  | 'active_running'
  | 'active_resting'
  | 'rtc'
  | 'dnc'
  | 'over'
  | 'dns'
  | 'dsq'
  | 'winner'

export interface Race {
  id: number
  name: string
  race_type: RaceType
  race_date: string | null
  location: string | null
  loop_distance_km: number
  loop_duration_minutes: number
  loop_start_time: string
  chip_lockout_seconds: number
  grace_period_seconds: number
  auto_start_next_loop: boolean
  dnc_auto_assign: boolean
  is_active: boolean
  is_finished: boolean
  current_loop: number
  loop_start_utc: string | null
  created_at: string
}

export interface Split {
  id: number
  loop_number: number
  finish_time_utc: string
  loop_duration_secs: number | null
  recorded_by: string
  is_over_time: boolean
}

export interface Participant {
  id: number
  race_id: number
  first_name: string
  last_name: string | null
  bib_number: number
  gender: string | null
  age: number | null
  chip_id_1: string | null
  chip_id_2: string | null
  status: RunnerStatus
  loops_completed: number
  total_km: number
  splits: Split[]
}

// ─── Race ─────────────────────────────────────────────────────────────────────

export const getRaces = () => api.get<Race[]>('/races/').then(r => r.data)
export const getRace = (id: number) => api.get<Race>(`/races/${id}`).then(r => r.data)
export const createRace = (data: Partial<Race>) => api.post<Race>('/races/', data).then(r => r.data)
export const updateRace = (id: number, data: Partial<Race>) => api.patch<Race>(`/races/${id}`, data).then(r => r.data)
export const deleteRace = (id: number) => api.delete(`/races/${id}`)
export const startRace = (id: number) => api.post<Race>(`/races/${id}/start`).then(r => r.data)
export const nextLoop = (id: number) => api.post<Race>(`/races/${id}/next-loop`).then(r => r.data)
export const finishRace = (id: number) => api.post(`/races/${id}/finish`)
export const exportCsv = (id: number) => `${api.defaults.baseURL}/races/${id}/export/csv`

// ─── Participants ─────────────────────────────────────────────────────────────

export const getParticipants = (raceId: number) =>
  api.get<Participant[]>(`/races/${raceId}/participants/`).then(r => r.data)

export const addParticipant = (raceId: number, data: Partial<Participant>) =>
  api.post<Participant>(`/races/${raceId}/participants/`, data).then(r => r.data)

export const updateParticipant = (raceId: number, participantId: number, data: Partial<Participant>) =>
  api.patch<Participant>(`/races/${raceId}/participants/${participantId}`, data).then(r => r.data)

export const removeParticipant = (raceId: number, participantId: number) =>
  api.delete(`/races/${raceId}/participants/${participantId}`)

export const registerSplit = (raceId: number, participantId: number, finishTimeUtc?: string) =>
  api.post<Participant>(`/races/${raceId}/participants/${participantId}/split`, {
    finish_time_utc: finishTimeUtc || null
  }).then(r => r.data)

export const editSplit = (raceId: number, participantId: number, splitId: number, finishTimeUtc: string) =>
  api.patch<Split>(`/races/${raceId}/participants/${participantId}/splits/${splitId}`, {
    finish_time_utc: finishTimeUtc
  }).then(r => r.data)

export const deleteSplit = (raceId: number, participantId: number, splitId: number) =>
  api.delete(`/races/${raceId}/participants/${participantId}/splits/${splitId}`)

export const massRtc = (raceId: number, bibNumbers: number[]) =>
  api.post(`/races/${raceId}/participants/mass-rtc`, { bib_numbers: bibNumbers })

// Rediger rundetid (sekunder) direkte
export const editSplitDuration = (raceId: number, participantId: number, splitId: number, durationSecs: number) =>
  api.patch<Split>(`/races/${raceId}/participants/${participantId}/splits/${splitId}`, {
    loop_duration_secs: durationSecs
  }).then(r => r.data)

// ─── Inaktive chip-avlesninger ────────────────────────────────────────────────

export interface InactiveChip {
  chip_id: string
  race_id: number
  participant_id: number
  participant_name: string
  bib_number: number
  status: RunnerStatus
  loops_completed: number
  first_seen: string
  last_seen: string
  count: number
}

export const getInactiveChips = (raceId: number) =>
  api.get<InactiveChip[]>(`/races/${raceId}/inactive-chips`).then(r => r.data)

export const dismissInactiveChip = (raceId: number, chipId: string) =>
  api.delete(`/races/${raceId}/inactive-chips/${chipId}`)

export const restoreInactiveChip = (raceId: number, chipId: string) =>
  api.post(`/races/${raceId}/inactive-chips/${chipId}/restore`).then(r => r.data)

export const csvPreview = (raceId: number, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<{ headers: string[]; preview: Record<string, string>[] }>(
    `/races/${raceId}/participants/csv-preview`, form
  ).then(r => r.data)
}

export const csvImport = (raceId: number, file: File, mapping: object) => {
  const form = new FormData()
  form.append('file', file)
  form.append('mapping', JSON.stringify(mapping))
  return api.post<{ added: number; skipped: number }>(
    `/races/${raceId}/participants/csv-import`, form
  ).then(r => r.data)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fullName(p: Participant): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ')
}

export function toLocalInputValue(isoUtc: string): string {
  const d = new Date(isoUtc.endsWith('Z') ? isoUtc : isoUtc + 'Z')
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function toUtcIso(localValue: string): string {
  return new Date(localValue).toISOString()
}

export function formatDuration(secs: number | null | undefined): string {
  if (!secs && secs !== 0) return '–'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}
