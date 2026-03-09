from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/rfid", tags=["rfid"])


@router.post("/read")
async def rfid_tag_read(read: schemas.RfidRead, db: Session = Depends(get_db)):
    """
    Mottar en RFID-avlesning fra Impinj-leseren (eller simulatoren).
    Finner deltakeren med matchende tag og registrerer en runde automatisk.
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

    # Unngå dobbel-registrering for samme runde
    existing_lap = (
        db.query(models.Lap)
        .filter(
            models.Lap.participant_id == participant.id,
            models.Lap.lap_number == race.current_lap
        )
        .first()
    )
    if existing_lap:
        return {"status": "ignored", "reason": "Runde allerede registrert"}

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
