# QuickComms

QuickComms is a deliberately small, private voice-chat application for gaming. It supports Windows and macOS, keeps audio peer-to-peer whenever possible, and uses a small VM only for signaling and TURN fallback.

## Included in this MVP

- Private room codes with a four-player limit
- Encrypted WebRTC audio
- Mute/unmute
- Microphone and speaker selection
- Echo cancellation and noise suppression
- Participant connection status
- FastAPI WebSocket signaling
- Docker Compose deployment with Caddy HTTPS and coturn
- Tauri 2 desktop packaging scaffold for Windows and macOS

## Architecture

The FastAPI service tells clients who is in a room and relays WebRTC offers, answers, and ICE candidates. It never records audio. Audio normally travels directly between players. coturn relays audio only when NAT or firewall rules prevent a direct connection.

## Run locally

Requirements: Python 3.12+.

```bash
cd server
python -m venv .venv

# macOS/Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://localhost:8000` in two browser windows. Use different display names and the same room code. Browsers permit microphone access on localhost.

For a true two-network test, deploy to the VM first. Microphone access from a remote browser requires HTTPS.

## Deploy to your VM

Requirements:

- A Linux VM with Docker Engine and Docker Compose
- A public IPv4 address
- A domain or subdomain pointing to that address
- Firewall access for TCP 8443/3478 and UDP 8443/3478/49160-49200

```bash
cd infrastructure
cp .env.example .env
```

Edit `.env` with your domain, public IP, a long random TURN password, and your DuckDNS API token. Caddy uses the DuckDNS DNS challenge so QuickComms can coexist with another service on ports 80 and 443. Then run:

```bash
docker compose up -d --build
docker compose ps
```

Caddy obtains and renews the HTTPS certificate automatically. Visit `https://your-domain.example:8443/api/health`; it should return `{"status":"ok",...}`.

### VM firewall example (Ubuntu UFW)

```bash
sudo ufw allow 8443/tcp
sudo ufw allow 8443/udp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
```

Also open the same ports in the VM provider's cloud firewall/security group.

## Build the desktop app

The desktop client must be compiled on each target operating system. Install the Tauri prerequisites for that OS, Node.js, and Rust, then:

```bash
npm install
npm run desktop:build
```

- Run the command on Windows to produce the Windows installer.
- Run it on macOS to produce the macOS application and disk image.
- In the installed app, expand **Server settings** and enter the VM URL, such as `https://voice.example.com`.

The web client and desktop client share exactly the same HTML, CSS, and WebRTC code.

## Testing

Install the additional test dependency and run:

```bash
cd server
pip install httpx pytest
pytest
```

## Remove the VM deployment

The cleanup script removes only QuickComms containers, project networks, volumes, locally built images, and QuickComms-specific firewall rules. It preserves unrelated VM services and keeps `.env` by default.

```bash
chmod +x scripts/cleanup-vm.sh
sudo ./scripts/cleanup-vm.sh
```

To also delete the local deployment secrets in `infrastructure/.env`:

```bash
sudo ./scripts/cleanup-vm.sh --purge-config
```

Before using it with friends, test these cases:

1. Windows and macOS on the same Wi-Fi.
2. One computer on Wi-Fi and one using a phone hotspot.
3. Mute, microphone switching, and reconnecting.
4. A four-player room.
5. A fifth player receiving the `Room is full` response.

## Security and production notes

- Room codes are invitations, not authentication. Share them privately.
- Change the sample TURN credential before deployment.
- The current static TURN credential is acceptable for a private MVP but should be replaced with short-lived credentials before making the service public.
- Add rate limiting and authentication before exposing this to untrusted users.
- WebRTC media is encrypted in transit. This project does not claim independently verified end-to-end security against a malicious TURN or modified client.

## Next milestones

1. Global push-to-talk shortcut
2. System tray operation
3. Short-lived TURN credentials
4. Automatic reconnect after network changes
5. Signed Windows installer and notarized macOS release
