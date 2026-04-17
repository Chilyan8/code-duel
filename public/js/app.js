/* ============================================================
   CODE DUEL — App complète (réécriture propre)
   ============================================================ */

// ── État global ────────────────────────────────────────────
const S = {
  token:  localStorage.getItem('token')  || null,
  pseudo: localStorage.getItem('pseudo') || null,
  elo:    parseInt(localStorage.getItem('elo') || '1000'),
  avatar: localStorage.getItem('avatar') || '🧑‍🎓',

  // Duel
  roomCode: null, isHost: false, gameOptions: {},
  selectedOptions: { players:2, questions:40, time:30, category:'all', mode:'normal' },
  currentQ: null, selectedAnswers: [], answered: false,
  timerInterval: null, timerSecs: 30,
  powerups: { fifty50:1, timeBonus:1, stress:1 },
  allPlayers: [], gameMode: 'normal', hostPseudo: null,
  replayData: null,

  // Solo
  soloMode: 'training', soloCategory: 'all',
  soloQs: [], soloAnswers: [], soloIdx: 0,
  soloCorrect: 0, soloWrong: 0, soloStreak: 0, soloMaxStreak: 0,
  soloTimer: null, soloSecs: 30,

  // Questions cache
  questions: [],
};

const socket = io({ auth: { token: S.token } });

// ── Audio ──────────────────────────────────────────────────
let _audio = null;
function tone(f, t='sine', d=.15, v=.3) {
  try {
    if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
    const o = _audio.createOscillator(), g = _audio.createGain();
    o.connect(g); g.connect(_audio.destination);
    o.frequency.value = f; o.type = t;
    g.gain.setValueAtTime(v, _audio.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, _audio.currentTime + d);
    o.start(); o.stop(_audio.currentTime + d);
  } catch {}
}
const sfx = {
  correct: () => { tone(523,.1); setTimeout(() => tone(659,'sine',.15), 100); },
  wrong:   () => tone(220, 'sawtooth', .2, .2),
  start:   () => [261,329,392,523].forEach((f,i) => setTimeout(() => tone(f,'sine',.15), i*100)),
  win:     () => [523,659,784,1047].forEach((f,i) => setTimeout(() => tone(f,'sine',.2), i*150)),
};

// ── Navigation ─────────────────────────────────────────────
// go() replaced above

// ─── NAVIGATION ──────────────────────────────────────────────
let _currentScreen = 'screen-home';

function go(screenId) {
  _currentScreen = screenId;
  // Hide ALL screens without exception
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.removeAttribute('style'); // clear ALL inline styles
  });
  // Show target
  const target = document.getElementById(screenId);
  if (!target) return;
  target.classList.add('active');
  // Side effects
  if (screenId === 'screen-home')        updateHomeUI();
  if (screenId === 'screen-leaderboard') loadLeaderboard();
  if (screenId === 'screen-profile')     loadProfile();
}

function openProfile() { go('screen-profile'); }

function updateHomeUI() {
  const el = document.getElementById('home-user');
  if (S.pseudo) {
    const av = S.avatar.startsWith('data:') ? `<img src="${S.avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle">` : S.avatar;
    el.innerHTML = `${av} <strong>${S.pseudo}</strong> · ${S.elo} Elo`;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, d=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), d);
}

function err(id, msg) {
  const e = document.getElementById(id);
  if (e) { e.textContent = msg; e.classList.remove('hidden'); }
}
function clearErr(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── Auth ───────────────────────────────────────────────────
async function doLogin() {
  clearErr('login-err');
  const pseudo = document.getElementById('login-pseudo').value.trim();
  const password = document.getElementById('login-password').value;
  if (!pseudo || !password) return err('login-err', 'Remplis tous les champs');
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo, password })
    });
    const d = await r.json();
    if (!r.ok) return err('login-err', d.error || 'Erreur');
    saveAuth(d);
    toast(`Bienvenue ${pseudo} ! 🎉`);
    go('screen-home');
  } catch { err('login-err', 'Erreur réseau'); }
}

async function doRegister() {
  clearErr('reg-err');
  const pseudo = document.getElementById('reg-pseudo').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!pseudo || !password) return err('reg-err', 'Remplis tous les champs');
  if (pseudo.length < 3) return err('reg-err', 'Pseudo trop court (min 3)');
  if (password.length < 4) return err('reg-err', 'Mot de passe trop court (min 4)');
  try {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo, password })
    });
    const d = await r.json();
    if (!r.ok) return err('reg-err', d.error || 'Erreur');
    saveAuth(d);
    toast(`Compte créé ! Bienvenue ${pseudo} 🚗`);
    go('screen-home');
  } catch (e) { err('reg-err', 'Erreur serveur : ' + e.message); }
}

function saveAuth(d) {
  S.token = d.token; S.pseudo = d.pseudo; S.elo = d.elo || 1000;
  if (d.avatar) S.avatar = d.avatar;
  localStorage.setItem('token',  S.token);
  localStorage.setItem('pseudo', S.pseudo);
  localStorage.setItem('elo',    S.elo);
  localStorage.setItem('avatar', S.avatar);
  socket.auth = { token: S.token };
}

function doLogout() {
  ['token','pseudo','elo','avatar'].forEach(k => localStorage.removeItem(k));
  S.token = null; S.pseudo = null; S.elo = 0; S.avatar = '🧑‍🎓';
  toast('Déconnecté 👋');
  go('screen-home');
}

