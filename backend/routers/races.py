from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import json

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/races", tags=["races"])


def _log(db: Session, race_id: int, event_type: str, details: dict = None, chip_id: str = None, bib: int = None):
    entry = models.EventLog(
        race_id=race_id,
        event_type=event_type,
        chip_id=chip_id,
        bib_number=bib,
        details=json.dumps(details) if details else None
    )
    db.add(entry)


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


@router.patch("/{race_id}", response_model=schemas.RaceOut)
def update_race(race_id: int, update: schemas.RaceUpdate, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(race, field, value)
    db.commit()
    db.refresh(race)
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
    from scheduler import schedule_next_loop

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")
    if race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er allerede i gang")

    now = datetime.utcnow()
    race.is_active = True
    race.is_finished = False
    race.current_loop = 1
    race.loop_start_utc = now

    # Sett alle DNS til active_running ved start
    for p in race.participants:
        if p.status == models.RunnerStatus.DNS:
            p.status = models.RunnerStatus.ACTIVE_RUNNING

    _log(db, race_id, "loop_start", {"loop": 1, "time": now.isoformat()})
    db.commit()
    db.refresh(race)

    # Planlegg neste runde med nøyaktig starttidspunkt
    if race.auto_start_next_loop:
        schedule_next_loop(race_id, race.loop_duration_minutes, now)
        print(f"[Race] Auto-start aktivert for løp {race_id}, {race.loop_duration_minutes} min per runde")

    await manager.broadcast(race_id, {
        "event": "race_started",
        "loop": race.current_loop,
        "loop_start_utc": race.loop_start_utc.isoformat()
    })

    return race


@router.post("/{race_id}/next-loop", response_model=schemas.RaceOut)
async def next_loop(race_id: int, db: Session = Depends(get_db)):
    """Manuelt start neste runde."""
    from scheduler import schedule_next_loop, cancel_loop_job

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race or not race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er ikke aktivt")

    cancel_loop_job(race_id)
    await _advance_loop(race, db)

    if race.auto_start_next_loop:
        schedule_next_loop(race_id, race.loop_duration_minutes, race.loop_start_utc)

    return race


@router.post("/{race_id}/finish")
async def finish_race(race_id: int, db: Session = Depends(get_db)):
    from scheduler import cancel_loop_job

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    race.is_active = False
    race.is_finished = True
    _log(db, race_id, "race_finished")
    db.commit()

    cancel_loop_job(race_id)
    await manager.broadcast(race_id, {"event": "race_finished"})
    return {"ok": True}


@router.get("/{race_id}/scheduler-status")
def scheduler_status(race_id: int):
    """Sjekk status på planlagt auto-start."""
    from scheduler import get_job_info
    return get_job_info(race_id)


async def _advance_loop(race: models.Race, db: Session):
    """Intern: marker DNC og start neste runde."""
    if race.dnc_auto_assign:
        for p in race.participants:
            if p.status == models.RunnerStatus.ACTIVE_RUNNING:
                p.status = models.RunnerStatus.DNC
                _log(db, race.id, "status_change", {"status": "dnc", "auto": True}, bib=p.bib_number)

    for p in race.participants:
        if p.status == models.RunnerStatus.ACTIVE_RESTING:
            p.status = models.RunnerStatus.ACTIVE_RUNNING

    race.current_loop += 1
    race.loop_start_utc = datetime.utcnow()

    _log(db, race.id, "loop_start", {"loop": race.current_loop, "time": race.loop_start_utc.isoformat()})
    db.commit()
    db.refresh(race)

    await manager.broadcast(race.id, {
        "event": "new_loop",
        "loop": race.current_loop,
        "loop_start_utc": race.loop_start_utc.isoformat()
    })


# ─── Eksport ──────────────────────────────────────────────────────────────────

@router.get("/{race_id}/export/csv")
def export_csv(race_id: int, db: Session = Depends(get_db)):
    """Eksporter resultater og splits til CSV."""
    from fastapi.responses import StreamingResponse
    import csv, io

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    participants = (
        db.query(models.Participant)
        .filter(models.Participant.race_id == race_id)
        .order_by(models.Participant.loops_completed.desc(), models.Participant.bib_number)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)

    max_loops = max((p.loops_completed for p in participants), default=0)

    header = ["Rank", "Bib", "FirstName", "LastName", "Gender", "Age", "Status", "LoopsCompleted", "TotalKm"]
    for i in range(1, max_loops + 1):
        header.append(f"Loop{i}_Time")
        header.append(f"Loop{i}_Duration")
    writer.writerow(header)

    rank = 1
    for p in participants:
        splits_by_loop = {s.loop_number: s for s in p.splits}
        row = [
            rank, p.bib_number, p.first_name, p.last_name or "",
            p.gender or "", p.age or "", p.status.value,
            p.loops_completed, round(p.total_km, 2)
        ]
        for i in range(1, max_loops + 1):
            s = splits_by_loop.get(i)
            if s:
                row.append(s.finish_time_utc.strftime("%H:%M:%S"))
                row.append(round(s.loop_duration_secs, 1) if s.loop_duration_secs else "")
            else:
                row.extend(["", ""])
        writer.writerow(row)
        rank += 1

    output.seek(0)
    filename = f"{race.name.replace(' ', '_')}_results.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
