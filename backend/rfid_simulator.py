"""
RFID-simulator for testing uten Impinj-hardware.

Simulerer at løpere passerer mål ved å sende POST-forespørsler
til /api/rfid/read-endepunktet med tilfeldige intervaller.

Bruk:
    python rfid_simulator.py --race-id 1

Simulatoren henter deltakere fra API-et og sender tag-avlesninger
for aktive løpere med tilfeldige mellomrom innenfor rundetiden.
"""

import argparse
import requests
import time
import random
from datetime import datetime

BASE_URL = "http://localhost:8000"


def get_active_participants(race_id: int) -> list:
    try:
        resp = requests.get(f"{BASE_URL}/api/races/{race_id}/participants/")
        if resp.status_code == 200:
            return [p for p in resp.json() if p["status"] == "active" and p["rfid_tag"]]
    except Exception as e:
        print(f"Feil ved henting av deltakere: {e}")
    return []


def get_race(race_id: int) -> dict | None:
    try:
        resp = requests.get(f"{BASE_URL}/api/races/{race_id}")
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Feil ved henting av løp: {e}")
    return None


def simulate_tag_read(epc: str):
    payload = {"epc": epc, "timestamp": datetime.utcnow().isoformat()}
    try:
        resp = requests.post(f"{BASE_URL}/api/rfid/read", json=payload)
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


def run_simulation(race_id: int, drop_rate: float = 0.1):
    """
    Simuler et løp.
    drop_rate: sannsynlighet for at en løper IKKE fullfører runden (0.0 - 1.0)
    """
    print(f"\n🏃 RFID-simulator startet for løp {race_id}")
    print(f"   Drop-rate: {drop_rate * 100:.0f}% (sjanse for at løper ikke fullfører)")
    print(f"   Kobler til {BASE_URL}\n")

    while True:
        race = get_race(race_id)
        if not race:
            print("Finner ikke løpet. Venter...")
            time.sleep(5)
            continue

        if not race["is_active"]:
            print("Løpet er ikke aktivt. Venter på start...")
            time.sleep(3)
            continue

        if race["is_finished"]:
            print("Løpet er ferdig. Simulator stopper.")
            break

        participants = get_active_participants(race_id)
        if not participants:
            print("Ingen aktive deltakere med RFID-tag. Venter...")
            time.sleep(5)
            continue

        current_lap = race["current_lap"]
        lap_minutes = race["lap_time_minutes"]
        print(f"\n📍 Runde {current_lap} – {len(participants)} aktive løpere")

        # Simuler at løpere ankommer i tilfeldige rekkefølge og tidspunkt
        # De fleste ankommer mellom 45-58 minutter ut i runden
        shuffled = participants[:]
        random.shuffle(shuffled)

        for i, p in enumerate(shuffled):
            # Simuler at noen løpere gir seg (drop_rate)
            if random.random() < drop_rate:
                print(f"   ⚠️  {p['name']} (#{p['bib_number']}) simuleres som ikke fullførende")
                continue

            # Vent et tilfeldig antall sekunder (simulerer at løpere ankommer spredt)
            wait = random.uniform(1, 3)
            time.sleep(wait)

            result = simulate_tag_read(p["rfid_tag"])
            if result.get("status") == "ok":
                print(f"   ✅ {p['name']} (#{p['bib_number']}) – runde {result['laps_completed']} registrert")
            else:
                print(f"   ℹ️  {p['name']}: {result.get('reason', result)}")

        print(f"\n⏳ Venter på neste runde (sjekker hvert 5. sekund)...")

        # Vent til neste runde starter
        last_lap = current_lap
        while True:
            time.sleep(5)
            race = get_race(race_id)
            if not race or not race["is_active"] or race["is_finished"]:
                break
            if race["current_lap"] > last_lap:
                break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RFID-simulator for Løpesystem")
    parser.add_argument("--race-id", type=int, required=True, help="ID til løpet som skal simuleres")
    parser.add_argument("--drop-rate", type=float, default=0.1, help="Sannsynlighet for at løper ikke fullfører (0.0-1.0)")
    args = parser.parse_args()

    run_simulation(args.race_id, args.drop_rate)