function switchAuthTab(tab) {
  document.getElementById('auth-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('auth-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

function promptGuest() {
  const p = prompt('Choisis un pseudo invité :');
  if (p && p.trim().length >= 2) {
    S.pseudo = p.trim().slice(0, 20);
    localStorage.setItem('pseudo', S.pseudo);
    go('screen-home');
  }
}

// ── Profile ────────────────────────────────────────────────
async function loadProfile() {
  const pc = document.getElementById('profile-content');

  if (!S.token) {
    pc.innerHTML = `
      <div style="text-align:center;padding:2rem">
        <div style="font-size:3rem;margin-bottom:1rem">👤</div>
        <p style="font-weight:700;margin-bottom:.5rem">Connecte-toi pour voir ton profil</p>
        <p style="color:var(--text2);font-size:.9rem;margin-bottom:1.5rem">Tes stats et badges sont sauvegardés avec ton compte.</p>
        <button class="btn btn-primary" onclick="go('screen-auth')">Se connecter</button>
      </div>`;
    return;
  }

  pc.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';

  try {
    const r = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + S.token } });
    if (r.status === 401) { doLogout(); return; }
    const d = await r.json();

    const wins = d.wins || 0, losses = d.losses || 0, games = d.total_games || 0;
    const correct = d.total_correct || 0, questions = d.total_questions || 0;
    const acc = questions > 0 ? Math.round(correct / questions * 100) : 0;
    const winRate = games > 0 ? Math.round(wins / games * 100) : 0;
    const avgPerGame = games > 0 ? (correct / games).toFixed(1) : '0';
    const secs = d.total_seconds || 0;
    const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
    const timeStr = h > 0 ? `${h}h ${m}min` : `${m} min`;

    const lv = d.level || { name:'🔰 Apprenti', next:1020, level:1 };
    const eloBase = {1:0,2:1000,3:1020,4:1080,5:1150,6:1250}[lv.level] || 0;
    const eloRange = lv.next ? lv.next - eloBase : 1;
    const eloProgress = lv.next ? Math.min(100, Math.round((d.elo - eloBase) / eloRange * 100)) : 100;

    const avatar = d.avatar || S.avatar || '🧑‍🎓';
    S.avatar = avatar; localStorage.setItem('avatar', avatar);
    const avHtml = avatar.startsWith('data:')
      ? `<img src="${avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : `<span style="font-size:2.5rem">${avatar}</span>`;

    const badges = d.badges || [];
    const catStats = d.category_stats || {};
    const weakCats = Object.entries(catStats)
      .filter(([,s]) => s.sessions > 0)
      .sort((a,b) => (b[1].errors/b[1].sessions) - (a[1].errors/a[1].sessions))
      .slice(0, 4);

    pc.innerHTML = `
      <div style="text-align:center;padding:.5rem 0 1.5rem">
        <div class="profile-avatar-wrap" onclick="openAvatarModal()">
          <div class="profile-avatar-img" id="prof-av">${avHtml}</div>
          <div class="avatar-edit-btn">✏️</div>
        </div>
        <div style="font-size:1.3rem;font-weight:800;margin:.4rem 0 .2rem">${d.pseudo}</div>
        <div style="color:var(--accent2);font-weight:700">${lv.name}</div>
        <div style="color:var(--text2);font-size:.85rem">${d.elo} Elo${lv.next ? ` · encore ${lv.next - d.elo} pts` : ' · Niveau max 🏆'}</div>
        <div style="width:180px;margin:.6rem auto 0">
          <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${eloProgress}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;transition:width 1s"></div>
          </div>
          <div style="font-size:.72rem;color:var(--text3);text-align:center;margin-top:.2rem">${eloProgress}% vers le prochain niveau</div>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:.85rem 1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
        <span style="font-size:1.5rem">⏱️</span>
        <div><div style="font-weight:700">${timeStr}</div><div style="color:var(--text2);font-size:.78rem">passées sur le site</div></div>
        <div style="margin-left:auto;text-align:right"><div style="font-weight:700">${games}</div><div style="color:var(--text2);font-size:.78rem">parties jouées</div></div>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat"><div class="ps-num">${wins}</div><div class="ps-label">✅ Victoires</div></div>
        <div class="profile-stat"><div class="ps-num">${losses}</div><div class="ps-label">❌ Défaites</div></div>
        <div class="profile-stat"><div class="ps-num">${winRate}%</div><div class="ps-label">🏆 Taux victoire</div></div>
        <div class="profile-stat"><div class="ps-num">${acc}%</div><div class="ps-label">🎯 Précision</div></div>
        <div class="profile-stat"><div class="ps-num">${avgPerGame}</div><div class="ps-label">📊 Moy/partie</div></div>
        <div class="profile-stat"><div class="ps-num">${correct}</div><div class="ps-label">✔️ Bonnes rép.</div></div>
      </div>

      <div style="font-size:.8rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:1.1rem 0 .6rem">🎖️ Badges (${badges.length})</div>
      ${badges.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">${badges.map(b => `<span style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);color:var(--yellow);padding:.3rem .75rem;border-radius:16px;font-size:.82rem">${b}</span>`).join('')}</div>`
        : `<div style="color:var(--text3);font-size:.85rem;margin-bottom:.5rem">Aucun badge encore — joue pour en débloquer ! 💪</div>`}

      <div style="font-size:.8rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:1.1rem 0 .6rem">📊 Analyse par thème</div>
      ${weakCats.length
        ? weakCats.map(([cat, s]) => {
            const pct = Math.round(s.errors / s.sessions * 100);
            const col = pct >= 60 ? '#f87171' : pct >= 30 ? '#fbbf24' : '#4ade80';
            return `<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem">
              <span style="font-size:.82rem;width:110px;flex-shrink:0">${catName(cat)}</span>
              <div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${col};border-radius:4px;transition:width .8s"></div>
              </div>
              <span style="font-size:.78rem;color:${col};width:36px;text-align:right">${pct}%</span>
            </div>`;
          }).join('') + `<button class="btn btn-primary w-full" style="margin-top:.75rem" onclick="startSolo('training')">🧠 Entraînement ciblé</button>`
        : `<div style="color:var(--text3);font-size:.85rem">Joue des parties pour voir ton analyse !</div>`}

      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="go('screen-home')">🏠 Accueil</button>
        <button class="btn btn-ghost" onclick="go('screen-play')">⚔️ Duel</button>
        <button class="btn btn-ghost" onclick="startSolo('examen_blanc')">📋 Examen</button>
        <button class="btn btn-ghost-sm" onclick="doLogout()" style="margin-left:auto;color:var(--red)">Déconnexion</button>
      </div>`;
  } catch(e) {
    pc.innerHTML = `<div style="text-align:center;padding:2rem">
      <p style="color:var(--red);margin-bottom:1rem">Erreur : ${e.message}</p>
      <button class="btn btn-primary" onclick="go('screen-auth')">Se connecter</button>
      <div style="margin-top:.75rem"><button class="btn btn-ghost" onclick="go('screen-home')">🏠 Accueil</button></div>
    </div>`;
  }
}

// ── Avatar ─────────────────────────────────────────────────
const AVATARS = ['🧑‍🎓','👨‍🚗','👩‍🚗','🏎️','🚗','🚕','🚙','🏍️','🚓','🚑','👮','🦸','🧙','🎮','🔥','⚡','🌟','👑','🎯','🏆','💎','🦊','🐺','🐯','🦁','🤖','🦅','🐸','🧑‍✈️','🎭'];

function openAvatarModal() {
  document.getElementById('emoji-avatars').innerHTML = AVATARS.map(e =>
    `<div class="avatar-option" onclick="pickAvatar('${e}')">${e}</div>`
  ).join('');
  document.getElementById('avatar-modal').classList.remove('hidden');
}

function closeAvatarModal(e) {
  if (!e || e.target.id === 'avatar-modal') document.getElementById('avatar-modal').classList.add('hidden');
}

async function pickAvatar(emoji) {
  S.avatar = emoji;
  localStorage.setItem('avatar', emoji);
  document.getElementById('avatar-modal').classList.add('hidden');
  const el = document.getElementById('prof-av');
  if (el) el.innerHTML = `<span style="font-size:2.5rem">${emoji}</span>`;
  await saveAvatar(emoji);
  updateHomeUI();
  toast(`Avatar mis à jour : ${emoji}`);
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 500000) { toast('Image trop grande ! Max 500kb'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const size = 150;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const ratio = Math.min(size/img.width, size/img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      S.avatar = dataUrl; localStorage.setItem('avatar', dataUrl);
      document.getElementById('avatar-modal').classList.add('hidden');
      const el = document.getElementById('prof-av');
      if (el) el.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      await saveAvatar(dataUrl);
      updateHomeUI();
      toast('Photo mise à jour ! 📸');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveAvatar(av) {
  if (!S.token) return;
  try {
    await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: av })
    });
  } catch {}
}

// ── Helpers ────────────────────────────────────────────────
const catNames = {
  priorites:'🚦 Priorités', panneaux:'🪧 Panneaux', vitesse:'⚡ Vitesses',
  alcool:'🍺 Alcool', regles:'📋 Règles', securite:'🛡️ Sécurité',
  vehicule:'🔧 Véhicule', permis:'📄 Permis', situation:'🚗 Situation', international:'🌍 International'
};
function catName(c) { return catNames[c] || c; }
function modeName(m) {
  return {normal:'🎯 Normal',blitz:'⚡ Blitz',examen_blanc:'📋 Examen',piege:'😈 Piège',micro:'⚡ Micro',international:'🌍 International',training:'🧠 Entraînement',libre:'📚 Libre'}[m] || m;
}

const COACH_TIPS = {
  priorites: ["Priorité à droite SAUF panneau contraire 🚦", "STOP = arrêt TOTAL obligatoire 🛑", "Cédez ≠ arrêt obligatoire 🔺"],
  panneaux:  ["Rouge = interdit, Bleu = obligation, Triangle = danger 🪧", "Carré jaune = route prioritaire 💛", "Rond bleu + chiffre = vitesse MINIMALE 🔵"],
  vitesse:   ["Autoroute : 130 sec, 110 pluie ⚡", "Ville = 50 km/h par défaut 🏙️", "Permis probatoire : 110 max autoroute 🔰"],
  alcool:    ["0,5 g/L standard · 0,2 g/L jeune conducteur 🍺", "Seul le TEMPS élimine l'alcool ☕"],
  securite:  ["Gilet AVANT de sortir du véhicule 🦺", "PAS = Protéger, Alerter, Secourir 🚨"],
  regles:    ["Ligne continue = jamais franchir ⚡", "Ceinture avant ET arrière 🔒"],
  international: ["UK roule à gauche ! 🇬🇧", "Autobahn souvent sans limite 🇩🇪"],
};
function coachTip(cat) {
  const tips = COACH_TIPS[cat] || ["Lis bien la question ! 📖", "Prends le temps de réfléchir ⏱️"];
  return tips[Math.floor(Math.random() * tips.length)];
}

// ── Play screen ────────────────────────────────────────────
function showCreateForm() {
  if (!S.pseudo) { promptGuest(); return; }
  const f = document.getElementById('create-form');
  f.classList.toggle('hidden');
  document.getElementById('join-form').classList.add('hidden');
}
function showJoinForm() {
  if (!S.pseudo) { promptGuest(); return; }
  const f = document.getElementById('join-form');
  f.classList.toggle('hidden');
  document.getElementById('create-form').classList.add('hidden');
}
function selectOpt(type, val, el) {
  el.closest('.option-pills').querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  S.selectedOptions[type] = val;
}
function selectMode(mode, el) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  S.selectedOptions.mode = mode;
}
function openCreateGame() {
  if (!S.pseudo) { promptGuest(); return; }
  clearErr('play-err');
  socket.emit('create_game', {
    pseudo: S.pseudo, avatar: S.avatar,
    options: {
      maxPlayers:    S.selectedOptions.players,
      questionCount: S.selectedOptions.questions,
      timeLimit:     S.selectedOptions.time,
      category:      S.selectedOptions.category,
      mode:          S.selectedOptions.mode,
    }
  });
}
function doJoinGame() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length < 4) return err('join-err', 'Code invalide');
  clearErr('join-err');
  socket.emit('join_game', { roomCode: code, pseudo: S.pseudo, avatar: S.avatar });
}
function copyRoomCode() {
  navigator.clipboard.writeText(document.getElementById('display-room-code').textContent)
    .then(() => toast('Code copié ! 📋'));
}
function sendReady() {
  const btn = document.getElementById('btn-ready');
  btn.disabled = true; btn.textContent = '⏳ En attente...';
  socket.emit('player_ready');
}
function forceStart() { socket.emit('force_start'); }
function requestRematch() {
  document.getElementById('btn-rematch').disabled = true;
  socket.emit('request_rematch');
}

// ── Waiting room ───────────────────────────────────────────
function renderWaiting(players, maxPlayers) {
  const c = document.getElementById('players-waiting'); c.innerHTML = '';
  for (let i = 0; i < maxPlayers; i++) {
    const p = players[i];
    const div = document.createElement('div');
    div.className = 'waiting-player ' + (p ? 'connected' : 'empty');
    if (p) {
      const av = p.avatar
        ? (p.avatar.startsWith('data:') ? `<img src="${p.avatar}" class="wp-avatar-img">` : `<span style="font-size:1.2rem">${p.avatar}</span>`)
        : p.pseudo[0].toUpperCase();
      div.innerHTML = `<div class="wp-avatar connected">${av}</div>
        <div><div class="wp-name">${p.pseudo}${p.pseudo===S.pseudo?' <small style="color:var(--accent2)">(toi)</small>':''}</div>
        <div class="wp-tag">${i===0?'👑 Hôte':'Joueur '+(i+1)}</div></div>
        <div class="wp-status">${p.ready?'✅':'⏳'}</div>`;
    } else {
      div.innerHTML = `<div class="wp-avatar">?</div>
        <div><div class="wp-name" style="color:var(--text3)">En attente...</div><div class="wp-tag">Joueur ${i+1}</div></div>
        <div class="wp-status">⏳</div>`;
    }
    c.appendChild(div);
  }
  const me = players.find(p => p.pseudo === S.pseudo);
  const btnR = document.getElementById('btn-ready');
  const btnF = document.getElementById('btn-force-start');
  if (me && !me.ready) { btnR.classList.remove('hidden'); btnR.disabled = false; btnR.textContent = '✅ Je suis prêt !'; }
  else if (me?.ready) { btnR.classList.remove('hidden'); btnR.disabled = true; btnR.textContent = '✅ Prêt !'; }
  if (S.isHost && players.length >= 2) btnF.classList.remove('hidden'); else btnF.classList.add('hidden');
  const msg = document.getElementById('waiting-msg');
  if (players.length < maxPlayers) { msg.innerHTML = `<div class="spinner"></div> En attente... (${players.length}/${maxPlayers})`; msg.style.display = 'flex'; }
  else msg.style.display = 'none';
}

function renderOptsDisplay(opts) {
  document.getElementById('options-display').innerHTML =
    [opts.maxPlayers+' joueurs', opts.questionCount+' questions', opts.timeLimit+'s', catName(opts.category), modeName(opts.mode)]
    .map(t => `<span class="options-tag">${t}</span>`).join('');
}

// ── Duel HUD ───────────────────────────────────────────────
function renderHUD() {
  const c = document.getElementById('hud-scores'); c.innerHTML = '';
  const max = Math.max(...S.allPlayers.map(p => p.score), 0);
  S.allPlayers.forEach(p => {
    const isMe = p.pseudo === S.pseudo;
    const av = p.avatar
      ? (p.avatar.startsWith('data:') ? `<img src="${p.avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover">` : `<span style="font-size:.85rem">${p.avatar}</span>`)
      : `<span style="font-size:.75rem;font-weight:700;color:var(--accent2)">${p.pseudo[0]}</span>`;
    const d = document.createElement('div');
    d.className = 'hud-player-score' + (isMe ? ' me' : '') + (p.score === max && max > 0 && !isMe ? ' leading' : '');
    d.innerHTML = `<div style="display:flex;align-items:center;gap:.2rem;width:24px">${av}</div>
      <div><div class="hps-name">${p.pseudo}</div>${p.answered ? '<div style="font-size:.6rem;color:var(--green)">✓</div>' : ''}</div>
      <div class="hps-score">${p.score}</div>
      ${p.streak >= 3 ? `<div style="font-size:.72rem">🔥${p.streak}</div>` : ''}`;
    c.appendChild(d);
  });
}

// ── Duel question ──────────────────────────────────────────
function renderDuelQuestion(data) {
  S.currentQ = data; S.selectedAnswers = []; S.answered = false;
  document.getElementById('q-counter').textContent = `${data.index+1}/${data.total}`;
  document.getElementById('q-category').textContent = catName(data.category);
  document.getElementById('q-text').textContent = data.question;
  document.getElementById('mode-badge').textContent = modeName(data.mode || S.gameMode);
  document.getElementById('game-progress').style.width = `${data.index/data.total*100}%`;
  document.getElementById('trap-indicator').classList.toggle('hidden', !data.isTrap);
  const sb = document.getElementById('situation-box');
  if (data.situation) { sb.textContent = '📍 ' + data.situation; sb.classList.remove('hidden'); } else sb.classList.add('hidden');
  const iw = document.getElementById('q-image-wrap');
  if (data.video_url) {
    iw.innerHTML = `<iframe src="${data.video_url}?controls=1&modestbranding=1&rel=0" style="width:100%;height:200px;border:none;border-radius:8px" allowfullscreen></iframe>`;
    iw.classList.remove('hidden');
  } else if (data.image_url) {
    iw.innerHTML = `<img id="q-image" src="${data.image_url}" alt="Illustration" style="max-width:100%;max-height:220px;object-fit:contain"/>`;
    iw.classList.remove('hidden');
    document.getElementById('q-image') && (document.getElementById('q-image').onerror = () => iw.classList.add('hidden'));
  } else { iw.innerHTML = ''; iw.classList.add('hidden'); }

  const cont = document.getElementById('answers-container'); cont.innerHTML = '';
  data.answers.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn'; btn.dataset.id = a.id;
    btn.textContent = a.id.toUpperCase() + ') ' + a.text;
    btn.addEventListener('click', () => {
      if (S.answered) return;
      if (data.isMultiple) {
        btn.classList.toggle('selected');
        const idx = S.selectedAnswers.indexOf(a.id);
        idx >= 0 ? S.selectedAnswers.splice(idx,1) : S.selectedAnswers.push(a.id);
        const cb = document.getElementById('confirm-btn'); if (cb) cb.disabled = S.selectedAnswers.length === 0;
      } else {
        submitDuelAnswer([a.id]);
      }
    });
    cont.appendChild(btn);
  });

  let cb = document.getElementById('confirm-btn');
  if (data.isMultiple) {
    if (!cb) { cb = document.createElement('button'); cb.id = 'confirm-btn'; cb.className = 'btn btn-primary confirm-btn'; cb.textContent = 'Valider ✅'; cb.addEventListener('click', () => { if (S.selectedAnswers.length) submitDuelAnswer(S.selectedAnswers); }); }
    cb.disabled = true; cont.after(cb);
  } else { cb?.remove(); }

  const fb = document.getElementById('answer-feedback'); fb.classList.add('hidden'); fb.className = 'answer-feedback hidden';
  ['fifty50','timeBonus','stress'].forEach(pu => { const b = document.getElementById('pu-'+pu); if (b) b.disabled = !S.powerups[pu]; });
  startTimer(data.timeLimit || 30);
  if (Math.random() < .25) showCoach(coachTip(data.category));
}

function submitDuelAnswer(answers) {
  if (S.answered) return; S.answered = true;
  const timeTaken = (S.currentQ?.timeLimit || 30) - S.timerSecs;
  document.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
  document.getElementById('confirm-btn')?.setAttribute('disabled', 'true');
  socket.emit('submit_answer', { answers, timeTaken });
  const fb = document.getElementById('answer-feedback');
  fb.className = 'answer-feedback neutral-fb';
  fb.innerHTML = '<div style="display:flex;align-items:center;gap:.5rem;color:var(--text2)"><div class="spinner"></div> En attente...</div>';
  fb.classList.remove('hidden');
}

function showDuelResult(data) {
  stopTimer();
  if (data.hidden) return;
  document.querySelectorAll('.answer-btn').forEach(btn => {
    if (data.correctAnswers?.includes(btn.dataset.id)) btn.classList.add('correct');
    else if (S.selectedAnswers.includes(btn.dataset.id)) btn.classList.add('wrong');
  });
  document.getElementById('screen-game').classList.add(data.isCorrect ? 'flash-correct' : 'flash-wrong');
  setTimeout(() => document.getElementById('screen-game').classList.remove('flash-correct','flash-wrong'), 600);
  if (data.isCorrect !== null) { data.isCorrect ? sfx.correct() : sfx.wrong(); }
  const fb = document.getElementById('answer-feedback');
  let html = '';
  if (data.timeout) html = '<strong>⏰ Temps écoulé !</strong><br>';
  else if (data.isCorrect) html = `<strong>✅ Bonne réponse !</strong>${data.streak>=3?` <span class="streak-fire">🔥 ${data.streak}</span>`:''}<br>`;
  else html = `<strong>❌ Mauvaise réponse</strong>${data.isTrap&&data.trapMessage?`<br><em>😏 ${data.trapMessage}</em>`:''}<br>`;
  if (data.explanation) html += `<span style="color:var(--text2);font-size:.85rem">💡 ${data.explanation}</span>`;
  if (data.trapStats) html += `<br><span style="color:var(--yellow);font-size:.78rem">📊 ${data.trapStats}</span>`;
  fb.className = `answer-feedback ${data.isCorrect ? 'correct-fb' : data.isCorrect === null ? 'neutral-fb' : 'wrong-fb'}`;
  fb.innerHTML = html; fb.classList.remove('hidden');
  if (data.isCorrect && data.streak >= 3) showCoach(`🔥 ${data.streak} en série !`);
  else if (data.isCorrect === false) showCoach(coachTip(S.currentQ?.category));
}

// ── Timer ──────────────────────────────────────────────────
function startTimer(secs) {
  stopTimer(); S.timerSecs = secs;
  const arc = document.getElementById('timer-arc'), maxD = 163.36;
  const tick = () => {
    document.getElementById('timer-text').textContent = S.timerSecs;
    arc.style.strokeDashoffset = maxD * (1 - S.timerSecs / secs);
    arc.style.stroke = S.timerSecs <= 5 ? '#f87171' : S.timerSecs <= 10 ? '#fbbf24' : '#4ade80';
    if (S.timerSecs > 0) S.timerSecs--; else stopTimer();
  };
  tick(); S.timerInterval = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(S.timerInterval); S.timerInterval = null; }

function showCoach(text) {
  const b = document.getElementById('coach-bubble');
  document.getElementById('coach-text').textContent = text;
  b.classList.remove('hidden'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.add('hidden'), 4500);
}

function usePowerup(type) {
  if (!S.powerups[type] || S.answered) return;
  S.powerups[type]--;
  document.getElementById('pu-'+type).disabled = true;
  socket.emit('use_powerup', { type });
}

// ── Duel results ───────────────────────────────────────────
function showDuelResults(data) {
  stopTimer(); go('screen-results');
  const banner = document.getElementById('victory-banner');
  if (data.isDraw) banner.textContent = '🤝 Match nul !';
  else if (data.winner === S.pseudo) { banner.textContent = '🏆 VICTOIRE !'; sfx.win(); }
  else banner.textContent = `🎖️ Victoire de ${data.winner} !`;

  document.getElementById('podium').innerHTML = data.results.map(r => {
    const isMe = r.pseudo === S.pseudo;
    const elo = r.eloChange ? `<div style="font-size:.82rem;font-weight:700;color:${r.eloChange>0?'var(--green)':'var(--red)'}">${r.eloChange>0?'+':''}${r.eloChange} Elo</div>` : '';
    return `<div class="podium-item rank-${r.rank} ${isMe?'me':''}">
      <div class="podium-rank">${['🥇','🥈','🥉'][r.rank-1]||r.rank+'.'}</div>
      <div class="podium-pseudo">${r.pseudo}${isMe?'<span class="podium-you">toi</span>':''}</div>
      <div><div class="podium-score">${r.score}<span style="font-size:.75rem;color:var(--text3)">/${r.total}</span></div><div class="podium-pct">${r.percentage}%</div></div>
      ${elo}
    </div>`;
  }).join('');

  const myR = data.results.find(r => r.pseudo === S.pseudo);
  if (myR?.eloChange) { S.elo += myR.eloChange; localStorage.setItem('elo', S.elo); }

  const an = document.getElementById('results-analysis'); an.innerHTML = '';
  if (myR && Object.keys(myR.categoryErrors||{}).length) {
    an.innerHTML = '<div class="analysis-title">📊 Tes erreurs</div>' +
      Object.entries(myR.categoryErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n]) =>
        `<div class="category-error"><span>${catName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`
      ).join('');
  }

  if (data.replayData?.length) {
    S.replayData = data.replayData;
    document.getElementById('replay-toggle').classList.remove('hidden');
  }

  const examEl = document.getElementById('exam-results-duel');
  if (data.examPassed?.length) {
    examEl.innerHTML = data.examPassed.map(p =>
      `<div class="exam-verdict ${p.passed?'admis':'recale'}">${p.pseudo} : ${p.passed?'✅ ADMIS':'❌ RECALÉ'}</div>`
    ).join('');
    examEl.classList.remove('hidden');
  }

  const btnR = document.getElementById('btn-rematch');
  if (S.pseudo === data.hostPseudo) btnR.classList.remove('hidden'); else btnR.classList.add('hidden');
}

function toggleReplay() {
  const rc = document.getElementById('replay-content');
  rc.classList.toggle('hidden');
  if (!rc.classList.contains('hidden') && S.replayData) {
    rc.innerHTML = S.replayData.slice(0, 10).map((q,i) =>
      `<div class="replay-item ${q.playerAnswers.every(p=>p.isCorrect)?'correct-q':'wrong-q'}">
        <div class="replay-q">${i+1}. ${q.question}</div>
        ${q.playerAnswers.map(p=>`<div class="replay-player"><span>${p.pseudo}</span><span>${p.isCorrect?'✅':'❌'} ${p.timeTaken?.toFixed(0)||'?'}s</span></div>`).join('')}
      </div>`
    ).join('');
  }
}

// ── SOLO MODE ──────────────────────────────────────────────
function showSoloScreen() { go('screen-solo'); document.getElementById('solo-category-picker').classList.add('hidden'); }
function selectSoloCat(cat, el) {
  document.querySelectorAll('#solo-category-picker .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active'); S.soloCategory = cat;
}

async function startSolo(mode) {
  if (!S.pseudo) { promptGuest(); if (!S.pseudo) return; }
  S.soloMode = mode;
  S.soloAnswers = []; S.soloIdx = 0;
  S.soloCorrect = 0; S.soloWrong = 0; S.soloStreak = 0; S.soloMaxStreak = 0;
  document.getElementById('solo-category-picker').classList.add('hidden');

  let questions = [];
  const count = mode === 'micro' ? 5 : mode === 'examen_blanc' ? 40 : 10;

  // Always try server first
  try {
    const headers = S.token ? { Authorization: 'Bearer ' + S.token } : {};
    const url = `/api/training/session?count=${count}&mode=${mode}&category=${S.soloCategory}`;
    const res = await fetch(url, { headers });
    const d = await res.json();
    questions = d.fullQuestions || [];
    if (d.weakCategories?.length && mode === 'training') {
      toast('Session ciblée : ' + d.weakCategories.map(c => catName(c)).join(', '), 3000);
    }
  } catch (e) { console.error('Session load error:', e); }

  if (!questions.length) { toast('Impossible de charger les questions, réessaie !'); return; }

  S.soloQs = questions;
  document.getElementById('solo-mode-badge').textContent = modeName(mode);
  go('screen-solo-game');
  renderSoloQ();
}

function renderSoloQ() {
  const q = S.soloQs[S.soloIdx];
  if (!q) { endSolo(); return; }
  const total = S.soloQs.length;
  const timeLimit = S.soloMode === 'micro' ? 15 : 30;

  document.getElementById('sq-counter').textContent = `${S.soloIdx+1}/${total}`;
  document.getElementById('sq-category').textContent = catName(q.category);
  document.getElementById('sq-text').textContent = q.question;
  document.getElementById('solo-progress').style.width = `${S.soloIdx/total*100}%`;
  document.getElementById('sq-correct').textContent = '✅ ' + S.soloCorrect;
  document.getElementById('sq-wrong').textContent   = '❌ ' + S.soloWrong;
  document.getElementById('sq-streak').textContent  = S.soloStreak >= 3 ? '🔥' + S.soloStreak : '';
  document.getElementById('sq-trap-indicator').classList.toggle('hidden', !q.is_trap);

  const sb = document.getElementById('sq-situation-box');
  if (q.situation) { sb.textContent = '📍 ' + q.situation; sb.classList.remove('hidden'); } else sb.classList.add('hidden');
  const iw = document.getElementById('sq-image-wrap');
  if (q.video_url) {
    iw.innerHTML = `<iframe src="${q.video_url}?controls=1&modestbranding=1&rel=0" style="width:100%;height:200px;border:none;border-radius:8px" allowfullscreen></iframe>`;
    iw.classList.remove('hidden');
  } else if (q.image_url) {
    iw.innerHTML = `<img src="${q.image_url}" alt="" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:8px"/>`;
    iw.classList.remove('hidden');
  } else { iw.innerHTML = ''; iw.classList.add('hidden'); }

  const cont = document.getElementById('sq-answers'); cont.innerHTML = '';
  q.answers.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn'; btn.dataset.id = a.id;
    btn.textContent = a.id.toUpperCase() + ') ' + a.text;
    if (q.correct.length > 1) {
      btn.addEventListener('click', () => btn.classList.toggle('selected'));
    } else {
      btn.addEventListener('click', () => submitSoloAnswer([a.id]));
    }
    cont.appendChild(btn);
  });

  let cb = document.getElementById('solo-confirm-btn');
  if (q.correct.length > 1) {
    if (!cb) {
      cb = document.createElement('button'); cb.id = 'solo-confirm-btn';
      cb.className = 'btn btn-primary confirm-btn'; cb.textContent = 'Valider ✅';
      cb.addEventListener('click', () => {
        const sel = [...cont.querySelectorAll('.answer-btn.selected')].map(b => b.dataset.id);
        if (sel.length) submitSoloAnswer(sel);
      });
    }
    cont.after(cb);
  } else { cb?.remove(); }

  document.getElementById('sq-feedback').classList.add('hidden');
  document.getElementById('sq-coach').classList.add('hidden');
  startSoloTimer(timeLimit);
}

