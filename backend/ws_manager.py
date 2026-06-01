from fastapi import WebSocket
from typing import Dict, List
import json


class ConnectionManager:
    """Håndterer WebSocket-tilkoblinger per løp."""

    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, race_id: int, websocket: WebSocket):
        await websocket.accept()
        if race_id not in self.active_connections:
            self.active_connections[race_id] = []
        self.active_connections[race_id].append(websocket)

    def disconnect(self, race_id: int, websocket: WebSocket):
        if race_id in self.active_connections:
            try:
                self.active_connections[race_id].remove(websocket)
            except ValueError:
                pass
            if not self.active_connections[race_id]:
                del self.active_connections[race_id]

    async def broadcast(self, race_id: int, data: dict):
        """Send melding til alle tilkoblede klienter for et spesifikt løp."""
        if race_id not in self.active_connections:
            return
        message = json.dumps(data)
        dead = []
        for ws in self.active_connections[race_id]:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(race_id, ws)

    async def broadcast_all(self, data: dict):
        """Send melding til alle tilkoblede klienter på tvers av løp."""
        for race_id in list(self.active_connections.keys()):
            await self.broadcast(race_id, data)

    # Bakoverkompatibilitet
    async def broadcast_race_update(self, race_id: int, data: dict):
        await self.broadcast(race_id, data)


manager = ConnectionManager()
