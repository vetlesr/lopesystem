from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import time

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/rfid", tags=["rfid"])

# In-memory cooldown-register: { epc: last_seen_unix_timestamp }
_last_seen: dict[str, float] = {}


@router.post("/read")
async def rfid_tag_read(read: schemas.RfidRead, db: Session = Depends(get_db)):
    """
    Mottar en RFID-avlesning fra Impinj-leseren (eller simulatoren).
    Finner deltakeren med matchende tag og registrerer en runde automatisk.
    Cooldown-perioden hentes fra løpets innstillinger (rfid_cooldown_seconds).
    """
    epc = read.epc.strip().upper()
    timestamp = read.timestamp or datetime.utcnow()

    # Finn deltaker med denne RFID-tagen
    participant = (
        db.query(models.Participant)
        .filter(models.Participant.rfid_tag == epc)
        .first()
    )

    if not participant:
        return {"status": "ignored", "reason": f"Ingen deltaker med tag {epc}"}

    race = db.query(models.Race).filter(models.Race.id == participant.race_id).first()

    if not race or not race.is_active:
        return {"status": "ignored", "reason": "Løpet er ikke aktivt"}

    if participant.status != models.ParticipantStatus.ACTIVE:
        return {"status": "ignored", "reason": f"Deltaker har status {participant.status.value}"}

    # Cooldown-sjekk: unngå dobbel-registrering
    cooldown = race.rfid_cooldown_seconds
    now_ts = time.time()
    last_ts = _last_seen.get(epc, 0)
    if (now_ts - last_ts) < cooldown:
        remaining = int(cooldown - (now_ts - last_ts))
        return {
            "status": "cooldown",
            "reason": f"Tag {epc[-6:]} lest for {int(now_ts - last_ts)}s siden – cooldown {cooldown}s ({remaining}s igjen)"
        }

    # Unngå dobbel-registrering for samme runde i databasen
    existing_lap = (
        db.query(models.Lap)
        .filter(
            models.Lap.participant_id == participant.id,
            models.Lap.lap_number == race.current_lap
        )
        .first()
    )
    if existing_lap:
        _last_seen[epc] = now_ts
        return {"status": "ignored", "reason": "Runde allerede registrert"}

    # Oppdater cooldown-register
    _last_seen[epc] = now_ts

    # Beregn rundetid
    duration = None
    if race.lap_start_time:
        duration = (timestamp - race.lap_start_time).total_seconds()

    lap = models.Lap(
        participant_id=participant.id,
        lap_number=race.current_lap,
        finish_time=timestamp,
        lap_duration_seconds=duration,
        recorded_by="rfid"
    )
    db.add(lap)

    participant.laps_completed += 1
    participant.total_distance_km = participant.laps_completed * race.lap_distance_km

    db.commit()

    await manager.broadcast_race_update(race.id, {
        "event": "lap_registered",
        "participant_id": participant.id,
        "participant_name": participant.name,
        "bib_number": participant.bib_number,
        "lap_number": race.current_lap,
        "laps_completed": participant.laps_completed,
        "lap_duration_seconds": duration,
        "recorded_by": "rfid"
    })

    return {
        "status": "ok",
        "participant": participant.name,
        "lap_number": race.current_lap,
        "laps_completed": participant.laps_completed
    }


@router.get("/cooldown-status")
def get_cooldown_status():
    """Se hvilke tags som er i cooldown (for debugging)."""
    now_ts = time.time()
    return {
        epc: {
            "last_seen_seconds_ago": int(now_ts - ts),
            "last_seen_at": datetime.utcfromtimestamp(ts).isoformat()
        }
        for epc, ts in _last_seen.items()
    }