function submitSoloAnswer(answers) {
  clearInterval(S.soloTimer);
  const q = S.soloQs[S.soloIdx];
  const ok = [...answers].sort().join(',') === [...q.correct].sort().join(',');
  S.soloAnswers.push({ questionIndex: S.soloIdx, answers, isCorrect: ok, timeTaken: 30 - S.soloSecs });

  document.querySelectorAll('#sq-answers .answer-btn').forEach(b => {
    b.disabled = true;
    if (q.correct.includes(b.dataset.id)) b.classList.add('correct');
    else if (answers.includes(b.dataset.id)) b.classList.add('wrong');
  });
  document.getElementById('solo-confirm-btn')?.setAttribute('disabled','true');

  if (ok) { S.soloCorrect++; S.soloStreak++; S.soloMaxStreak = Math.max(S.soloMaxStreak, S.soloStreak); sfx.correct(); }
  else { S.soloWrong++; S.soloStreak = 0; sfx.wrong(); }

  const fb = document.getElementById('sq-feedback');
  let html = '';
  if (ok) html = `<strong>✅ Bonne réponse !</strong>${S.soloStreak>=3?` <span class="streak-fire">🔥 ${S.soloStreak}</span>`:''}<br>`;
  else html = `<strong>❌ Mauvaise réponse</strong>${q.is_trap&&q.trap_message?`<br><em>😏 ${q.trap_message}</em>`:''}<br>`;
  if (q.explanation && S.soloMode !== 'blitz') html += `<span style="color:var(--text2);font-size:.85rem">💡 ${q.explanation}</span>`;
  if (q.is_trap) html += `<br><span style="color:var(--yellow);font-size:.78rem">📊 ${Math.floor(Math.random()*40+40)}% se trompent ici</span>`;
  fb.className = `answer-feedback ${ok ? 'correct-fb' : 'wrong-fb'}`;
  fb.innerHTML = html; fb.classList.remove('hidden');

  if (!ok) {
    const c = document.getElementById('sq-coach');
    c.textContent = coachTip(q.category); c.classList.remove('hidden');
  }

  document.getElementById('sq-correct').textContent = '✅ ' + S.soloCorrect;
  document.getElementById('sq-wrong').textContent   = '❌ ' + S.soloWrong;
  document.getElementById('sq-streak').textContent  = S.soloStreak >= 3 ? '🔥' + S.soloStreak : '';

  document.getElementById('screen-solo-game').classList.add(ok ? 'flash-correct' : 'flash-wrong');
  setTimeout(() => document.getElementById('screen-solo-game').classList.remove('flash-correct','flash-wrong'), 600);

  const delay = S.soloMode === 'micro' ? 1200 : S.soloMode === 'blitz' ? 1000 : 3000;
  setTimeout(() => { S.soloIdx++; renderSoloQ(); }, delay);
}

