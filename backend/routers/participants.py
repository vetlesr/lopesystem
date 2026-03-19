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
async def register_lap(
    race_id: int,
    participant_id: int,
    body: schemas.LapRegisterManual,
    db: Session = Depends(get_db)
):
    """
    Manuell runderegistrering.
    Valgfritt: send finish_time for å sette eksakt tidspunkt (f.eks. fra stoppeklokke).
    Hvis finish_time ikke sendes, brukes nåværende tid.
    """
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

    # Sjekk om runden allerede er registrert
    existing_lap = (
        db.query(models.Lap)
        .filter(models.Lap.participant_id == participant_id, models.Lap.lap_number == race.current_lap)
        .first()
    )
    if existing_lap:
        raise HTTPException(status_code=400, detail="Runde allerede registrert for denne løperen")

    finish_time = body.finish_time if body.finish_time else datetime.utcnow()
    lap_number = race.current_lap

    duration = None
    if race.lap_start_time:
        duration = (finish_time - race.lap_start_time).total_seconds()

    lap = models.Lap(
        participant_id=participant_id,
        lap_number=lap_number,
        finish_time=finish_time,
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


@router.patch("/{participant_id}/laps/{lap_id}", response_model=schemas.LapOut)
async def edit_lap(
    race_id: int,
    participant_id: int,
    lap_id: int,
    body: schemas.LapUpdate,
    db: Session = Depends(get_db)
):
    """Rediger tidspunktet for en eksisterende runde."""
    lap = db.query(models.Lap).filter(
        models.Lap.id == lap_id,
        models.Lap.participant_id == participant_id
    ).first()
    if not lap:
        raise HTTPException(status_code=404, detail="Runde ikke funnet")

    race = db.query(models.Race).filter(models.Race.id == race_id).first()

    lap.finish_time = body.finish_time
    if race and race.lap_start_time:
        lap.lap_duration_seconds = (body.finish_time - race.lap_start_time).total_seconds()

    db.commit()
    db.refresh(lap)

    await manager.broadcast_race_update(race_id, {
        "event": "lap_edited",
        "participant_id": participant_id,
        "lap_id": lap_id
    })

    return lap


@router.delete("/{participant_id}/laps/{lap_id}")
async def delete_lap(
    race_id: int,
    participant_id: int,
    lap_id: int,
    db: Session = Depends(get_db)
):
    """Slett en feilregistrert runde."""
    lap = db.query(models.Lap).filter(
        models.Lap.id == lap_id,
        models.Lap.participant_id == participant_id
    ).first()
    if not lap:
        raise HTTPException(status_code=404, detail="Runde ikke funnet")

    p = db.query(models.Participant).filter(models.Participant.id == participant_id).first()
    if p and p.laps_completed > 0:
        p.laps_completed -= 1
        p.total_distance_km = p.laps_completed * (
            db.query(models.Race).filter(models.Race.id == race_id).first().lap_distance_km
        )

    db.delete(lap)
    db.commit()

    await manager.broadcast_race_update(race_id, {
        "event": "lap_deleted",
        "participant_id": participant_id,
        "lap_id": lap_id
    })

    return {"ok": True}


@router.post("/{participant_id}/finish", response_model=schemas.ParticipantOut)
async def finish_participant(
    race_id: int,
    participant_id: int,
    body: schemas.FinishParticipantRequest,
    db: Session = Depends(get_db)
):
    """
    Marker en løper som ferdig (RTC – Refuse To Continue).
    Returnerer deltakeren med siste registrerte runde som forslag.
    Hvis last_lap er oppgitt, brukes det som siste fullførte runde.
    """
    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")

    if body.last_lap is not None:
        # Sett laps_completed til oppgitt verdi
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        p.laps_completed = body.last_lap
        p.total_distance_km = body.last_lap * race.lap_distance_km

    p.status = models.ParticipantStatus.RTC
    db.commit()
    db.refresh(p)

    await manager.broadcast_race_update(race_id, {
        "event": "participant_finished",
        "participant_id": p.id,
        "participant_name": p.name,
        "laps_completed": p.laps_completed,
        "status": "rtc"
    })

    return p


@router.get("/{participant_id}/last-lap")
def get_last_lap(race_id: int, participant_id: int, db: Session = Depends(get_db)):
    """Hent siste registrerte runde for en deltaker (brukes som forslag ved fullfør)."""
    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")

    last_lap = (
        db.query(models.Lap)
        .filter(models.Lap.participant_id == participant_id)
        .order_by(models.Lap.lap_number.desc())
        .first()
    )

    return {
        "participant_id": participant_id,
        "laps_completed": p.laps_completed,
        "last_lap_number": last_lap.lap_number if last_lap else 0,
        "last_finish_time": last_lap.finish_time.isoformat() if last_lap else None
    }
