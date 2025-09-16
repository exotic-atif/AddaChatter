// Simple WebRTC + WebSocket client
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let ws;
let localStream = null;
const pcs = {}; // peerId -> RTCPeerConnection
const remoteEls = {};
let myId = null;

const preJoinEl = document.getElementById('pre-join');
const callViewEl = document.getElementById('call-view');
const localVid = document.getElementById('local');
const remotes = document.getElementById('remotes');
const joinBtn = document.getElementById('join');
const leaveBtn = document.getElementById('leave');
const roomInput = document.getElementById('room');
const statusEl = document.getElementById('status');
const muteBtn = document.getElementById('mute');
const camBtn = document.getElementById('cam');

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let audioMuted = false, videoStopped = false;

function logStatus(s) { 
  statusEl.textContent = 'Status: ' + s; 
}

async function startLocal() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVid.srcObject = localStream;
}

function send(msg) { 
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); 
}

function ensurePC(peerId) {
  if (pcs[peerId]) return pcs[peerId];
  const pc = new RTCPeerConnection(rtcConfig);
  if (localStream) {
    for (const t of localStream.getTracks()) {
      pc.addTrack(t, localStream);
    }
  }
  pc.onicecandidate = e => { 
    if (e.candidate) send({ type: 'candidate', target: peerId, candidate: e.candidate }); 
  };
  pc.ontrack = evt => {
    let el = remoteEls[peerId];
    if (!el) {
      const wrap = document.createElement('div');
      wrap.className = 'video-wrap';
      const v = document.createElement('video'); 
      v.autoplay = true; 
      v.playsInline = true; 
      v.id = 'r-' + peerId; 
      wrap.appendChild(v);
      const lbl = document.createElement('div'); 
      lbl.className = 'label'; 
      lbl.textContent = peerId.slice(0, 6); 
      wrap.appendChild(lbl);
      remotes.appendChild(wrap);
      remoteEls[peerId] = v;
      el = v;
    }
    if (el.srcObject !== evt.streams[0]) el.srcObject = evt.streams[0];
  };
  pc.onconnectionstatechange = () => { 
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      try { pc.close() } catch {} 
      delete pcs[peerId]; 
      const el = document.getElementById('r-' + peerId); 
      if (el && el.parentNode) el.parentNode.remove(); 
    } 
  };
  pcs[peerId] = pc; 
  return pc;
}

async function handleOffer(from, sdp) {
  const pc = ensurePC(from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  send({ type: 'answer', target: from, sdp: pc.localDescription });
}

async function handleAnswer(from, sdp) {
  const pc = ensurePC(from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleCandidate(from, candidate) {
  const pc = ensurePC(from);
  try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn(e); }
}

function connectWS(room) {
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => { 
    logStatus('connected'); 
    send({ type: 'join', room }); 
  });
  ws.addEventListener('message', async (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'welcome') {
      myId = data.id;
      for (const peer of data.peers) {
        const pc = ensurePC(peer);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'offer', target: peer, sdp: pc.localDescription });
      }
    }
    if (data.type === 'new-peer') { /* someone joined - they'll offer */ }
    if (data.type === 'offer') await handleOffer(data.from, data.sdp);
    if (data.type === 'answer') await handleAnswer(data.from, data.sdp);
    if (data.type === 'candidate') await handleCandidate(data.from, data.candidate);
    if (data.type === 'peer-left') {
      const id = data.id;
      if (pcs[id]) { 
        try { pcs[id].close() } catch {} 
        delete pcs[id]; 
        const el = document.getElementById('r-' + id); 
        if (el && el.parentNode) el.parentNode.remove(); 
      }
    }
  });
  ws.addEventListener('close', () => logStatus('disconnected'));
  ws.addEventListener('error', () => logStatus('signalling error'));
}

joinBtn.onclick = async () => {
  try { 
    if (!localStream) await startLocal(); 
    connectWS(roomInput.value || 'default'); 
    logStatus('joining...');
    preJoinEl.style.display = 'none';
    callViewEl.style.display = 'block';
  } catch (e) { 
    alert('Camera/Mic access needed'); 
  }
};

leaveBtn.onclick = () => {
  for (const k of Object.keys(pcs)) { 
    try { pcs[k].close() } catch {} 
    delete pcs[k]; 
  }
  remotes.innerHTML = '';
  if (localStream) { 
    for (const t of localStream.getTracks()) t.stop(); 
    localStream = null; 
    localVid.srcObject = null; 
  }
  if (ws && ws.readyState === WebSocket.OPEN) { 
    send({ type: 'leave' }); 
    ws.close(); 
  }
  logStatus('left');
  callViewEl.style.display = 'none';
  preJoinEl.style.display = 'flex';
};

muteBtn.onclick = () => {
  if (!localStream) return;
  audioMuted = !audioMuted;
  for (const t of localStream.getAudioTracks()) t.enabled = !audioMuted;
  muteBtn.innerHTML = audioMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  muteBtn.title = audioMuted ? 'Unmute' : 'Mute';
};

camBtn.onclick = () => {
  if (!localStream) return;
  videoStopped = !videoStopped;
  for (const t of localStream.getVideoTracks()) t.enabled = !videoStopped;
  camBtn.innerHTML = videoStopped ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
  camBtn.title = videoStopped ? 'Start Camera' : 'Stop Camera';
};