"""
Automatisk loop-scheduler for Backyard Ultra.
Bruker APScheduler til å starte neste runde automatisk.
"""

from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger

scheduler = AsyncIOScheduler(timezone="UTC")


def start_scheduler():
    if not scheduler.running:
        scheduler.start()
        print("[Scheduler] Startet")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("[Scheduler] Stoppet")


def schedule_next_loop(race_id: int, loop_duration_minutes: int, loop_start_utc: datetime = None):
    """
    Planlegg automatisk start av neste runde.
    Beregner tidspunkt basert på loop_start_utc + loop_duration_minutes.
    """
    job_id = f"next_loop_{race_id}"

    # Fjern eksisterende jobb for dette løpet
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    # Beregn nøyaktig tidspunkt basert på rundestart
    if loop_start_utc:
        run_at = loop_start_utc + timedelta(minutes=loop_duration_minutes)
    else:
        run_at = datetime.utcnow() + timedelta(minutes=loop_duration_minutes)

    # Ikke planlegg hvis tidspunktet er i fortiden
    if run_at <= datetime.utcnow():
        print(f"[Scheduler] ADVARSEL: Beregnet tidspunkt er i fortiden for løp {race_id}, hopper over")
        return

    scheduler.add_job(
        _auto_next_loop,
        trigger=DateTrigger(run_date=run_at),
        args=[race_id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=300  # 5 minutters grace-period ved misfire
    )
    print(f"[Scheduler] Neste runde for løp {race_id} planlagt kl. {run_at.strftime('%H:%M:%S')} UTC "
          f"(om {int((run_at - datetime.utcnow()).total_seconds() / 60)} min)")


def cancel_loop_job(race_id: int):
    job_id = f"next_loop_{race_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Avbrutt auto-runde for løp {race_id}")


def get_job_info(race_id: int):
    """Returner info om planlagt jobb for et løp."""
    job = scheduler.get_job(f"next_loop_{race_id}")
    if job:
        return {"scheduled": True, "run_at": job.next_run_time.isoformat() if job.next_run_time else None}
    return {"scheduled": False, "run_at": None}


async def _auto_next_loop(race_id: int):
    """Intern: kjøres automatisk av scheduler."""
    from database import SessionLocal
    from models import Race, Participant, RunnerStatus, EventLog
    from ws_manager import manager
    import json

    db = SessionLocal()
    try:
        race = db.query(Race).filter(Race.id == race_id).first()
        if not race:
            print(f"[Scheduler] Løp {race_id} ikke funnet")
            return
        if not race.is_active or race.is_finished:
            print(f"[Scheduler] Løp {race_id} er ikke aktivt, hopper over")
            return

        print(f"[Scheduler] Auto-starter runde {race.current_loop + 1} for løp {race_id}")

        # Sett DNC på løpere som ikke kom i mål
        if race.dnc_auto_assign:
            for p in race.participants:
                if p.status == RunnerStatus.ACTIVE_RUNNING:
                    p.status = RunnerStatus.DNC
                    db.add(EventLog(
                        race_id=race_id, event_type="status_change",
                        bib_number=p.bib_number,
                        details=json.dumps({"from": "active_running", "to": "dnc", "auto": True})
                    ))

        # Aktiver løpere som hviler
        for p in race.participants:
            if p.status == RunnerStatus.ACTIVE_RESTING:
                p.status = RunnerStatus.ACTIVE_RUNNING

        # Sjekk om det er noen aktive løpere igjen
        active_count = sum(1 for p in race.participants if p.status == RunnerStatus.ACTIVE_RUNNING)

        race.current_loop += 1
        race.loop_start_utc = datetime.utcnow()

        db.add(EventLog(
            race_id=race_id, event_type="loop_start",
            details=json.dumps({"loop": race.current_loop, "auto": True, "active_runners": active_count})
        ))
        db.commit()
        db.refresh(race)

        await manager.broadcast(race_id, {
            "event": "new_loop",
            "loop": race.current_loop,
            "loop_start_utc": race.loop_start_utc.isoformat(),
            "auto": True,
            "active_runners": active_count
        })

        print(f"[Scheduler] Runde {race.current_loop} startet for løp {race_id}, {active_count} aktive løpere")

        # Planlegg neste runde automatisk
        if race.auto_start_next_loop and active_count > 0:
            schedule_next_loop(race_id, race.loop_duration_minutes, race.loop_start_utc)
        elif active_count == 0:
            print(f"[Scheduler] Ingen aktive løpere igjen for løp {race_id}, stopper auto-start")

    except Exception as e:
        print(f"[Scheduler] FEIL ved auto-start av runde for løp {race_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()
