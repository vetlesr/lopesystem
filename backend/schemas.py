from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from models import RaceType, ParticipantStatus


# ─── Race ────────────────────────────────────────────────────────────────────

class RaceCreate(BaseModel):
    name: str
    race_type: RaceType = RaceType.BACKYARD_ULTRA
    date: Optional[datetime] = None
    location: Optional[str] = None
    lap_distance_km: float = 6.706
    lap_time_minutes: int = 60
    rfid_cooldown_seconds: int = 30  # Cooldown mellom avlesninger av samme tag


class RaceUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[datetime] = None
    location: Optional[str] = None
    rfid_cooldown_seconds: Optional[int] = None


class RaceOut(BaseModel):
    id: int
    name: str
    race_type: RaceType
    date: Optional[datetime]
    location: Optional[str]
    lap_distance_km: float
    lap_time_minutes: int
    rfid_cooldown_seconds: int
    is_active: bool
    is_finished: bool
    current_lap: int
    lap_start_time: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Participant ──────────────────────────────────────────────────────────────

class ParticipantCreate(BaseModel):
    name: str
    bib_number: int
    rfid_tag: Optional[str] = None


class ParticipantUpdate(BaseModel):
    name: Optional[str] = None
    rfid_tag: Optional[str] = None
    status: Optional[ParticipantStatus] = None


class LapOut(BaseModel):
    id: int
    lap_number: int
    finish_time: datetime
    lap_duration_seconds: Optional[float]
    recorded_by: str

    class Config:
        from_attributes = True


class ParticipantOut(BaseModel):
    id: int
    race_id: int
    name: str
    bib_number: int
    rfid_tag: Optional[str]
    status: ParticipantStatus
    laps_completed: int
    total_distance_km: float
    laps: List[LapOut] = []

    class Config:
        from_attributes = True


# ─── Lap ──────────────────────────────────────────────────────────────────────

class LapCreate(BaseModel):
    participant_id: int
    recorded_by: str = "manual"


class LapRegisterManual(BaseModel):
    """Manuell runderegistrering med valgfritt tidspunkt."""
    finish_time: Optional[datetime] = None  # Hvis None, brukes nåværende tid


class LapUpdate(BaseModel):
    """Oppdater tidspunkt for en eksisterende runde."""
    finish_time: datetime


class RfidRead(BaseModel):
    epc: str
    timestamp: Optional[datetime] = None


# ─── Finish (fullfør løper) ───────────────────────────────────────────────────

class FinishParticipantRequest(BaseModel):
    """Marker en løper som ferdig (RTC). Returnerer forslag på siste fullførte runde."""
    last_lap: Optional[int] = None  # Hvis None, brukes siste registrerte runde
