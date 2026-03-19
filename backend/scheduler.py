"""
Automatisk runde-scheduler for Backyard Ultra.

Bruker APScheduler til å starte neste runde automatisk
når rundetiden er ute. Kjøres i bakgrunnen av FastAPI-appen.
"""

import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger

scheduler = AsyncIOScheduler()


def start_scheduler():
    if not scheduler.running:
        scheduler.start()


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)


def schedule_next_lap(race_id: int, lap_time_minutes: int):
    """Planlegg automatisk start av neste runde etter lap_time_minutes."""
    job_id = f"next_lap_{race_id}"

    # Fjern eventuell eksisterende jobb for dette løpet
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    run_at = datetime.utcnow() + timedelta(minutes=lap_time_minutes)

    scheduler.add_job(
        _auto_next_lap,
        trigger=DateTrigger(run_date=run_at),
        args=[race_id],
        id=job_id,
        replace_existing=True
    )
    print(f"[Scheduler] Neste runde for løp {race_id} planlagt kl. {run_at.strftime('%H:%M:%S')} UTC")


def cancel_lap_job(race_id: int):
    """Avbryt planlagt runde for et løp (brukes når løpet avsluttes)."""
    job_id = f"next_lap_{race_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Avbrutt automatisk runde for løp {race_id}")


async def _auto_next_lap(race_id: int):
    """Kjøres automatisk av scheduler: starter neste runde."""
    from database import SessionLocal
    from models import Race, Participant, ParticipantStatus
    from ws_manager import manager

    db = SessionLocal()
    try:
        race = db.query(Race).filter(Race.id == race_id).first()
        if not race or not race.is_active or race.is_finished:
            return

        print(f"[Scheduler] Auto-starter runde {race.current_lap + 1} for løp {race_id}")

        # Marker løpere som ikke fullførte som DNF
        for p in race.participants:
            if p.status == ParticipantStatus.ACTIVE:
                if p.laps_completed < race.current_lap:
                    p.status = ParticipantStatus.DNF

        race.current_lap += 1
        race.lap_start_time = datetime.utcnow()
        db.commit()
        db.refresh(race)

        await manager.broadcast_race_update(race_id, {
            "event": "new_lap",
            "lap": race.current_lap,
            "lap_start_time": race.lap_start_time.isoformat(),
            "auto": True
        })

        # Planlegg neste runde automatisk
        schedule_next_lap(race_id, race.lap_time_minutes)

    finally:
        db.close()
