const $ = (id) => document.getElementById(id);

const state = {
  socket: null,
  stream: null,
  clientId: crypto.randomUUID().replaceAll("-", ""),
  name: "",
  room: "",
  peers: new Map(),
  peerNames: new Map(),
  muted: false,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const elements = {
  joinView: $("joinView"), roomView: $("roomView"), name: $("nameInput"),
  room: $("roomInput"), join: $("joinButton"), error: $("joinError"),
  server: $("serverInput"),
  badge: $("connectionBadge"), roomCode: $("roomCode"), participants: $("participantList"),
  mic: $("microphoneSelect"), speaker: $("speakerSelect"), mute: $("muteButton"),
  leave: $("leaveButton"), copy: $("copyRoom"), random: $("randomRoom"),
  audio: $("audioContainer"),
};

elements.name.value = localStorage.getItem("quickcomms-name") || "";
elements.room.value = new URLSearchParams(location.search).get("room") || randomCode();
elements.server.value = localStorage.getItem("quickcomms-server") || "";

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function signalingUrl(room, name) {
  const configured = elements.server.value.trim().replace(/^http/, "ws");
  const base = configured || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return `${base.replace(/\/$/, "")}/ws/${room}/${state.clientId}?name=${encodeURIComponent(name)}`;
}

async function joinRoom() {
  state.name = elements.name.value.trim();
  state.room = elements.room.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  elements.error.textContent = "";
  if (!state.name || state.room.length < 4) {
    elements.error.textContent = "Enter your name and a room code of at least four characters.";
    return;
  }
  elements.join.disabled = true;
  elements.join.textContent = "Connecting…";
  try {
    const configuredServer = elements.server.value.trim().replace(/\/$/, "");
    if (configuredServer) localStorage.setItem("quickcomms-server", configuredServer);
    else localStorage.removeItem("quickcomms-server");
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const response = await fetch(`${configuredServer}/api/config`);
    if (response.ok) state.iceServers = (await response.json()).iceServers;
    await refreshDevices();
    openSocket();
  } catch (error) {
    stopLocalStream();
    elements.error.textContent = error.name === "NotAllowedError"
      ? "Microphone permission was denied. Allow access and try again."
      : `Could not start voice: ${error.message}`;
    resetJoinButton();
  }
}

function openSocket() {
  state.socket = new WebSocket(signalingUrl(state.room, state.name));
  state.socket.addEventListener("message", async ({ data }) => {
    const message = JSON.parse(data);
    await handleSignal(message);
  });
  state.socket.addEventListener("close", (event) => {
    if (!elements.roomView.classList.contains("hidden")) {
      leaveRoom(event.reason || "Connection closed");
    } else {
      resetJoinButton();
      if (event.reason) elements.error.textContent = event.reason;
    }
  });
  state.socket.addEventListener("error", () => {
    elements.error.textContent = "Cannot reach the voice server.";
    resetJoinButton();
  });
}

async function handleSignal(message) {
  if (message.type === "welcome") {
    localStorage.setItem("quickcomms-name", state.name);
    elements.joinView.classList.add("hidden");
    elements.roomView.classList.remove("hidden");
    elements.roomCode.textContent = state.room;
    setOnline(true);
    state.peerNames.set(state.clientId, state.name);
    renderParticipants();
    for (const peer of message.peers) {
      state.peerNames.set(peer.id, peer.name);
      await createOffer(peer.id);
    }
    return;
  }
  if (message.type === "peer-joined") {
    state.peerNames.set(message.peer.id, message.peer.name);
    renderParticipants();
    return;
  }
  if (message.type === "peer-left") {
    removePeer(message.peerId);
    return;
  }
  if (message.type === "offer") {
    const connection = createPeer(message.sender);
    await connection.setRemoteDescription(message.sdp);
    await connection.setLocalDescription(await connection.createAnswer());
    send({ type: "answer", target: message.sender, sdp: connection.localDescription });
    return;
  }
  if (message.type === "answer") {
    await state.peers.get(message.sender)?.setRemoteDescription(message.sdp);
    return;
  }
  if (message.type === "ice-candidate" && message.candidate) {
    await state.peers.get(message.sender)?.addIceCandidate(message.candidate);
  }
}

function createPeer(peerId) {
  if (state.peers.has(peerId)) return state.peers.get(peerId);
  const connection = new RTCPeerConnection({ iceServers: state.iceServers });
  state.stream.getTracks().forEach((track) => connection.addTrack(track, state.stream));
  connection.onicecandidate = ({ candidate }) => {
    if (candidate) send({ type: "ice-candidate", target: peerId, candidate });
  };
  connection.ontrack = ({ streams }) => attachAudio(peerId, streams[0]);
  connection.onconnectionstatechange = () => {
    renderParticipants();
    if (["failed", "closed"].includes(connection.connectionState)) removePeer(peerId);
  };
  state.peers.set(peerId, connection);
  return connection;
}

async function createOffer(peerId) {
  const connection = createPeer(peerId);
  await connection.setLocalDescription(await connection.createOffer());
  send({ type: "offer", target: peerId, sdp: connection.localDescription });
}

function attachAudio(peerId, stream) {
  let audio = document.querySelector(`audio[data-peer="${peerId}"]`);
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.dataset.peer = peerId;
    elements.audio.append(audio);
  }
  audio.srcObject = stream;
  if (elements.speaker.value && typeof audio.setSinkId === "function") {
    audio.setSinkId(elements.speaker.value).catch(() => {});
  }
}

