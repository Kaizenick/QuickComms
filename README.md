# QuickComms

QuickComms is a deliberately small, private voice-chat application for gaming. It supports Windows and macOS, keeps audio peer-to-peer whenever possible, and uses a small VM only for signaling and TURN fallback.

## Included in this MVP

- Private room codes with a four-player limit
- Encrypted WebRTC audio
- Mute/unmute
- Optional push-to-talk using a configurable keyboard key or an on-screen hold button
- Microphone and speaker selection
- Echo cancellation and noise suppression
- Participant connection status
- FastAPI WebSocket signaling
- Docker Compose deployment with Caddy HTTPS and coturn
- Native Windows and macOS clients with system-wide configurable push-to-talk

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

### Push to talk

After joining a room, change **Transmission** from **Open microphone** to **Push to talk**. Space is the default shortcut. To change it, select the **Keyboard shortcut** button and press the desired key; Escape cancels the selection. The choice is saved locally on that browser or device. Hold the configured key or the on-screen button while speaking. Releasing it immediately disables the outgoing microphone track.

In a browser, the keyboard shortcut works only while the QuickComms tab has focus. The Windows and macOS desktop clients register it as a system-wide shortcut, so it continues working while a game is focused.

## Complete VM deployment guide (Ubuntu)

The production stack consists of three small containers:

- `app`: FastAPI signaling server and web client
- `caddy`: HTTPS reverse proxy and automatic TLS certificate renewal
- `coturn`: TURN relay for players who cannot establish a direct WebRTC connection

Choose the following values for your deployment:

- VM public IP: your VM provider's assigned public IPv4 address
- DuckDNS name: `your-subdomain.duckdns.org`
- Public web port: `8443`
- TURN port: `3478`
- TURN relay range: `49160-49200/udp`

Port `8443` is intentional. Pi-hole already owns ports `80` and `443` on this VM, so QuickComms does not bind or modify either port. Caddy uses a DuckDNS DNS-01 challenge to obtain a valid certificate without needing ports 80 or 443.

### 1. VM requirements

- Ubuntu 22.04 or a newer supported Ubuntu release
- A public IPv4 address
- At least 1 GB RAM; 1 GB swap is recommended on a 1 GB VM
- Root access or a user with `sudo`
- Docker Engine and the Docker Compose plugin

QuickComms normally consumes roughly 60-80 MB of RAM while idle, so a 1 GB VM is sufficient for a small private room. Available memory matters more than the `free` column because Linux uses unused RAM as cache.

Check the VM before starting:

```bash
free -h
df -h /
sudo ss -ltnp | grep -E ':(80|443|8443|3478)[[:space:]]' || true
```

If the VM has no swap, create a 1 GB swap file:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Do not repeat the `fstab` command if `/swapfile` is already listed there.

### 2. Install Docker Engine and Docker Compose

If both commands below already work, skip to step 3:

```bash
docker --version
docker compose version
```

Install Docker from Docker's official Ubuntu repository. This is important because Ubuntu's default repository may provide Docker without the `docker-compose-plugin` package.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"${UBUNTU_CODENAME:-$VERSION_CODENAME}\") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
docker compose version
```

If Docker Engine is already installed and you do not want to replace it, the Compose CLI plugin can instead be installed manually. Manual installations do not update automatically:

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins

# x86_64/amd64 VM
sudo curl -SL https://github.com/docker/compose/releases/download/v5.5.0/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose

sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

### 3. Configure DuckDNS

1. Sign in at [DuckDNS](https://www.duckdns.org/).
2. Create a unique subdomain, such as `your-subdomain`.
3. Set its current IPv4 address to your VM's public IPv4 address and select **update ip**.
4. Copy the account token for use in the private `.env` file in step 5.

Verify forward DNS from your computer:

```bash
nslookup your-subdomain.duckdns.org
```

The answer must contain your VM's public IPv4 address. Running `nslookup YOUR_VM_PUBLIC_IP` performs a reverse-DNS lookup and an `NXDOMAIN` response there does not mean the DuckDNS record is broken.

### 4. Clone the repository

On the VM:

```bash
cd ~
git clone https://github.com/Kaizenick/QuickComms.git
cd ~/QuickComms
```

If it is already cloned, update it instead:

```bash
cd ~/QuickComms
git pull --ff-only origin main
```

### 5. Create the private environment file

Create `~/QuickComms/infrastructure/.env`:

```bash
cd ~/QuickComms/infrastructure
nano .env
```

Add the following values, replacing every placeholder. Use only the DuckDNS token itself—not a DuckDNS update URL:

```dotenv
DOMAIN=your-subdomain.duckdns.org
PUBLIC_IP=YOUR_VM_PUBLIC_IP
TURN_USERNAME=quickcomms
TURN_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
DUCKDNS_API_TOKEN=REPLACE_WITH_YOUR_DUCKDNS_TOKEN
```

Generate a shell-safe TURN password with:

```bash
openssl rand -hex 32
```

Save in nano with `Ctrl+O`, press Enter, and exit with `Ctrl+X`. Protect the file and confirm that Compose can read the configuration:

```bash
chmod 600 .env
docker compose config --services
```

Expected services:

```text
app
caddy
coturn
```

Never commit `.env` or share its contents. It is excluded by `.gitignore`.

### 6. Configure the VM firewall

Always allow SSH before enabling UFW, otherwise the active SSH connection could be locked out:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 8443/tcp
sudo ufw allow 8443/udp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
sudo ufw enable
sudo ufw status
```

