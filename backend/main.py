import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from database import engine, Base
from routers import races, participants, rfid
from routers.rfid import inactive_router
from ws_manager import manager
from scheduler import start_scheduler, stop_scheduler

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Send FastAPIs event loop til scheduler slik at async-kode kan kjøres fra bakgrunnstråd
    loop = asyncio.get_event_loop()
    start_scheduler(loop)
    yield
    stop_scheduler()


app = FastAPI(
    title="Løpesystem API",
    description="Skreddersydd tidtakingssystem for Backyard Ultra og andre løpsformater",
    version="0.4.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(races.router)
app.include_router(participants.router)
app.include_router(rfid.router)
app.include_router(inactive_router)


@app.get("/")
def root():
    return {"message": "Løpesystem API v0.4.0 🏃", "docs": "/docs"}


@app.websocket("/ws/race/{race_id}")
async def websocket_endpoint(websocket: WebSocket, race_id: int):
    await manager.connect(race_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(race_id, websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
