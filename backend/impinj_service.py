"""
Impinj RFID Reader Service

Kobler til en Impinj-leser via IoT Device Interface REST API
og videresender tag-avlesninger til Løpesystem-backend.

Krav:
    - Impinj-leser med firmware 7.6+
    - IoT Device Interface aktivert på leseren
    - Leseren tilgjengelig på nettverket

Bruk:
    python impinj_service.py --reader-host 192.168.1.100

Miljøvariabler (alternativt):
    IMPINJ_HOST=192.168.1.100
    IMPINJ_PORT=80
    BACKEND_URL=http://localhost:8000
"""

import argparse
import requests
import json
import time
import os
from datetime import datetime

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


def start_inventory(reader_host: str, reader_port: int = 80):
    """Start inventory-modus på Impinj-leseren."""
    url = f"http://{reader_host}:{reader_port}/api/v1/profiles/inventory/presets/default/start"
    try:
        resp = requests.post(url, timeout=5)
        print(f"Inventory startet: {resp.status_code}")
        return resp.status_code == 200
    except Exception as e:
        print(f"Kunne ikke starte inventory: {e}")
        return False


def stop_inventory(reader_host: str, reader_port: int = 80):
    """Stopp inventory-modus på Impinj-leseren."""
    url = f"http://{reader_host}:{reader_port}/api/v1/profiles/stop"
    try:
        requests.post(url, timeout=5)
    except Exception:
        pass


def forward_tag_read(epc: str, timestamp: str):
    """Send tag-avlesning til Løpesystem-backend."""
    payload = {"epc": epc, "timestamp": timestamp}
    try:
        resp = requests.post(f"{BACKEND_URL}/api/rfid/read", json=payload, timeout=2)
        return resp.json()
    except Exception as e:
        print(f"Feil ved videresending: {e}")
        return None


def listen_to_reader(reader_host: str, reader_port: int = 80):
    """
    Lytter på event-strømmen fra Impinj-leseren og videresender
    tag-avlesninger til backend.
    """
    stream_url = f"http://{reader_host}:{reader_port}/api/v1/data/stream"
    print(f"\n📡 Kobler til Impinj-leser på {stream_url}")
    print(f"   Videresender til {BACKEND_URL}/api/rfid/read\n")

    # Unngå dobbel-registrering: hold styr på nylig sett EPCer
    recently_seen: dict[str, float] = {}
    COOLDOWN_SECONDS = 30  # Ikke registrer samme tag mer enn én gang per 30 sek

    while True:
        try:
            with requests.get(stream_url, stream=True, timeout=30) as response:
                if response.status_code != 200:
                    print(f"Feil: HTTP {response.status_code}. Prøver igjen om 5 sekunder...")
                    time.sleep(5)
                    continue

                print("✅ Tilkoblet! Lytter på tag-avlesninger...")

                for line in response.iter_lines():
                    if not line:
                        continue

                    try:
                        event = json.loads(line.decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue

                    # Hent ut tag-avlesninger fra event-strømmen
                    tag_reads = event.get("tagInventoryEvent", {}).get("tagReads", [])
                    for tag in tag_reads:
                        epc = tag.get("epc", "").upper()
                        if not epc:
                            continue

                        # Sjekk cooldown
                        now = time.time()
                        if epc in recently_seen and (now - recently_seen[epc]) < COOLDOWN_SECONDS:
                            continue

                        recently_seen[epc] = now
                        timestamp = datetime.utcnow().isoformat()

                        result = forward_tag_read(epc, timestamp)
                        if result and result.get("status") == "ok":
                            print(f"✅ {result['participant']} – runde {result['laps_completed']} (EPC: {epc[-6:]})")
                        elif result:
                            print(f"ℹ️  EPC {epc[-6:]}: {result.get('reason', 'ukjent')}")

        except requests.exceptions.ConnectionError:
            print(f"Mistet tilkobling til leseren. Prøver igjen om 5 sekunder...")
            time.sleep(5)
        except requests.exceptions.Timeout:
            print("Timeout. Kobler til på nytt...")
        except KeyboardInterrupt:
            print("\nStopper Impinj-tjenesten.")
            stop_inventory(reader_host, reader_port)
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Impinj RFID Reader Service for Løpesystem")
    parser.add_argument("--reader-host", default=os.getenv("IMPINJ_HOST", ""), help="IP-adresse til Impinj-leseren")
    parser.add_argument("--reader-port", type=int, default=int(os.getenv("IMPINJ_PORT", "80")), help="Port (standard: 80)")
    args = parser.parse_args()

    if not args.reader_host:
        print("❌ Feil: Oppgi IP-adressen til leseren med --reader-host eller IMPINJ_HOST miljøvariabel")
        exit(1)

    if start_inventory(args.reader_host, args.reader_port):
        listen_to_reader(args.reader_host, args.reader_port)
    else:
        print("Kunne ikke starte inventory. Sjekk at leseren er tilgjengelig og at IoT Device Interface er aktivert.")
