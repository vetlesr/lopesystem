from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from database import engine, Base
from routers import races, participants, rfid
from ws_manager import manager

# Opprett alle tabeller ved oppstart
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Løpesystem API",
    description="Skreddersydd tidtakingssystem for ultraløp",
    version="0.1.0"
)

# CORS – tillat frontend å snakke med backend lokalt
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrer routers
app.include_router(races.router)
app.include_router(participants.router)
app.include_router(rfid.router)


@app.get("/")
def root():
    return {"message": "Løpesystem API er oppe og kjører 🏃"}


@app.websocket("/ws/races/{race_id}")
async def websocket_endpoint(websocket: WebSocket, race_id: int):
    """WebSocket-endepunkt for live-oppdateringer per løp."""
    await manager.connect(race_id, websocket)
    try:
        while True:
            # Hold tilkoblingen åpen; vi sender data via broadcast
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(race_id, websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