function send(message) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
}

function removePeer(peerId) {
  state.peers.get(peerId)?.close();
  state.peers.delete(peerId);
  state.peerNames.delete(peerId);
  document.querySelector(`audio[data-peer="${peerId}"]`)?.remove();
  renderParticipants();
}

function renderParticipants() {
  elements.participants.replaceChildren();
  for (const [id, name] of state.peerNames.entries()) {
    const self = id === state.clientId;
    const connected = self || state.peers.get(id)?.connectionState === "connected";
    const item = document.createElement("div");
    item.className = `participant ${connected ? "connected" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = name.slice(0, 1).toUpperCase();
    const info = document.createElement("div");
    info.className = "participant-info";
    const title = document.createElement("div");
    title.className = "participant-name";
    title.textContent = `${name}${self ? " (You)" : ""}`;
    const status = document.createElement("div");
    status.className = "participant-state";
    status.textContent = connected ? (self && state.muted ? "Muted" : "Connected") : "Connecting…";
    info.append(title, status);
    item.append(avatar, info);
    elements.participants.append(item);
  }
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  fillSelect(elements.mic, devices.filter((device) => device.kind === "audioinput"), "Microphone");
  fillSelect(elements.speaker, devices.filter((device) => device.kind === "audiooutput"), "Default speaker");
}

function fillSelect(select, devices, fallback) {
  const selected = select.value;
  select.replaceChildren();
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallback} ${index + 1}`;
    select.append(option);
  });
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function switchMicrophone() {
  const next = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: elements.mic.value } } });
  const track = next.getAudioTracks()[0];
  track.enabled = !state.muted;
  for (const connection of state.peers.values()) {
    await connection.getSenders().find((sender) => sender.track?.kind === "audio")?.replaceTrack(track);
  }
  state.stream.getTracks().forEach((old) => old.stop());
  state.stream = next;
}

function toggleMute() {
  state.muted = !state.muted;
  state.stream?.getAudioTracks().forEach((track) => { track.enabled = !state.muted; });
  elements.mute.classList.toggle("active", state.muted);
  elements.mute.querySelector("strong").textContent = state.muted ? "Unmute" : "Mute";
  elements.mute.querySelector("span").textContent = state.muted ? "🔇" : "🎙";
  renderParticipants();
}

function leaveRoom(message = "") {
  const socket = state.socket;
  state.socket = null;
  if (socket?.readyState === WebSocket.OPEN) socket.close(1000, "User left");
  for (const peerId of [...state.peers.keys()]) removePeer(peerId);
  state.peerNames.clear();
  stopLocalStream();
  elements.roomView.classList.add("hidden");
  elements.joinView.classList.remove("hidden");
  setOnline(false);
  resetJoinButton();
  if (message && message !== "User left") elements.error.textContent = message;
}

function stopLocalStream() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function setOnline(online) {
  elements.badge.textContent = online ? "Connected" : "Offline";
  elements.badge.classList.toggle("offline", !online);
}

function resetJoinButton() {
  elements.join.disabled = false;
  elements.join.textContent = "Join voice room";
}

elements.join.addEventListener("click", joinRoom);
elements.random.addEventListener("click", () => { elements.room.value = randomCode(); });
elements.mute.addEventListener("click", toggleMute);
elements.leave.addEventListener("click", () => leaveRoom());
elements.mic.addEventListener("change", () => switchMicrophone().catch((error) => alert(error.message)));
elements.speaker.addEventListener("change", () => {
  document.querySelectorAll("audio").forEach((audio) => audio.setSinkId?.(elements.speaker.value));
});
elements.copy.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.room);
  elements.copy.textContent = "Copied!";
  setTimeout(() => { elements.copy.textContent = "Copy invite code"; }, 1200);
});
elements.room.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
window.addEventListener("beforeunload", () => state.socket?.close());
navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
