from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Enum, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class RaceType(str, enum.Enum):
    BACKYARD_ULTRA = "backyard_ultra"
    TRACK_10K = "track_10k"


class RunnerStatus(str, enum.Enum):
    """
    Fullstendig statussett for Backyard Ultra.
    """
    ACTIVE_RUNNING  = "active_running"   # På løypa nå
    ACTIVE_RESTING  = "active_resting"   # Fullførte runden, hviler
    RTC             = "rtc"              # Refuse To Continue – ga seg frivillig
    DNC             = "dnc"              # Did Not Complete – kom ikke tilbake i tide
    OVER            = "over"             # Fullførte, men etter tidsgrensen
    DNS             = "dns"              # Did Not Start
    DSQ             = "dsq"              # Disqualified
    WINNER          = "winner"           # Vinner


class Race(Base):
    __tablename__ = "races"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String, nullable=False)
    race_type       = Column(Enum(RaceType), nullable=False, default=RaceType.BACKYARD_ULTRA)
    race_date       = Column(String, nullable=True)          # YYYY-MM-DD
    location        = Column(String, nullable=True)

    # ── Timing-parametere (alle konfigurerbare) ──────────────────────────────
    loop_distance_km        = Column(Float,   default=6.706)   # km per runde
    loop_duration_minutes   = Column(Integer, default=60)      # minutter per runde
    loop_start_time         = Column(String,  default="10:00:00")  # HH:MM:SS lokal tid
    chip_lockout_seconds    = Column(Integer, default=1800)    # 30 min = 1800s
    grace_period_seconds    = Column(Integer, default=0)       # ekstra sekunder etter runden
    auto_start_next_loop    = Column(Boolean, default=True)    # auto-start neste runde
    dnc_auto_assign         = Column(Boolean, default=True)    # auto-sett DNC

    # ── Løpsstatus ────────────────────────────────────────────────────────────
    is_active       = Column(Boolean, default=False)
    is_finished     = Column(Boolean, default=False)
    current_loop    = Column(Integer, default=0)
    loop_start_utc  = Column(DateTime, nullable=True)   # UTC-tidspunkt for start av nåværende runde

    created_at      = Column(DateTime, server_default=func.now())

    participants    = relationship("Participant", back_populates="race", cascade="all, delete-orphan")


class Participant(Base):
    __tablename__ = "participants"

    id          = Column(Integer, primary_key=True, index=True)
    race_id     = Column(Integer, ForeignKey("races.id"), nullable=False)

    first_name  = Column(String, nullable=False)
    last_name   = Column(String, nullable=True, default="")
    bib_number  = Column(Integer, nullable=False)
    gender      = Column(String, nullable=True)
    age         = Column(Integer, nullable=True)

    # Støtter to chip-IDer for redundans
    chip_id_1   = Column(String, nullable=True)
    chip_id_2   = Column(String, nullable=True)

    status          = Column(Enum(RunnerStatus), default=RunnerStatus.DNS)
    loops_completed = Column(Integer, default=0)
    total_km        = Column(Float, default=0.0)

    created_at  = Column(DateTime, server_default=func.now())

    race    = relationship("Race", back_populates="participants")
    splits  = relationship("Split", back_populates="participant",
                           cascade="all, delete-orphan", order_by="Split.loop_number")


class Split(Base):
    """En registrert rundepassering for en deltaker."""
    __tablename__ = "splits"

    id                  = Column(Integer, primary_key=True, index=True)
    participant_id      = Column(Integer, ForeignKey("participants.id"), nullable=False)

    loop_number         = Column(Integer, nullable=False)
    finish_time_utc     = Column(DateTime, nullable=False)
    loop_duration_secs  = Column(Float, nullable=True)
    recorded_by         = Column(String, default="manual")   # "manual", "rfid", "csv"
    is_over_time        = Column(Boolean, default=False)     # Etter tidsgrensen

    participant = relationship("Participant", back_populates="splits")


class EventLog(Base):
    """Uforanderlig hendelseslogg for alle chip-avlesninger og statusendringer."""
    __tablename__ = "event_log"

    id          = Column(Integer, primary_key=True, index=True)
    race_id     = Column(Integer, ForeignKey("races.id"), nullable=True)
    timestamp   = Column(DateTime, server_default=func.now())
    event_type  = Column(String, nullable=False)   # "chip_read", "status_change", "loop_start", etc.
    chip_id     = Column(String, nullable=True)
    bib_number  = Column(Integer, nullable=True)
    details     = Column(Text, nullable=True)      # JSON-streng med ekstra info
