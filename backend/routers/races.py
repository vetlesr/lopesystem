from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/races", tags=["races"])


@router.get("/", response_model=List[schemas.RaceOut])
def get_races(db: Session = Depends(get_db)):
    return db.query(models.Race).order_by(models.Race.created_at.desc()).all()


@router.post("/", response_model=schemas.RaceOut)
def create_race(race: schemas.RaceCreate, db: Session = Depends(get_db)):
    db_race = models.Race(**race.model_dump())
    db.add(db_race)
    db.commit()
    db.refresh(db_race)
    return db_race


@router.get("/{race_id}", response_model=schemas.RaceOut)
def get_race(race_id: int, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")
    return race


@router.delete("/{race_id}")
def delete_race(race_id: int, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")
    db.delete(race)
    db.commit()
    return {"ok": True}


@router.post("/{race_id}/start", response_model=schemas.RaceOut)
async def start_race(race_id: int, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")
    if race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er allerede i gang")

    race.is_active = True
    race.is_finished = False
    race.current_lap = 1
    race.lap_start_time = datetime.utcnow()

    # Sett alle deltakere til aktive
    for p in race.participants:
        p.status = models.ParticipantStatus.ACTIVE

    db.commit()
    db.refresh(race)

    await manager.broadcast_race_update(race_id, {
        "event": "race_started",
        "lap": race.current_lap,
        "lap_start_time": race.lap_start_time.isoformat()
    })

    return race


@router.post("/{race_id}/next-lap", response_model=schemas.RaceOut)
async def next_lap(race_id: int, db: Session = Depends(get_db)):
    """Manuelt start neste runde (automatiseres av scheduler i produksjon)."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race or not race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er ikke aktivt")

    # Marker løpere som ikke fullførte runden som DNF
    for p in race.participants:
        if p.status == models.ParticipantStatus.ACTIVE:
            if p.laps_completed < race.current_lap:
                p.status = models.ParticipantStatus.DNF

    race.current_lap += 1
    race.lap_start_time = datetime.utcnow()
    db.commit()
    db.refresh(race)

    await manager.broadcast_race_update(race_id, {
        "event": "new_lap",
        "lap": race.current_lap,
        "lap_start_time": race.lap_start_time.isoformat()
    })

    return race


@router.post("/{race_id}/finish")
async def finish_race(race_id: int, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    race.is_active = False
    race.is_finished = True
    db.commit()

    await manager.broadcast_race_update(race_id, {"event": "race_finished"})
    return {"ok": True}
