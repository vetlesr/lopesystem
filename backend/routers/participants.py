from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import csv, io, json

from database import get_db
import models, schemas
from ws_manager import manager

router = APIRouter(prefix="/api/races/{race_id}/participants", tags=["participants"])


def _log(db, race_id, event_type, details=None, chip_id=None, bib=None):
    entry = models.EventLog(
        race_id=race_id, event_type=event_type,
        chip_id=chip_id, bib_number=bib,
        details=json.dumps(details) if details else None
    )
    db.add(entry)


def _find_by_chip(db: Session, chip_id: str) -> models.Participant | None:
    epc = chip_id.strip().upper()
    return (
        db.query(models.Participant)
        .filter(
            (models.Participant.chip_id_1 == epc) |
            (models.Participant.chip_id_2 == epc)
        )
        .first()
    )


@router.get("/", response_model=List[schemas.ParticipantOut])
def get_participants(race_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Participant)
        .filter(models.Participant.race_id == race_id)
        .order_by(models.Participant.bib_number)
        .all()
    )


@router.post("/", response_model=schemas.ParticipantOut)
def add_participant(race_id: int, data: schemas.ParticipantCreate, db: Session = Depends(get_db)):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    existing = db.query(models.Participant).filter(
        models.Participant.race_id == race_id,
        models.Participant.bib_number == data.bib_number
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Startnummer {data.bib_number} er allerede i bruk")

    # Normaliser chip-IDer til uppercase
    payload = data.model_dump()
    if payload.get("chip_id_1"):
        payload["chip_id_1"] = payload["chip_id_1"].strip().upper()
    if payload.get("chip_id_2"):
        payload["chip_id_2"] = payload["chip_id_2"].strip().upper()

    p = models.Participant(race_id=race_id, **payload)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


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

    old_status = p.status
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(p, field, value)

    if update.status and update.status != old_status:
        _log(db, race_id, "status_change", {
            "from": old_status.value, "to": update.status.value
        }, bib=p.bib_number)

    db.commit()
    db.refresh(p)

    await manager.broadcast(race_id, {
        "event": "participant_updated",
        "participant_id": p.id,
        "status": p.status.value,
        "loops_completed": p.loops_completed
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


# ─── Splits / Timing ──────────────────────────────────────────────────────────

@router.post("/{participant_id}/split", response_model=schemas.ParticipantOut)
async def register_split(
    race_id: int, participant_id: int,
    body: schemas.SplitManual,
    db: Session = Depends(get_db)
):
    """Fast-Tap: manuell runderegistrering med valgfritt tidspunkt."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race or not race.is_active:
        raise HTTPException(status_code=400, detail="Løpet er ikke aktivt")

    p = db.query(models.Participant).filter(
        models.Participant.id == participant_id,
        models.Participant.race_id == race_id
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")

    if p.status not in (models.RunnerStatus.ACTIVE_RUNNING, models.RunnerStatus.ACTIVE_RESTING):
        raise HTTPException(status_code=400, detail=f"Deltaker har status {p.status.value}")

    # Sjekk om runden allerede er registrert
    existing = db.query(models.Split).filter(
        models.Split.participant_id == participant_id,
        models.Split.loop_number == race.current_loop
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Runde allerede registrert")

    finish_time = body.finish_time_utc or datetime.utcnow()

    # Sjekk om over tidsgrensen
    is_over = False
    if race.loop_start_utc:
        deadline_secs = race.loop_duration_minutes * 60 + race.grace_period_seconds
        elapsed = (finish_time - race.loop_start_utc).total_seconds()
        is_over = elapsed > deadline_secs

    duration = (finish_time - race.loop_start_utc).total_seconds() if race.loop_start_utc else None

    split = models.Split(
        participant_id=participant_id,
        loop_number=race.current_loop,
        finish_time_utc=finish_time,
        loop_duration_secs=duration,
        recorded_by="manual",
        is_over_time=is_over
    )
    db.add(split)

    if is_over:
        p.status = models.RunnerStatus.OVER
    else:
        p.status = models.RunnerStatus.ACTIVE_RESTING
        p.loops_completed += 1
        p.total_km = p.loops_completed * race.loop_distance_km

    _log(db, race_id, "split_recorded", {
        "loop": race.current_loop, "time": finish_time.isoformat(),
        "manual": True, "over": is_over
    }, bib=p.bib_number)
    db.commit()
    db.refresh(p)

    await manager.broadcast(race_id, {
        "event": "split_recorded",
        "participant_id": p.id,
        "participant_name": f"{p.first_name} {p.last_name}".strip(),
        "bib_number": p.bib_number,
        "loop_number": race.current_loop,
        "loops_completed": p.loops_completed,
        "is_over_time": is_over,
        "recorded_by": "manual"
    })

    # Sjekk vinner-tilstand: kun én aktiv løper igjen
    active = [x for x in race.participants if x.status in (
        models.RunnerStatus.ACTIVE_RUNNING, models.RunnerStatus.ACTIVE_RESTING
    )]
    if len(active) == 1 and not is_over:
        await manager.broadcast(race_id, {
            "event": "potential_winner",
            "participant_id": active[0].id,
            "participant_name": f"{active[0].first_name} {active[0].last_name}".strip()
        })

    return p


@router.patch("/{participant_id}/splits/{split_id}", response_model=schemas.SplitOut)
async def edit_split(
    race_id: int, participant_id: int, split_id: int,
    body: schemas.SplitUpdate,
    db: Session = Depends(get_db)
):
    """Rediger tidspunkt for en eksisterende split."""
    split = db.query(models.Split).filter(
        models.Split.id == split_id,
        models.Split.participant_id == participant_id
    ).first()
    if not split:
        raise HTTPException(status_code=404, detail="Split ikke funnet")

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    split.finish_time_utc = body.finish_time_utc
    if race and race.loop_start_utc:
        split.loop_duration_secs = (body.finish_time_utc - race.loop_start_utc).total_seconds()

    _log(db, race_id, "split_edited", {"split_id": split_id, "new_time": body.finish_time_utc.isoformat()})
    db.commit()
    db.refresh(split)

    await manager.broadcast(race_id, {"event": "split_edited", "participant_id": participant_id})
    return split


@router.delete("/{participant_id}/splits/{split_id}")
async def delete_split(
    race_id: int, participant_id: int, split_id: int,
    db: Session = Depends(get_db)
):
    """Slett en feilregistrert split (Undo)."""
    split = db.query(models.Split).filter(
        models.Split.id == split_id,
        models.Split.participant_id == participant_id
    ).first()
    if not split:
        raise HTTPException(status_code=404, detail="Split ikke funnet")

    p = db.query(models.Participant).filter(models.Participant.id == participant_id).first()
    race = db.query(models.Race).filter(models.Race.id == race_id).first()

    if p and not split.is_over_time and p.loops_completed > 0:
        p.loops_completed -= 1
        p.total_km = p.loops_completed * (race.loop_distance_km if race else 6.706)
        p.status = models.RunnerStatus.ACTIVE_RUNNING

    _log(db, race_id, "split_deleted", {"split_id": split_id, "loop": split.loop_number})
    db.delete(split)
    db.commit()

    await manager.broadcast(race_id, {"event": "split_deleted", "participant_id": participant_id})
    return {"ok": True}


# ─── Mass RTC ─────────────────────────────────────────────────────────────────

@router.post("/mass-rtc")
async def mass_rtc(race_id: int, body: schemas.MassRtcRequest, db: Session = Depends(get_db)):
    """
    Sett alle resting-løpere som IKKE er i bib_numbers-listen til RTC.
    Brukes ved start av ny runde: Race Director krysser av hvem som IKKE møtte opp.
    """
    resting = db.query(models.Participant).filter(
        models.Participant.race_id == race_id,
        models.Participant.status == models.RunnerStatus.ACTIVE_RESTING
    ).all()

    changed = []
    for p in resting:
        if p.bib_number not in body.bib_numbers:
            p.status = models.RunnerStatus.RTC
            _log(db, race_id, "status_change", {"from": "active_resting", "to": "rtc", "mass": True}, bib=p.bib_number)
            changed.append(p.bib_number)

    db.commit()

    await manager.broadcast(race_id, {"event": "mass_rtc", "bibs": changed})
    return {"ok": True, "changed": changed}


# ─── CSV-import ───────────────────────────────────────────────────────────────

@router.post("/csv-preview")
async def csv_preview(
    race_id: int,
    file: UploadFile = File(...),
):
    """Les CSV og returner kolonnenavn + første 5 rader som forhåndsvisning."""
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    rows = []
    for i, row in enumerate(reader):
        if i >= 5:
            break
        rows.append(dict(row))
    return {"headers": headers, "preview": rows}


@router.post("/csv-import")
async def csv_import(
    race_id: int,
    mapping: str,   # JSON-streng med CsvColumnMapping
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Importer deltakere fra CSV med angitt kolonnemapping."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Løp ikke funnet")

    col_map = schemas.CsvColumnMapping(**json.loads(mapping))
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    added, skipped = 0, 0
    for row in reader:
        try:
            bib = int(row[col_map.bib_col])
        except (KeyError, ValueError):
            skipped += 1
            continue

        # Hopp over duplikater
        if db.query(models.Participant).filter(
            models.Participant.race_id == race_id,
            models.Participant.bib_number == bib
        ).first():
            skipped += 1
            continue

        chip1 = row.get(col_map.chip_id_1_col, "").strip().upper() if col_map.chip_id_1_col else None
        chip2 = row.get(col_map.chip_id_2_col, "").strip().upper() if col_map.chip_id_2_col else None

        p = models.Participant(
            race_id=race_id,
            first_name=row.get(col_map.first_name_col, "").strip() or f"Runner{bib}",
            last_name=row.get(col_map.last_name_col, "").strip() if col_map.last_name_col else "",
            bib_number=bib,
            gender=row.get(col_map.gender_col, "").strip() if col_map.gender_col else None,
            age=int(row[col_map.age_col]) if col_map.age_col and row.get(col_map.age_col, "").isdigit() else None,
            chip_id_1=chip1 or None,
            chip_id_2=chip2 or None,
        )
        db.add(p)
        added += 1

    db.commit()
    return {"ok": True, "added": added, "skipped": skipped}