function startSoloTimer(secs) {
  clearInterval(S.soloTimer); S.soloSecs = secs;
  const arc = document.getElementById('solo-timer-arc'), maxD = 163.36;
  const tick = () => {
    document.getElementById('solo-timer-text').textContent = S.soloSecs;
    arc.style.strokeDashoffset = maxD * (1 - S.soloSecs / secs);
    arc.style.stroke = S.soloSecs <= 5 ? '#f87171' : S.soloSecs <= 10 ? '#fbbf24' : '#4ade80';
    if (S.soloSecs > 0) S.soloSecs--;
    else { clearInterval(S.soloTimer); soloTimeout(); }
  };
  tick(); S.soloTimer = setInterval(tick, 1000);
}

function soloTimeout() {
  const q = S.soloQs[S.soloIdx];
  S.soloAnswers.push({ questionIndex: S.soloIdx, answers: [], isCorrect: false, timeTaken: 30, timeout: true });
  S.soloWrong++; S.soloStreak = 0; sfx.wrong();
  document.querySelectorAll('#sq-answers .answer-btn').forEach(b => { b.disabled = true; if (q.correct.includes(b.dataset.id)) b.classList.add('correct'); });
  const fb = document.getElementById('sq-feedback');
  fb.className = 'answer-feedback wrong-fb';
  fb.innerHTML = '<strong>⏰ Temps écoulé !</strong>' + (q.explanation ? `<br><span style="color:var(--text2);font-size:.85rem">💡 ${q.explanation}</span>` : '');
  fb.classList.remove('hidden');
  document.getElementById('sq-correct').textContent = '✅ ' + S.soloCorrect;
  document.getElementById('sq-wrong').textContent   = '❌ ' + S.soloWrong;
  document.getElementById('sq-streak').textContent  = '';
  setTimeout(() => { S.soloIdx++; renderSoloQ(); }, 2000);
}

