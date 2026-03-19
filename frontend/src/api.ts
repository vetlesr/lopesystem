import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export default api

// ─── Types ────────────────────────────────────────────────────────────────────

export type RaceType = 'backyard_ultra' | 'track_10k'
export type ParticipantStatus = 'active' | 'finished' | 'rtc' | 'dnf' | 'dns'

export interface Race {
  id: number
  name: string
  race_type: RaceType
  date: string | null
  location: string | null
  lap_distance_km: number
  lap_time_minutes: number
  rfid_cooldown_seconds: number
  is_active: boolean
  is_finished: boolean
  current_lap: number
  lap_start_time: string | null
  created_at: string
}

export interface Lap {
  id: number
  lap_number: number
  finish_time: string
  lap_duration_seconds: number | null
  recorded_by: string
}

export interface Participant {
  id: number
  race_id: number
  name: string
  bib_number: number
  rfid_tag: string | null
  status: ParticipantStatus
  laps_completed: number
  total_distance_km: number
  laps: Lap[]
}

// ─── Race API ─────────────────────────────────────────────────────────────────

export const getRaces = () => api.get<Race[]>('/races/').then(r => r.data)
export const getRace = (id: number) => api.get<Race>(`/races/${id}`).then(r => r.data)
export const createRace = (data: Partial<Race>) => api.post<Race>('/races/', data).then(r => r.data)
export const updateRace = (id: number, data: Partial<Race>) => api.patch<Race>(`/races/${id}`, data).then(r => r.data)
export const deleteRace = (id: number) => api.delete(`/races/${id}`)
export const startRace = (id: number) => api.post<Race>(`/races/${id}/start`).then(r => r.data)
export const nextLap = (id: number) => api.post<Race>(`/races/${id}/next-lap`).then(r => r.data)
export const finishRace = (id: number) => api.post(`/races/${id}/finish`)

// ─── Participant API ──────────────────────────────────────────────────────────

export const getParticipants = (raceId: number) =>
  api.get<Participant[]>(`/races/${raceId}/participants/`).then(r => r.data)

export const addParticipant = (raceId: number, data: { name: string; bib_number: number; rfid_tag?: string }) =>
  api.post<Participant>(`/races/${raceId}/participants/`, data).then(r => r.data)

export const updateParticipant = (raceId: number, participantId: number, data: Partial<Participant>) =>
  api.patch<Participant>(`/races/${raceId}/participants/${participantId}`, data).then(r => r.data)

export const removeParticipant = (raceId: number, participantId: number) =>
  api.delete(`/races/${raceId}/participants/${participantId}`)

export const registerLap = (raceId: number, participantId: number, finishTime?: string) =>
  api.post<Participant>(`/races/${raceId}/participants/${participantId}/lap`, {
    finish_time: finishTime || null
  }).then(r => r.data)

export const editLap = (raceId: number, participantId: number, lapId: number, finishTime: string) =>
  api.patch<Lap>(`/races/${raceId}/participants/${participantId}/laps/${lapId}`, {
    finish_time: finishTime
  }).then(r => r.data)

export const deleteLap = (raceId: number, participantId: number, lapId: number) =>
  api.delete(`/races/${raceId}/participants/${participantId}/laps/${lapId}`)

export const finishParticipant = (raceId: number, participantId: number, lastLap?: number) =>
  api.post<Participant>(`/races/${raceId}/participants/${participantId}/finish`, {
    last_lap: lastLap ?? null
  }).then(r => r.data)

export const getLastLap = (raceId: number, participantId: number) =>
  api.get<{ participant_id: number; laps_completed: number; last_lap_number: number; last_finish_time: string | null }>(
    `/races/${raceId}/participants/${participantId}/last-lap`
  ).then(r => r.data)
