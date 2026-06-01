from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from models import RaceType, RunnerStatus


# ─── Race ────────────────────────────────────────────────────────────────────

class RaceCreate(BaseModel):
    name: str
    race_type: RaceType = RaceType.BACKYARD_ULTRA
    race_date: Optional[str] = None           # YYYY-MM-DD
    location: Optional[str] = None

    # Timing-parametere
    loop_distance_km:       float   = Field(6.706,  description="km per runde")
    loop_duration_minutes:  int     = Field(60,     description="Minutter per runde")
    loop_start_time:        str     = Field("10:00:00", description="HH:MM:SS lokal starttid")
    chip_lockout_seconds:   int     = Field(1800,   description="Sekunder mellom gyldige chip-avlesninger")
    grace_period_seconds:   int     = Field(0,      description="Ekstra sekunder etter runden")
    auto_start_next_loop:   bool    = Field(True,   description="Auto-start neste runde")
    dnc_auto_assign:        bool    = Field(True,   description="Auto-sett DNC ved runde-slutt")


class RaceUpdate(BaseModel):
    name:                   Optional[str]   = None
    race_date:              Optional[str]   = None
    location:               Optional[str]   = None
    loop_distance_km:       Optional[float] = None
    loop_duration_minutes:  Optional[int]   = None
    loop_start_time:        Optional[str]   = None
    chip_lockout_seconds:   Optional[int]   = None
    grace_period_seconds:   Optional[int]   = None
    auto_start_next_loop:   Optional[bool]  = None
    dnc_auto_assign:        Optional[bool]  = None


class RaceOut(BaseModel):
    id:                     int
    name:                   str
    race_type:              RaceType
    race_date:              Optional[str]
    location:               Optional[str]
    loop_distance_km:       float
    loop_duration_minutes:  int
    loop_start_time:        str
    chip_lockout_seconds:   int
    grace_period_seconds:   int
    auto_start_next_loop:   bool
    dnc_auto_assign:        bool
    is_active:              bool
    is_finished:            bool
    current_loop:           int
    loop_start_utc:         Optional[datetime]
    created_at:             datetime

    class Config:
        from_attributes = True


# ─── Participant ──────────────────────────────────────────────────────────────

class ParticipantCreate(BaseModel):
    first_name:     str
    last_name:      Optional[str]   = ""
    bib_number:     int
    gender:         Optional[str]   = None
    age:            Optional[int]   = None
    chip_id_1:      Optional[str]   = None
    chip_id_2:      Optional[str]   = None


class ParticipantUpdate(BaseModel):
    first_name:     Optional[str]   = None
    last_name:      Optional[str]   = None
    bib_number:     Optional[int]   = None
    gender:         Optional[str]   = None
    age:            Optional[int]   = None
    chip_id_1:      Optional[str]   = None
    chip_id_2:      Optional[str]   = None
    status:         Optional[RunnerStatus] = None
    loops_completed: Optional[int]  = None


class SplitOut(BaseModel):
    id:                 int
    loop_number:        int
    finish_time_utc:    datetime
    loop_duration_secs: Optional[float]
    recorded_by:        str
    is_over_time:       bool

    class Config:
        from_attributes = True


class ParticipantOut(BaseModel):
    id:             int
    race_id:        int
    first_name:     str
    last_name:      Optional[str]
    bib_number:     int
    gender:         Optional[str]
    age:            Optional[int]
    chip_id_1:      Optional[str]
    chip_id_2:      Optional[str]
    status:         RunnerStatus
    loops_completed: int
    total_km:       float
    splits:         List[SplitOut] = []

    class Config:
        from_attributes = True


# ─── Split / Timing ───────────────────────────────────────────────────────────

class SplitManual(BaseModel):
    """Manuell registrering av en runde (Fast-Tap)."""
    finish_time_utc: Optional[datetime] = None   # None = bruk nåværende tid


class SplitUpdate(BaseModel):
    finish_time_utc: datetime


# ─── RFID ─────────────────────────────────────────────────────────────────────

class ChipRead(BaseModel):
    chip_id:    str
    timestamp:  Optional[datetime] = None


# ─── Status-endring ───────────────────────────────────────────────────────────

class StatusChange(BaseModel):
    status:         RunnerStatus
    loops_completed: Optional[int] = None   # Valgfri overstyring


# ─── CSV-import ───────────────────────────────────────────────────────────────

class CsvColumnMapping(BaseModel):
    bib_col:        str = "Bib"
    first_name_col: str = "FirstName"
    last_name_col:  str = "LastName"
    gender_col:     Optional[str] = "Gender"
    age_col:        Optional[str] = "Age"
    chip_id_1_col:  Optional[str] = "ChipID"
    chip_id_2_col:  Optional[str] = None


# ─── Mass RTC ─────────────────────────────────────────────────────────────────

class MassRtcRequest(BaseModel):
    """Sett alle løpere som ikke møtte opp til start som RTC."""
    bib_numbers: List[int]   # Bibs som IKKE møtte opp (settes til RTC)
