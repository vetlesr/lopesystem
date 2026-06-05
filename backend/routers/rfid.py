from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import time, json

from database import get_db
import models
from schemas import ChipRead
from ws_manager import manager

router = APIRouter(prefix="/api/rfid", tags=["rfid"])

# In-memory lockout: { chip_id_upper: last_valid_read_unix_ts }
_last_valid_read: dict[str, float] = {}

# Inaktive chip-avlesninger: f"{race_id}_{chip_id}" → dict
_inactive_chip_log: dict[str, dict] = {}


def _log_event(db, race_id, event_type, details=None, bib=None, chip_id=None):
    entry = models.EventLog(
        race_id=race_id, event_type=event_type,
        chip_id=chip_id, bib_number=bib,
        details=json.dumps(details) if details else None
    )
    db.add(entry)
    db.commit()


@router.post("/read")
async def chip_read(read: ChipRead, db: Session = Depends(get_db)):
    """
    Prosesserer en chip-avlesning:
    1. Kjent chip?
    2. Løper aktiv? → Hvis ikke: logg til inaktiv-liste og varsle via WS
    3. Lockout-periode?
    4. Runde allerede registrert?
    5. Over tidsgrensen (OVER)?
    6. Registrer split
    """
    chip_id = read.chip_id.strip().upper()
    timestamp = read.timestamp or datetime.utcnow()

    # ── 1. Kjent chip? ────────────────────────────────────────────────────────
    participant = db.query(models.Participant).filter(
        (models.Participant.chip_id_1 == chip_id) |
        (models.Participant.chip_id_2 == chip_id)
    ).first()

    if not participant:
        _log_event(db, None, "unknown_chip", {"chip_id": chip_id}, chip_id=chip_id)
        await manager.broadcast_all({"event": "unknown_chip", "chip_id": chip_id})
        return {"status": "unknown_chip", "chip_id": chip_id}

    race = db.query(models.Race).filter(models.Race.id == participant.race_id).first()
    if not race or not race.is_active:
        return {"status": "ignored", "reason": "Løpet er ikke aktivt"}

    # ── 2. Løper aktiv? ───────────────────────────────────────────────────────
    if participant.status not in (models.RunnerStatus.ACTIVE_RUNNING, models.RunnerStatus.ACTIVE_RESTING):
        # Logg til inaktiv-chip-liste (med lockout for inaktive også)
        now_ts = time.time()
        inactive_key = f"inactive_{chip_id}"
        last_inactive_ts = _last_valid_read.get(inactive_key, 0)

        if (now_ts - last_inactive_ts) >= race.chip_lockout_seconds:
            _last_valid_read[inactive_key] = now_ts
            log_key = f"{race.id}_{chip_id}"
            if log_key not in _inactive_chip_log:
                _inactive_chip_log[log_key] = {
                    "chip_id": chip_id,
                    "race_id": race.id,
                    "participant_id": participant.id,
                    "participant_name": f"{participant.first_name} {participant.last_name or ''}".strip(),
                    "bib_number": participant.bib_number,
                    "status": participant.status.value,
                    "loops_completed": participant.loops_completed,
                    "first_seen": timestamp.isoformat(),
                    "last_seen": timestamp.isoformat(),
                    "count": 1
                }
            else:
                _inactive_chip_log[log_key]["last_seen"] = timestamp.isoformat()
                _inactive_chip_log[log_key]["count"] += 1
                _inactive_chip_log[log_key]["status"] = participant.status.value

            await manager.broadcast(race.id, {
                "event": "inactive_chip_detected",
                "chip_id": chip_id,
                "participant_id": participant.id,
                "participant_name": _inactive_chip_log[log_key]["participant_name"],
                "bib_number": participant.bib_number,
                "status": participant.status.value,
                "loops_completed": participant.loops_completed,
                "count": _inactive_chip_log[log_key]["count"]
            })

        _log_event(db, race.id, "chip_ignored",
                   {"reason": "not_active", "status": participant.status.value},
                   bib=participant.bib_number, chip_id=chip_id)
        return {"status": "inactive_logged", "reason": f"Løper har status {participant.status.value}"}

    # ── 3. Lockout-periode? ───────────────────────────────────────────────────
    now_ts = time.time()
    last_ts = _last_valid_read.get(chip_id, 0)
    if (now_ts - last_ts) < race.chip_lockout_seconds:
        remaining = int(race.chip_lockout_seconds - (now_ts - last_ts))
        _log_event(db, race.id, "chip_lockout", {"remaining_secs": remaining},
                   bib=participant.bib_number, chip_id=chip_id)
        return {"status": "lockout", "remaining_seconds": remaining}

    # ── 4. Runde allerede registrert? ─────────────────────────────────────────
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

    _log_event(db, race.id, "chip_read_valid",
               {"loop": race.current_loop, "over": is_over, "duration": duration},
               bib=participant.bib_number, chip_id=chip_id)
    db.commit()

    await manager.broadcast(race.id, {
        "event": "split_recorded",
        "participant_id": participant.id,
        "participant_name": f"{participant.first_name} {participant.last_name or ''}".strip(),
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
            "participant_name": f"{active[0].first_name} {active[0].last_name or ''}".strip()
        })

    return {
        "status": "over_time" if is_over else "ok",
        "participant": f"{participant.first_name} {participant.last_name or ''}".strip(),
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


# ─── Inaktive chip-ruter (montert under /api/races i main.py) ────────────────

inactive_router = APIRouter(tags=["rfid-inactive"])


@inactive_router.get("/api/races/{race_id}/inactive-chips")
def get_inactive_chips(race_id: int):
    """Hent alle inaktive chip-avlesninger for et løp."""
    return [v for v in _inactive_chip_log.values() if v["race_id"] == race_id]


@inactive_router.delete("/api/races/{race_id}/inactive-chips/{chip_id}")
def dismiss_inactive_chip(race_id: int, chip_id: str):
    """Fjern en chip fra inaktiv-listen (uten å legge løperen tilbake)."""
    key = f"{race_id}_{chip_id.upper()}"
    _inactive_chip_log.pop(key, None)
    return {"ok": True}


@inactive_router.post("/api/races/{race_id}/inactive-chips/{chip_id}/restore")
async def restore_inactive_chip(race_id: int, chip_id: str, db: Session = Depends(get_db)):
    """
    Legg løperen tilbake i løpet som active_resting (i mål, klar for neste runde).
    Fjerner fra inaktiv-listen og nullstiller lockout.
    """
    key = f"{race_id}_{chip_id.upper()}"
    entry = _inactive_chip_log.get(key)
    if not entry:
        raise HTTPException(status_code=404, detail="Chip ikke funnet i inaktiv-liste")

    participant = db.query(models.Participant).filter(
        models.Participant.id == entry["participant_id"],
        models.Participant.race_id == race_id
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="Deltaker ikke funnet")

    participant.status = models.RunnerStatus.ACTIVE_RESTING
    db.commit()

    del _inactive_chip_log[key]

    # Nullstill lockout så chipen kan registreres normalt igjen
    _last_valid_read.pop(chip_id.upper(), None)
    _last_valid_read.pop(f"inactive_{chip_id.upper()}", None)

    await manager.broadcast(race_id, {
        "event": "participant_restored",
        "participant_id": participant.id,
        "participant_name": f"{participant.first_name} {participant.last_name or ''}".strip(),
        "bib_number": participant.bib_number
    })

    return {
        "ok": True,
        "participant_id": participant.id,
        "new_status": "active_resting"
    }
