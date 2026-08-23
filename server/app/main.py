import json
import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware


ROOM_PATTERN = re.compile(r"^[A-Z0-9]{4,12}$")
CLIENT_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,64}$")
MAX_ROOM_SIZE = 4
CLIENT_DIR = Path(__file__).resolve().parents[2] / "client"


@dataclass
class Participant:
    socket: WebSocket
    name: str


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, Participant]] = {}

    async def connect(
        self, room: str, client_id: str, name: str, socket: WebSocket
    ) -> bool:
        participants = self.rooms.setdefault(room, {})
        if len(participants) >= MAX_ROOM_SIZE:
            await socket.close(code=4004, reason="Room is full")
            return False

        existing = [
            {"id": peer_id, "name": peer.name}
            for peer_id, peer in participants.items()
        ]
        await socket.accept()
        participants[client_id] = Participant(socket=socket, name=name)
        await socket.send_json({"type": "welcome", "peers": existing})
        await self.broadcast(
            room,
            {"type": "peer-joined", "peer": {"id": client_id, "name": name}},
            exclude=client_id,
        )
        return True

    async def relay(self, room: str, sender: str, message: dict) -> None:
        target = message.get("target")
        if not isinstance(target, str):
            return
        participant = self.rooms.get(room, {}).get(target)
        if participant:
            message["sender"] = sender
            message.pop("target", None)
            await participant.socket.send_json(message)

    async def broadcast(self, room: str, message: dict, exclude: str | None = None) -> None:
        for peer_id, participant in list(self.rooms.get(room, {}).items()):
            if peer_id != exclude:
                await participant.socket.send_json(message)

    async def disconnect(self, room: str, client_id: str) -> None:
        participants = self.rooms.get(room)
        if not participants or client_id not in participants:
            return
        participants.pop(client_id)
        if participants:
            await self.broadcast(room, {"type": "peer-left", "peerId": client_id})
        else:
            self.rooms.pop(room, None)


app = FastAPI(title="QuickComms", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)
manager = RoomManager()


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "rooms": len(manager.rooms)}


@app.get("/api/config")
async def config() -> dict:
    import os

    urls = [url.strip() for url in os.getenv("TURN_URLS", "").split(",") if url.strip()]
    ice_servers: list[dict] = [{"urls": "stun:stun.l.google.com:19302"}]
    if urls:
        ice_servers.append(
            {
                "urls": urls,
                "username": os.getenv("TURN_USERNAME", "quickcomms"),
                "credential": os.getenv("TURN_PASSWORD", "change-me"),
            }
        )
    return {"iceServers": ice_servers, "maxRoomSize": MAX_ROOM_SIZE}


@app.websocket("/ws/{room}/{client_id}")
async def signaling(
    socket: WebSocket,
    room: str,
    client_id: str,
    name: str = Query(min_length=1, max_length=32),
) -> None:
    room = room.upper()
    if not ROOM_PATTERN.fullmatch(room) or not CLIENT_PATTERN.fullmatch(client_id):
        await socket.close(code=4000, reason="Invalid room or client ID")
        return
    if not await manager.connect(room, client_id, name.strip(), socket):
        return
    try:
        while True:
            raw = await socket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("type") in {"offer", "answer", "ice-candidate"}:
                await manager.relay(room, client_id, message)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, client_id)


if CLIENT_DIR.exists():
    app.mount("/assets", StaticFiles(directory=CLIENT_DIR / "assets"), name="assets")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(CLIENT_DIR / "index.html")