What the QuickComms rules are for:

| Rule | Purpose |
| --- | --- |
| `8443/tcp` | HTTPS web client, API, and secure WebSocket signaling |
| `8443/udp` | Optional HTTP/3 access through Caddy |
| `3478/tcp` | TURN fallback over TCP |
| `3478/udp` | Preferred TURN connection over UDP |
| `49160:49200/udp` | coturn media relay ports |

If DigitalOcean Cloud Firewall is attached to the Droplet, add the same inbound rules there as well. Keep any existing rules required by Pi-hole or the VM's other applications. QuickComms does not require new rules for ports 80 or 443.

### 7. Build and start QuickComms

From the infrastructure directory:

```bash
cd ~/QuickComms/infrastructure
docker compose up -d --build
docker compose ps
```

All three services should show `Up`. The first Caddy build takes longer because it compiles the DuckDNS DNS provider module. Caddy then uses the token to obtain and renew the certificate automatically.

Follow the certificate process if needed:

```bash
docker compose logs caddy --tail=100
```

Successful logs contain messages similar to `authorization finalized` and `certificate obtained successfully` for your DuckDNS name.

### 8. Verify the deployment

From the VM:

```bash
docker compose ps
docker compose logs app --tail=50
docker compose logs coturn --tail=50
docker stats --no-stream
```

From a computer outside the VM:

```bash
curl -fsS https://your-subdomain.duckdns.org:8443/api/health
```

Expected response:

```json
{"status":"ok","rooms":0}
```

Open `https://your-subdomain.duckdns.org:8443`, permit microphone access, and join a room. On a second device, use a different display name and the exact same room code. Testing the second device on a phone hotspot verifies the TURN fallback across two networks.

### 9. Routine management

Show status:

```bash
cd ~/QuickComms/infrastructure
docker compose ps
```

View live logs (exit with `Ctrl+C`):

```bash
docker compose logs -f app caddy coturn
```

Restart the stack without deleting data:

```bash
docker compose restart
```

Deploy the latest code from GitHub:

```bash
cd ~/QuickComms
git pull --ff-only origin main
cd infrastructure
docker compose up -d --build
docker compose ps
curl -fsS https://your-subdomain.duckdns.org:8443/api/health
```

Stop the containers while preserving their volumes and configuration:

```bash
cd ~/QuickComms/infrastructure
docker compose down
```

Start them again:

```bash
docker compose up -d
```

### 10. Troubleshooting

#### `docker: unknown command: docker compose`

The Compose CLI plugin is missing. Install Docker's official `docker-compose-plugin` package from step 2 or use the manual plugin fallback. The old `docker-compose` command is a different legacy installation.

#### `Unable to locate package docker-compose-plugin`

The VM is using only Ubuntu's repository. Add Docker's official apt repository using step 2, run `sudo apt-get update`, and install the plugin again.

#### `failed to bind host port ... address already in use`

Identify the owner of the port:

