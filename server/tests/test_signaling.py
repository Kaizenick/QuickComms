from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app, manager


client = TestClient(app)


def setup_function() -> None:
    manager.rooms.clear()


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "rooms": 0}


def test_peers_join_and_relay_offer() -> None:
    with client.websocket_connect("/ws/GAME/first_user?name=Alice") as alice:
        assert alice.receive_json() == {"type": "welcome", "peers": []}
        with client.websocket_connect("/ws/GAME/second_user?name=Bob") as bob:
            assert bob.receive_json() == {
                "type": "welcome",
                "peers": [{"id": "first_user", "name": "Alice"}],
            }
            assert alice.receive_json()["type"] == "peer-joined"
            bob.send_json(
                {"type": "offer", "target": "first_user", "sdp": {"type": "offer"}}
            )
            relayed = alice.receive_json()
            assert relayed["sender"] == "second_user"
            assert relayed["type"] == "offer"
            assert "target" not in relayed
        assert alice.receive_json() == {"type": "peer-left", "peerId": "second_user"}


def test_invalid_room_is_rejected() -> None:
    try:
        with client.websocket_connect("/ws/!!!/valid_user?name=Alice"):
            raise AssertionError("Connection should have been rejected")
    except WebSocketDisconnect as exc:
        assert exc.code == 4000
        assert exc.reason == "Invalid room or client ID"
