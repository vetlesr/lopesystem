"""
Automatisk loop-scheduler for Backyard Ultra.
Bruker APScheduler med BackgroundScheduler + asyncio.run_coroutine_threadsafe
for å sikre at async-kode kjøres korrekt fra bakgrunnstråd.
"""

import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger

# Bruk BackgroundScheduler (ikke AsyncIOScheduler) for å unngå event loop-konflikter
scheduler = BackgroundScheduler(timezone="UTC")

# Referanse til FastAPIs event loop – settes ved oppstart
_loop: asyncio.AbstractEventLoop = None


def start_scheduler(loop: asyncio.AbstractEventLoop = None):
    global _loop
    if loop:
        _loop = loop
    if not scheduler.running:
        scheduler.start()
        print("[Scheduler] Startet (BackgroundScheduler)")


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
    now = datetime.utcnow()
    if run_at <= now:
        print(f"[Scheduler] ADVARSEL: Beregnet tidspunkt er i fortiden for løp {race_id} "
              f"(run_at={run_at.strftime('%H:%M:%S')}, now={now.strftime('%H:%M:%S')}), hopper over")
        return

    secs_until = int((run_at - now).total_seconds())
    scheduler.add_job(
        _sync_auto_next_loop,
        trigger=DateTrigger(run_date=run_at),
        args=[race_id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=300  # 5 minutters grace-period ved misfire
    )
    print(f"[Scheduler] Neste runde for løp {race_id} planlagt kl. {run_at.strftime('%H:%M:%S')} UTC "
          f"(om {secs_until // 60}m {secs_until % 60}s)")


def cancel_loop_job(race_id: int):
    job_id = f"next_loop_{race_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"[Scheduler] Avbrutt auto-runde for løp {race_id}")


def get_job_info(race_id: int):
    """Returner info om planlagt jobb for et løp."""
    job = scheduler.get_job(f"next_loop_{race_id}")
    if job:
        return {
            "scheduled": True,
            "run_at": job.next_run_time.isoformat() if job.next_run_time else None,
            "seconds_until": int((job.next_run_time - datetime.now(job.next_run_time.tzinfo)).total_seconds()) if job.next_run_time else None
        }
    return {"scheduled": False, "run_at": None, "seconds_until": None}


def _sync_auto_next_loop(race_id: int):
    """
    Synkron wrapper som kjøres av BackgroundScheduler.
    Sender async-jobben til FastAPIs event loop via run_coroutine_threadsafe.
    """
    global _loop
    if _loop and _loop.is_running():
        future = asyncio.run_coroutine_threadsafe(_async_auto_next_loop(race_id), _loop)
        try:
            future.result(timeout=30)  # Vent maks 30 sekunder
        except Exception as e:
            print(f"[Scheduler] FEIL ved auto-start (threadsafe): {e}")
            import traceback
            traceback.print_exc()
    else:
        # Fallback: kjør i ny event loop
        print(f"[Scheduler] Ingen aktiv event loop, bruker asyncio.run()")
        try:
            asyncio.run(_async_auto_next_loop(race_id))
        except Exception as e:
            print(f"[Scheduler] FEIL ved auto-start (asyncio.run): {e}")
            import traceback
            traceback.print_exc()


async def _async_auto_next_loop(race_id: int):
    """Kjøres automatisk av scheduler – starter neste runde."""
    from database import SessionLocal
    from models import Race, Participant, RunnerStatus, EventLog
    from ws_manager import manager
    import json

    print(f"[Scheduler] _async_auto_next_loop kjøres for løp {race_id}")

    db = SessionLocal()
    try:
        race = db.query(Race).filter(Race.id == race_id).first()
        if not race:
            print(f"[Scheduler] Løp {race_id} ikke funnet")
            return
        if not race.is_active or race.is_finished:
            print(f"[Scheduler] Løp {race_id} er ikke aktivt (is_active={race.is_active}, is_finished={race.is_finished}), hopper over")
            return

        print(f"[Scheduler] Auto-starter runde {race.current_loop + 1} for løp {race_id}")

        # Sett DNC på løpere som ikke kom i mål (active_running = ikke registrert i mål)
        dnc_count = 0
        if race.dnc_auto_assign:
            for p in race.participants:
                if p.status == RunnerStatus.ACTIVE_RUNNING:
                    p.status = RunnerStatus.DNC
                    dnc_count += 1
                    db.add(EventLog(
                        race_id=race_id, event_type="status_change",
                        bib_number=p.bib_number,
                        details=json.dumps({"from": "active_running", "to": "dnc", "auto": True, "loop": race.current_loop})
                    ))

        # Aktiver løpere som hviler (active_resting = fullførte runden, klar for neste)
        restart_count = 0
        for p in race.participants:
            if p.status == RunnerStatus.ACTIVE_RESTING:
                p.status = RunnerStatus.ACTIVE_RUNNING
                restart_count += 1

        # Tell aktive løpere etter statusendringer
        active_count = sum(1 for p in race.participants if p.status == RunnerStatus.ACTIVE_RUNNING)

        # Oppdater løpstatus
        race.current_loop += 1
        race.loop_start_utc = datetime.utcnow()

        db.add(EventLog(
            race_id=race_id, event_type="loop_start",
            details=json.dumps({
                "loop": race.current_loop,
                "auto": True,
                "active_runners": active_count,
                "dnc_assigned": dnc_count,
                "restarted": restart_count
            })
        ))
        db.commit()
        db.refresh(race)

        print(f"[Scheduler] Runde {race.current_loop} startet for løp {race_id}: "
              f"{active_count} aktive, {dnc_count} DNC, {restart_count} restartet")

        # Send WebSocket-oppdatering
        await manager.broadcast(race_id, {
            "event": "new_loop",
            "loop": race.current_loop,
            "loop_start_utc": race.loop_start_utc.isoformat(),
            "auto": True,
            "active_runners": active_count
        })

        # Planlegg neste runde automatisk
        if race.auto_start_next_loop and active_count > 0:
            schedule_next_loop(race_id, race.loop_duration_minutes, race.loop_start_utc)
        elif active_count == 0:
            print(f"[Scheduler] Ingen aktive løpere igjen for løp {race_id}, stopper auto-start")

    except Exception as e:
        print(f"[Scheduler] FEIL ved auto-start av runde for løp {race_id}: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()
