"""
Automatisk loop-scheduler for Backyard Ultra.
Bruker APScheduler til å starte neste runde automatisk.
"""

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


def schedule_next_loop(race_id: int, loop_duration_minutes: int):
    """Planlegg automatisk start av neste runde."""
    job_id = f"next_loop_{race_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    run_at = datetime.utcnow() + timedelta(minutes=loop_duration_minutes)
    scheduler.add_job(
        _auto_next_loop,
        trigger=DateTrigger(run_date=run_at),
        args=[race_id],
        id=job_id,
        replace_existing=True
    )
    print(f"[Scheduler] Neste runde for løp {race_id} kl. {run_at.strftime('%H:%M:%S')} UTC")


def cancel_loop_job(race_id: int):
    job_id = f"next_loop_{race_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Avbrutt auto-runde for løp {race_id}")


async def _auto_next_loop(race_id: int):
    from database import SessionLocal
    from models import Race, Participant, RunnerStatus, EventLog
    from ws_manager import manager
    import json

    db = SessionLocal()
    try:
        race = db.query(Race).filter(Race.id == race_id).first()
        if not race or not race.is_active or race.is_finished:
            return

        print(f"[Scheduler] Auto-starter runde {race.current_loop + 1} for løp {race_id}")

        if race.dnc_auto_assign:
            for p in race.participants:
                if p.status == RunnerStatus.ACTIVE_RUNNING:
                    p.status = RunnerStatus.DNC
                    db.add(EventLog(
                        race_id=race_id, event_type="status_change",
                        bib_number=p.bib_number,
                        details=json.dumps({"from": "active_running", "to": "dnc", "auto": True})
                    ))

        for p in race.participants:
            if p.status == RunnerStatus.ACTIVE_RESTING:
                p.status = RunnerStatus.ACTIVE_RUNNING

        race.current_loop += 1
        race.loop_start_utc = datetime.utcnow()

        db.add(EventLog(
            race_id=race_id, event_type="loop_start",
            details=json.dumps({"loop": race.current_loop, "auto": True})
        ))
        db.commit()
        db.refresh(race)

        await manager.broadcast(race_id, {
            "event": "new_loop",
            "loop": race.current_loop,
            "loop_start_utc": race.loop_start_utc.isoformat(),
            "auto": True
        })

        # Planlegg neste runde
        if race.auto_start_next_loop:
            schedule_next_loop(race_id, race.loop_duration_minutes)

    finally:
        db.close()
