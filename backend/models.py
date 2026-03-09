from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class RaceType(str, enum.Enum):
    BACKYARD_ULTRA = "backyard_ultra"
    TRACK_10K = "track_10k"


class ParticipantStatus(str, enum.Enum):
    ACTIVE = "active"          # Løper fremdeles
    FINISHED = "finished"      # Fullførte siste runde som "Last One Standing"
    RTC = "rtc"                # Refuse To Continue – ga seg frivillig
    DNF = "dnf"                # Did Not Finish – kom ikke tilbake i tide
    DNS = "dns"                # Did Not Start


class Race(Base):
    __tablename__ = "races"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    race_type = Column(Enum(RaceType), nullable=False, default=RaceType.BACKYARD_ULTRA)
    date = Column(DateTime, nullable=True)
    location = Column(String, nullable=True)

    # Backyard Ultra-spesifikke felt
    lap_distance_km = Column(Float, default=6.706)   # Standard BYU-distanse
    lap_time_minutes = Column(Integer, default=60)    # Minutter per runde

    # Status
    is_active = Column(Boolean, default=False)        # Løpet er i gang
    is_finished = Column(Boolean, default=False)      # Løpet er avsluttet
    current_lap = Column(Integer, default=0)          # Gjeldende rundenummer
    lap_start_time = Column(DateTime, nullable=True)  # Når nåværende runde startet

    created_at = Column(DateTime, server_default=func.now())

    participants = relationship("Participant", back_populates="race", cascade="all, delete-orphan")


class Participant(Base):
    __tablename__ = "participants"

    id = Column(Integer, primary_key=True, index=True)
    race_id = Column(Integer, ForeignKey("races.id"), nullable=False)

    name = Column(String, nullable=False)
    bib_number = Column(Integer, nullable=False)
    rfid_tag = Column(String, nullable=True)          # EPC fra RFID-tag

    status = Column(Enum(ParticipantStatus), default=ParticipantStatus.DNS)
    laps_completed = Column(Integer, default=0)
    total_distance_km = Column(Float, default=0.0)

    created_at = Column(DateTime, server_default=func.now())

    race = relationship("Race", back_populates="participants")
    laps = relationship("Lap", back_populates="participant", cascade="all, delete-orphan")


class Lap(Base):
    __tablename__ = "laps"

    id = Column(Integer, primary_key=True, index=True)
    participant_id = Column(Integer, ForeignKey("participants.id"), nullable=False)

    lap_number = Column(Integer, nullable=False)
    finish_time = Column(DateTime, nullable=False)    # Tidspunkt for målpassering
    lap_duration_seconds = Column(Float, nullable=True)  # Tid brukt på runden
    recorded_by = Column(String, default="manual")   # "manual" eller "rfid"

    participant = relationship("Participant", back_populates="laps")
