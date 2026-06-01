from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime
import time, json

from database import get_db
import models
from schemas import ChipRead
from ws_manager import manager

router = APIRouter(prefix="/api/rfid", tags=["rfid"])

# In-memory cooldown: { chip_id_upper: last_valid_read_unix_ts }
_last_valid_read: dict[str, float] = {}


@router.post("/read")
async def chip_read(read: ChipRead, db: Session = Depends(get_db)):
    """
    Prosesserer en chip-avlesning gjennom Backyard Ultra-logikken:
    1. Kjent chip?
    2. Løper aktiv?
    3. Innenfor lockout-perioden?
    4. Etter tidsgrensen (OVER)?
    5. Gyldig runde-finish.
    """
    chip_id = read.chip_id.strip().upper()
    timestamp = read.timestamp or datetime.utcnow()

    def _log_event(db, race_id, event_type, details=None, bib=None):
        entry = models.EventLog(
            race_id=race_id, event_type=event_type,
            chip_id=chip_id, bib_number=bib,
            details=json.dumps(details) if details else None
        )
        db.add(entry)
        db.commit()

    # ── 1. Kjent chip? ────────────────────────────────────────────────────────
    participant = db.query(models.Participant).filter(
        (models.Participant.chip_id_1 == chip_id) |
        (models.Participant.chip_id_2 == chip_id)
    ).first()

    if not participant:
        _log_event(db, None, "unknown_chip", {"chip_id": chip_id})
        await manager.broadcast_all({"event": "unknown_chip", "chip_id": chip_id})
        return {"status": "unknown_chip", "chip_id": chip_id}

    race = db.query(models.Race).filter(models.Race.id == participant.race_id).first()

    if not race or not race.is_active:
        return {"status": "ignored", "reason": "Løpet er ikke aktivt"}

    # ── 2. Løper aktiv? ───────────────────────────────────────────────────────
    if participant.status not in (models.RunnerStatus.ACTIVE_RUNNING, models.RunnerStatus.ACTIVE_RESTING):
        _log_event(db, race.id, "chip_ignored", {"reason": "not_active", "status": participant.status.value}, bib=participant.bib_number)
        return {"status": "ignored", "reason": f"Løper har status {participant.status.value}"}

    # ── 3. Lockout-periode? ───────────────────────────────────────────────────
    now_ts = time.time()
    last_ts = _last_valid_read.get(chip_id, 0)
    if (now_ts - last_ts) < race.chip_lockout_seconds:
        remaining = int(race.chip_lockout_seconds - (now_ts - last_ts))
        _log_event(db, race.id, "chip_lockout", {"remaining_secs": remaining}, bib=participant.bib_number)
        return {"status": "lockout", "remaining_seconds": remaining}

    # ── 4. Sjekk om runden allerede er registrert ─────────────────────────────
    existing = db.query(models.Split).filter(
        models.Split.participant_id == participant.id,
        models.Split.loop_number == race.current_loop
    ).first()
    if existing:
        _last_valid_read[chip_id] = now_ts
        return {"status": "ignored", "reason": "Runde allerede registrert"}

    # ── 5. Over tidsgrensen? ──────────────────────────────────────────────────
    is_over = False
    duration = None
    if race.loop_start_utc:
        elapsed = (timestamp - race.loop_start_utc).total_seconds()
        deadline = race.loop_duration_minutes * 60 + race.grace_period_seconds
        is_over = elapsed > deadline
        duration = elapsed

    # ── 6. Registrer split ────────────────────────────────────────────────────
    _last_valid_read[chip_id] = now_ts

    split = models.Split(
        participant_id=participant.id,
        loop_number=race.current_loop,
        finish_time_utc=timestamp,
        loop_duration_secs=duration,
        recorded_by="rfid",
        is_over_time=is_over
    )
    db.add(split)

    if is_over:
        participant.status = models.RunnerStatus.OVER
    else:
        participant.status = models.RunnerStatus.ACTIVE_RESTING
        participant.loops_completed += 1
        participant.total_km = participant.loops_completed * race.loop_distance_km

    _log_event(db, race.id, "chip_read_valid", {
        "loop": race.current_loop, "over": is_over, "duration": duration
    }, bib=participant.bib_number)

    db.commit()

    await manager.broadcast(race.id, {
        "event": "split_recorded",
        "participant_id": participant.id,
        "participant_name": f"{participant.first_name} {participant.last_name}".strip(),
        "bib_number": participant.bib_number,
        "loop_number": race.current_loop,
        "loops_completed": participant.loops_completed,
        "is_over_time": is_over,
        "recorded_by": "rfid"
    })

    # Sjekk vinner-tilstand
    active = [p for p in race.participants if p.status in (
        models.RunnerStatus.ACTIVE_RUNNING, models.RunnerStatus.ACTIVE_RESTING
    )]
    if len(active) == 1 and not is_over:
        await manager.broadcast(race.id, {
            "event": "potential_winner",
            "participant_id": active[0].id,
            "participant_name": f"{active[0].first_name} {active[0].last_name}".strip()
        })

    return {
        "status": "over_time" if is_over else "ok",
        "participant": f"{participant.first_name} {participant.last_name}".strip(),
        "bib_number": participant.bib_number,
        "loop_number": race.current_loop,
        "loops_completed": participant.loops_completed,
        "is_over_time": is_over
    }


@router.get("/debug")
def debug_lockout():
    """Vis lockout-status for alle chips (debugging)."""
    now_ts = time.time()
    return {
        chip: {
            "last_read_secs_ago": int(now_ts - ts),
            "last_read_at": datetime.utcfromtimestamp(ts).isoformat()
        }
        for chip, ts in _last_valid_read.items()
    }