```bash
sudo ss -ltnp | grep -E ':(80|443|8443|3478)[[:space:]]'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Pi-hole is expected to own ports 80 and 443 on this VM. Do not stop it. The current Compose file exposes Caddy only on 8443. A conflict on 8443 or 3478 means another process must be identified before QuickComms can start.

#### HTTPS or health check fails

Check DNS, containers, and logs:

```bash
nslookup your-subdomain.duckdns.org
cd ~/QuickComms/infrastructure
docker compose ps
docker compose logs caddy --tail=100
docker compose logs app --tail=100
```

Confirm that the DuckDNS record points to the VM, the token in `.env` is valid, and both the VM firewall and any DigitalOcean Cloud Firewall allow TCP 8443.

#### Website works but players cannot hear each other

Use headphones to avoid echo, verify microphone permission in the browser, and inspect signaling/TURN logs:

```bash
cd ~/QuickComms/infrastructure
docker compose logs app --tail=100
docker compose logs coturn --tail=100
```

Confirm that UDP 3478 and UDP 49160-49200 are allowed in both UFW and the cloud firewall.

#### Caddy UDP receive-buffer warning

The warning about failing to sufficiently increase the UDP receive buffer affects HTTP/3 performance and does not prevent HTTPS, WebSockets, WebRTC audio, or certificate renewal. It can be ignored for this small deployment.

### 11. Safely remove QuickComms

Run the cleanup script from the repository root:

```bash
cd ~/QuickComms
chmod +x scripts/cleanup-vm.sh
sudo ./scripts/cleanup-vm.sh
```

The script removes only the containers, locally built images, networks, and volumes declared by this QuickComms Compose project. It does not target unrelated Docker projects or host applications. It preserves the firewall and `infrastructure/.env` by default.

To also remove the documented QuickComms UFW rules, request that action explicitly:

```bash
cd ~/QuickComms
sudo ./scripts/cleanup-vm.sh --remove-firewall
```

Firewall cleanup is opt-in because a universal script cannot determine whether another application also relies on one of these ports.

To also delete the deployment secrets:

```bash
cd ~/QuickComms
sudo ./scripts/cleanup-vm.sh --purge-config
```

Options can be combined:

```bash
sudo ./scripts/cleanup-vm.sh --purge-config --remove-firewall
```

The cleanup is destructive for QuickComms Caddy volumes, including cached certificates, but Caddy can request a new certificate on the next deployment.

## Windows desktop client

The Windows client uses Tauri 2 and Microsoft Edge WebView2. It shares the same HTML, CSS, WebRTC, and room experience as the browser client, but its push-to-talk key is registered with Windows and works while another application has focus.

### Download a Windows installer from GitHub Actions

The repository includes `.github/workflows/build-windows.yml`. It creates an x64 NSIS installer on GitHub's Windows runner whenever relevant desktop/client files are pushed to `main`, and it can also be started manually:

1. Open the repository's **Actions** tab.
2. Select **Build Windows installer**.
3. Open the latest successful run, or choose **Run workflow**.
4. Download the `QuickComms-Windows-x64` artifact.
5. Extract the ZIP and run the included `QuickComms_*_x64-setup.exe` installer.

The current installer is not code-signed, so Windows SmartScreen may show an **Unknown publisher** warning. Only install artifacts produced from a repository and commit that you trust. Code signing is required before distributing it broadly.

### Build directly on Windows

Install these prerequisites:

- [Node.js LTS](https://nodejs.org/)
- [Rust using rustup](https://www.rust-lang.org/tools/install) with the MSVC toolchain
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** selected
- Microsoft Edge WebView2 Runtime, if it is not already present (it is normally included with current Windows 10 and Windows 11 systems)

Then use PowerShell:

```powershell
git clone https://github.com/Kaizenick/QuickComms.git
cd QuickComms
npm install
npm run desktop:build:windows
```

The installer is created under:

```text
src-tauri\target\release\bundle\nsis\
```

For a development build with the WebView inspector available:

```powershell
npm install
npm run desktop:dev
```

### First launch and push-to-talk

1. Open **Server settings**.
2. Enter the complete public server URL, for example `https://your-subdomain.duckdns.org:8443`. It is stored locally, so this is normally required only once.
3. Enter a display name and room code, then join.
4. Set **Transmission** to **Push to talk**.
5. Select **Keyboard shortcut** and press the desired key.
6. Confirm that the interface says the global shortcut is active, minimize QuickComms, focus the game, and test it with another player.

If Windows or another application already owns the selected shortcut, QuickComms displays an error and asks for another key. A bare shortcut may also prevent that key from reaching the game, so choose a key that the game does not need.

Closing or leaving the room unregisters the shortcut. The selected server, transmission mode, and key are saved locally for later sessions.

## macOS desktop client

The macOS client uses the same Tauri application and global push-to-talk implementation. The automated build produces one universal DMG that runs natively on Apple Silicon and Intel Macs.

### Download the macOS DMG from GitHub Actions

The repository includes `.github/workflows/build-macos.yml`. It builds automatically when relevant desktop/client files are pushed to `main`, and it can be started manually:

1. Open the repository's **Actions** tab.
2. Select **Build macOS installer**.
3. Open the latest successful run, or choose **Run workflow**.
4. Download the `QuickComms-macOS-Universal` artifact.
5. Extract the ZIP, open the DMG, and drag QuickComms into **Applications**.

This development build is ad-hoc signed but not notarized with an Apple Developer ID. On first launch, macOS may block it because the developer cannot be verified. Control-click QuickComms in **Applications**, choose **Open**, and confirm. If macOS still blocks it, open **System Settings → Privacy & Security** and choose **Open Anyway** for QuickComms. Only bypass Gatekeeper for an artifact produced from a repository and commit that you trust.

### Build directly on a Mac

Install Xcode Command Line Tools, [Node.js LTS](https://nodejs.org/), and [Rust using rustup](https://www.rust-lang.org/tools/install). Then run:

```bash
git clone https://github.com/Kaizenick/QuickComms.git
cd QuickComms
npm install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:build:macos
```

The universal DMG is created under:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

### First launch and push-to-talk

1. Enter the complete QuickComms server URL in **Server settings**. This is saved locally after the first successful use.
2. Permit microphone access when macOS asks. If permission was denied, enable QuickComms under **System Settings → Privacy & Security → Microphone**.
3. Join a room and set **Transmission** to **Push to talk**.
4. Select **Keyboard shortcut**, press the desired key, and confirm that the global shortcut is active.
5. Focus the game and test with another player.

If macOS or another application already owns the shortcut, select another key. The DMG is suitable for private testing; public distribution requires Developer ID signing and Apple notarization.

## Testing

Install the additional test dependency and run:

```bash
cd server
pip install httpx pytest
pytest
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

1. System tray operation
2. Short-lived TURN credentials
3. Automatic reconnect after network changes
4. Signed Windows installer and notarized macOS release