async function endSolo() {
  clearInterval(S.soloTimer);
  const total = S.soloQs.length;
  const pct = Math.round(S.soloCorrect / total * 100);
  go('screen-solo-results');

  document.getElementById('solo-result-banner').textContent =
    pct >= 90 ? '🌟 Excellent !' : pct >= 70 ? '👍 Bien joué !' : pct >= 50 ? '📚 À retravailler...' : '💪 Continue !';
  if (pct === 100) sfx.win();

  document.getElementById('solo-score-display').innerHTML =
    `<div class="big-num">${S.soloCorrect}/${total}</div><div class="big-label">${pct}% · streak max 🔥${S.soloMaxStreak}</div>`;

  const vd = document.getElementById('exam-verdict');
  if (S.soloMode === 'examen_blanc') {
    vd.className = 'exam-verdict ' + (pct >= 87 ? 'admis' : 'recale');
    vd.textContent = pct >= 87 ? `✅ ADMIS — ${pct}% (seuil 87%)` : `❌ RECALÉ — ${pct}% (seuil 87%)`;
    vd.classList.remove('hidden');
  } else { vd.classList.add('hidden'); }

  const catErrors = {};
  S.soloAnswers.filter(a => !a.isCorrect).forEach(a => {
    const cat = S.soloQs[a.questionIndex]?.category;
    if (cat) catErrors[cat] = (catErrors[cat] || 0) + 1;
  });
  const catEl = document.getElementById('solo-category-breakdown');
  catEl.innerHTML = Object.keys(catErrors).length
    ? '<div class="analysis-title">📊 Erreurs par thème</div>' +
      Object.entries(catErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n]) =>
        `<div class="category-error"><span>${catName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`
      ).join('')
    : '<div style="text-align:center;color:var(--green);padding:.75rem">🌟 Aucune erreur !</div>';

  const weakCat = Object.keys(catErrors)[0];
  const advEl = document.getElementById('solo-coach-advice');
  if (weakCat && COACH_TIPS[weakCat]) {
    advEl.innerHTML = `<div class="coach-advice-title">🧑‍🏫 Conseils sur ${catName(weakCat)}</div>` +
      COACH_TIPS[weakCat].map(t => `<div class="coach-advice-tip">${t}</div>`).join('');
  } else { advEl.style.display = 'none'; }

  // Wrong questions review
  const wrongs = S.soloAnswers.filter(a => !a.isCorrect).slice(0, 5);
  const replayEl = document.getElementById('solo-replay');
  if (wrongs.length) {
    replayEl.innerHTML = '<div class="analysis-title">📹 Questions manquées</div>' +
      wrongs.map(a => {
        const q = S.soloQs[a.questionIndex];
        return `<div class="replay-item wrong-q">
          <div class="replay-q">${q.question}</div>
          <div style="color:var(--green);font-size:.8rem">✅ ${q.correct.join(', ')} — ${(q.explanation||'').slice(0,80)}...</div>
        </div>`;
      }).join('');
  } else { replayEl.innerHTML = ''; }

  // Send stats to server
  if (S.token) {
    try {
      await fetch('/api/training/complete', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: S.soloAnswers.map(a => a.answers), questions: S.soloQs, mode: S.soloMode })
      });
    } catch {}
  }
}

