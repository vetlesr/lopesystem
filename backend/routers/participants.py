from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/races/{race_id}/participants", tags=["participants"])


@router.get("/", response_model=List[schemas.ParticipantOut])
def get_participants(race_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Participant)
        .filter(models.Participant.race_id == race_id)
        .order_by(models.Participant.bib_number)
        .all()
    )


@router.post("/", response_model=schemas.ParticipantOut)
def add_participant(race_id: int, participant: schemas.ParticipantCreate, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    # Sjekk om startnummer allerede er i bruk
    existing = (
        db.query(models.Participant)
        .filter(models.Participant.race_id == race_id, models.Participant.bib_number == participant.bib_number)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"Startnummer {participant.bib_number} er allerede i bruk")

    db_participant = models.Participant(race_id=race_id, **participant.model_dump())
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant


@router.patch("/{participant_id}", response_model=schemas.ParticipantOut)
async def update_participant(
    race_id: int, participant_id: int,
    update: schemas.ParticipantUpdate,
    db: Session = Depends(get_db)
):
    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")

    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(p, field, value)

    db.commit()
    db.refresh(p)

    await manager.broadcast_race_update(race_id, {
        "event": "participant_updated",
        "participant_id": p.id,
        "status": p.status.value
    })

    return p


@router.delete("/{participant_id}")
def remove_participant(race_id: int, participant_id: int, db: Session = Depends(get_db)):
    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/{participant_id}/lap", response_model=schemas.ParticipantOut)
async def register_lap(race_id: int, participant_id: int, db: Session = Depends(get_db)):
    """Manuell runderegistrering."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race or not race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er ikke aktivt")

    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")
    if p.status != models.ParticipantStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"Deltaker har status {p.status.value}")

    now = datetime.utcnow()
    lap_number = race.current_lap

    # Beregn rundetid
    duration = None
    if race.lap_start_time:
        duration = (now - race.lap_start_time).total_seconds()

    lap = models.Lap(
        participant_id=participant_id,
        lap_number=lap_number,
        finish_time=now,
        lap_duration_seconds=duration,
        recorded_by="manual"
    )
    db.add(lap)

    p.laps_completed += 1
    p.total_distance_km = p.laps_completed * race.lap_distance_km

    db.commit()
    db.refresh(p)

    await manager.broadcast_race_update(race_id, {
        "event": "lap_registered",
        "participant_id": p.id,
        "participant_name": p.name,
        "bib_number": p.bib_number,
        "lap_number": lap_number,
        "laps_completed": p.laps_completed,
        "lap_duration_seconds": duration,
        "recorded_by": "manual"
    })

    return p