// ── Leaderboard ────────────────────────────────────────────
async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  // Show loading state immediately
  el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text2)"><div class="spinner" style="margin:0 auto 1rem"></div>Chargement...</div>';
  try {
    const res = await Promise.race([
      fetch('/api/leaderboard'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
    ]);
    if (!res.ok) throw new Error('Erreur ' + res.status);
    const data = await res.json();
    if (!data || !data.length) {
      el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text2)">Aucun joueur inscrit pour le moment 🤷<br><small style="color:var(--text3)">Cree un compte pour apparaitre ici !</small></div>';
      return;
    }
    el.innerHTML = data.map((p, i) => {
      const re = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      return '<div class="lb-item">'
        + '<div class="lb-rank">' + re + '</div>'
        + '<div style="flex:1"><div class="lb-pseudo">' + p.pseudo + '</div>'
        + '<div style="font-size:.72rem;color:var(--text3)">' + (p.levelInfo && p.levelInfo.name ? p.levelInfo.name : '') + '</div></div>'
        + '<div style="font-weight:700;color:var(--accent2)">' + p.elo + ' Elo</div>'
        + '<div style="font-size:.78rem;color:var(--text3);margin-left:.5rem">' + (p.wins||0) + 'V ' + (p.losses||0) + 'D</div>'
        + '</div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem">'
      + '<p style="color:var(--red);margin-bottom:1rem">' + (e.message === 'timeout' ? 'Delai depasse' : 'Erreur de connexion') + '</p>'
      + '<button class="btn btn-ghost" onclick="loadLeaderboard()">Reessayer</button>'
      + '</div>';
  }
}

// ── Session time tracking ──────────────────────────────────
let _sessionStart = Date.now();
setInterval(async () => {
  if (!S.token) return;
  const secs = Math.round((Date.now() - _sessionStart) / 1000);
  _sessionStart = Date.now();
  if (secs < 5) return;
  try { await fetch('/api/profile/session-time', { method:'POST', headers:{Authorization:'Bearer '+S.token,'Content-Type':'application/json'}, body: JSON.stringify({seconds:secs}) }); } catch {}
}, 60000);
document.addEventListener('visibilitychange', async () => {
  if (document.hidden && S.token) {
    const secs = Math.round((Date.now() - _sessionStart) / 1000);
    _sessionStart = Date.now();
    if (secs < 5) return;
    try { await fetch('/api/profile/session-time', { method:'POST', headers:{Authorization:'Bearer '+S.token,'Content-Type':'application/json'}, body: JSON.stringify({seconds:secs}) }); } catch {}
  }
});

// ── Socket events ──────────────────────────────────────────
socket.on('game_created', ({roomCode,options,isHost}) => {
  S.roomCode = roomCode; S.isHost = isHost; S.gameOptions = options;
  go('screen-waiting');
  document.getElementById('display-room-code').textContent = roomCode;
  renderOptsDisplay(options);
  renderWaiting([{pseudo:S.pseudo,ready:false,avatar:S.avatar}], options.maxPlayers);
});

socket.on('game_joined', ({roomCode,players,options,isHost}) => {
  S.roomCode = roomCode; S.isHost = isHost; S.gameOptions = options;
  go('screen-waiting');
  document.getElementById('display-room-code').textContent = roomCode;
  renderOptsDisplay(options);
  renderWaiting(players, options.maxPlayers);
});

socket.on('player_list_update', ({players,maxPlayers}) => renderWaiting(players, maxPlayers));

socket.on('game_start', ({players,options}) => {
  sfx.start();
  S.gameMode = options.mode; S.gameOptions = options;
  S.allPlayers = players.map(p => ({...p, score:0, streak:0, answered:false}));
  S.powerups = { fifty50:1, timeBonus:1, stress:1 };
  go('screen-game');
  renderHUD();
});

socket.on('new_question', data => {
  S.allPlayers.forEach(p => p.answered = false);
  renderDuelQuestion(data);
});

socket.on('scores_update', ({players}) => { S.allPlayers = players; renderHUD(); });

socket.on('answer_result', data => {
  const me = S.allPlayers.find(p => p.pseudo === S.pseudo);
  if (me) { me.score = data.score; me.streak = data.streak; me.answered = true; }
  showDuelResult(data);
  renderHUD();
});

socket.on('powerup_result', ({type,removed,bonusSeconds}) => {
  if (type === 'fifty50' && removed) { removed.forEach(id => document.querySelector(`.answer-btn[data-id="${id}"]`)?.classList.add('removed')); toast('⚡ 50/50 utilisé !'); }
  else if (type === 'timeBonus' && bonusSeconds) { S.timerSecs += bonusSeconds; toast(`⏱️ +${bonusSeconds}s !`); }
  else if (type === 'stress') toast('😱 Stress envoyé !');
});

socket.on('powerup_applied', ({type,penaltySeconds,from}) => {
  if (type === 'stress') { S.timerSecs = Math.max(3, S.timerSecs - penaltySeconds); toast(`😱 ${from} t'a stressé ! -${penaltySeconds}s`, 3000); }
});

socket.on('game_end', data => showDuelResults(data));
socket.on('player_disconnected', ({pseudo}) => toast(`💔 ${pseudo} a quitté...`, 3000));

socket.on('rematch_started', ({roomCode,options,players}) => {
  S.roomCode = roomCode; S.isHost = players[0]?.pseudo === S.pseudo; S.gameOptions = options;
  go('screen-waiting');
  document.getElementById('display-room-code').textContent = roomCode;
  renderOptsDisplay(options);
  renderWaiting(players, options.maxPlayers);
  toast('🔄 Revanche ! Cliquez sur Prêt !');
});

socket.on('error', msg => { err('play-err', msg); err('join-err', msg); toast('❌ ' + msg, 3000); });

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore socket auth
  if (S.token) socket.auth = { token: S.token };

  // Keyboard shortcuts
  document.getElementById('login-password').addEventListener('keydown',  e => { if (e.key==='Enter') doLogin(); });
  document.getElementById('reg-password').addEventListener('keydown',    e => { if (e.key==='Enter') doRegister(); });
  document.getElementById('join-code').addEventListener('keydown',       e => { if (e.key==='Enter') doJoinGame(); });
  document.getElementById('join-code').addEventListener('input',         e => { e.target.value = e.target.value.toUpperCase(); });

  updateHomeUI();
});
