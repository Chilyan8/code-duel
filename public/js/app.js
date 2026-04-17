/* CODE DUEL v4 — Solo + Duel + Progression + Replay + Coach IA */
const state = {
  token: localStorage.getItem('token'), pseudo: localStorage.getItem('pseudo'), elo: parseInt(localStorage.getItem('elo')||'1000'),
  roomCode: null, isHost: false, gameOptions: {},
  selectedOptions: { players:2, questions:40, time:30, category:'all', mode:'normal' },
  currentQuestion: null, selectedAnswers: [], answered: false,
  timerInterval: null, timerSeconds: 30,
  powerups: { fifty50:1, timeBonus:1, stress:1 },
  allPlayers: [], gameMode: 'normal', hostPseudo: null,
  // Solo
  soloMode: 'training', soloCategory: 'all',
  soloQuestions: [], soloAnswers: [], soloIndex: 0, soloCorrect: 0, soloWrong: 0, soloStreak: 0, soloMaxStreak: 0,
  soloTimerInterval: null, soloTimerSeconds: 30,
  replayData: null,
};

const socket = io({ auth: { token: state.token } });
state.avatar = localStorage.getItem('avatar') || '🧑‍🎓';



/* ═══════════════════════════════════════════════
   AVATAR SYSTEM
   ═══════════════════════════════════════════════ */
const EMOJI_AVATARS = ['🧑‍🎓','👨‍🚗','👩‍🚗','🏎️','🚗','🚕','🚙','🏍️','🚓','🚑','🧑‍✈️','👮','🧑‍🔧','🦸','🧙','🎮','🔥','⚡','🌟','👑','🎯','🏆','💎','🚀','🦊','🐺','🐯','🦁','🐸','🤖'];

function openAvatarModal() {
  const grid = document.getElementById('emoji-avatars');
  grid.innerHTML = EMOJI_AVATARS.map(e =>
    `<div class="avatar-option" onclick="selectEmojiAvatar('${e}')">${e}</div>`
  ).join('');
  document.getElementById('avatar-modal').classList.remove('hidden');
}

function closeAvatarModal(e) {
  if (!e || e.target === document.getElementById('avatar-modal'))
    document.getElementById('avatar-modal').classList.add('hidden');
}

async function selectEmojiAvatar(emoji) {
  state.avatar = emoji;
  localStorage.setItem('avatar', emoji);
  document.getElementById('avatar-modal').classList.add('hidden');
  renderAvatarInProfile(emoji);
  await saveAvatarToServer(emoji);
  showToast(`Avatar mis à jour : ${emoji}`);
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 500000) { showToast('Image trop grande ! Max 500kb 📸'); return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    // Resize to 150x150 max
    const resized = await resizeImage(dataUrl, 150);
    state.avatar = resized;
    localStorage.setItem('avatar', resized);
    document.getElementById('avatar-modal').classList.add('hidden');
    renderAvatarInProfile(resized);
    await saveAvatarToServer(resized);
    showToast('Photo de profil mise à jour ! 📸');
  };
  reader.readAsDataURL(file);
}

function resizeImage(dataUrl, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxSize / img.width, maxSize / img.height);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
}

async function saveAvatarToServer(avatar) {
  if (!state.token) return;
  try {
    await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: avatar })
    });
  } catch {}
}

function renderAvatarInProfile(avatar) {
  const wrap = document.getElementById('profile-avatar-display');
  if (!wrap) return;
  if (avatar && avatar.startsWith('data:')) {
    wrap.innerHTML = `<img src="${avatar}" alt="avatar"/>`;
  } else {
    wrap.textContent = avatar || '🧑‍🎓';
  }
}

function getAvatarEl(avatar, size = 22) {
  if (!avatar) return `<span style="font-size:${size*.7}px">🧑‍🎓</span>`;
  if (avatar.startsWith('data:')) return `<img src="${avatar}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover"/>`;
  return `<span style="font-size:${size*.7}px">${avatar}</span>`;
}

/* ═══════════════════════════════════════════════
   SESSION TIME TRACKING
   ═══════════════════════════════════════════════ */
let sessionStart = Date.now();
let sessionSaveInterval = null;

function startSessionTracking() {
  sessionStart = Date.now();
  // Save every 2 minutes
  clearInterval(sessionSaveInterval);
  sessionSaveInterval = setInterval(saveSessionTime, 120000);
  // Save on page hide
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveSessionTime();
  });
}

async function saveSessionTime() {
  if (!state.token) return;
  const seconds = Math.round((Date.now() - sessionStart) / 1000);
  sessionStart = Date.now(); // reset so we don't double count
  if (seconds < 5) return;
  try {
    await fetch('/api/profile/session-time', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds })
    });
  } catch {}
}

function formatTime(seconds) {
  if (!seconds) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

/* ═══════════════════════════════════════════════
   SHOW PROFILE (full rewrite)
   ═══════════════════════════════════════════════ */

// ── Audio ──────────────────────────────────────────────
let audioCtx = null;
function getAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function playTone(f,t='sine',d=.15,v=.3){try{const c=getAudio(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=f;o.type=t;g.gain.setValueAtTime(v,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);o.start();o.stop(c.currentTime+d);}catch{}}
function playCorrect(){playTone(523,'sine',.1);setTimeout(()=>playTone(659,'sine',.15),100);}
function playWrong(){playTone(220,'sawtooth',.2,.2);}
function playStart(){[261,329,392,523].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',.15),i*100));}
function playVictory(){[523,659,784,1047].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',.2),i*150));}
function playMicro(){playTone(880,'sine',.08,.2);}

// ── Helpers ──────────────────────────────────────────────
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  if(id==='screen-leaderboard')loadLeaderboard();
  if(id==='screen-play'||id==='screen-solo')updateChips();
  if(id==='screen-solo')updateSoloChip();
}
function showToast(msg,d=2500){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),d);}
function showError(id,msg){const e=document.getElementById(id);if(e){e.textContent=msg;e.classList.remove('hidden');}}
function hideError(id){document.getElementById(id)?.classList.add('hidden');}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
const catNames={priorites:'🚦 Priorités',panneaux:'🪧 Panneaux',vitesse:'⚡ Vitesses',alcool:'🍺 Alcool',regles:'📋 Règles',securite:'🛡️ Sécurité',vehicule:'🔧 Véhicule',permis:'📄 Permis',situation:'🚗 Situation',international:'🌍 International'};
function catName(c){return catNames[c]||c;}
function modeName(m){return{normal:'🎯 Normal',blitz:'⚡ Blitz',examen_blanc:'📋 Examen',piege:'😈 Piège',micro:'⚡ Micro',international:'🌍 International',training:'🧠 Entraînement',libre:'📚 Libre'}[m]||m;}
function rankEmoji(r){return['🥇','🥈','🥉'][r-1]||`${r}.`;}
const coachTips = {
  priorites: ["Mémorise : priorité à droite SAUF panneau contraire 🚦","Le STOP = arrêt TOTAL obligatoire, même si vide 🛑","Le cédez-le-passage ≠ arrêt obligatoire ! 🔺"],
  panneaux: ["Rouge = interdit, Bleu = obligation, Triangle = danger 🪧","Le carré jaune = route prioritaire 💛","Rond bleu + chiffre = vitesse MINIMALE, pas maximale ! 🔵"],
  vitesse: ["Autoroute : 130 sec, 110 pluie, 50 brouillard < 50m ⚡","En ville = 50 km/h par défaut 🏙️","Permis probatoire : -10 km/h partout sur autoroute 🔰"],
  alcool: ["0,5 g/L pour les conducteurs standards 🍺","0,2 g/L pour les jeunes conducteurs","Seul le TEMPS élimine l'alcool, pas le café ☕"],
  securite: ["Gilet AVANT de sortir du véhicule 🦺","Triangle à 100m hors agglo, 30m en ville","PAS = Protéger, Alerter, Secourir 🚨"],
  regles: ["Ligne continue = jamais la franchir ⚡","Ceinture obligatoire à l'avant ET à l'arrière 🔒","Téléphone en main interdit même au feu rouge 📵"],
  international: ["En UK on roule à gauche ! 🇬🇧","L'Autobahn est souvent sans limite en Allemagne 🇩🇪","Phares de jour obligatoires dans plusieurs pays nordiques 💡"],
};
function getCoachTip(category) {
  const tips = coachTips[category] || ["Lis bien la question et toutes les réponses ! 📖","Ne te laisse pas piéger ! 🧐","Prends le temps de réfléchir ⏱️"];
  return tips[Math.floor(Math.random()*tips.length)];
}

// ── Auth ──────────────────────────────────────────────
async function doLogin(){
  hideError('login-error');
  const pseudo=document.getElementById('login-pseudo').value.trim();
  const password=document.getElementById('login-password').value;
  if(!pseudo||!password)return showError('login-error','Remplis tous les champs');
  try{
    const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const data=await res.json();
    if(!res.ok)return showError('login-error',data.error);
    saveAuth(data);showToast(`Bienvenue, ${pseudo} ! 🎉`);showScreen('screen-home');
  }catch{showError('login-error','Erreur réseau');}
}
async function doRegister(){
  hideError('reg-error');
  const pseudo=document.getElementById('reg-pseudo').value.trim();
  const password=document.getElementById('reg-password').value;
  if(!pseudo||!password)return showError('reg-error','Remplis tous les champs');
  try{
    const res=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const data=await res.json();
    if(!res.ok)return showError('reg-error',data.error);
    saveAuth(data);showToast(`Compte créé ! Bienvenue ${pseudo} 🚗`);showScreen('screen-home');
  }catch(e){showError('reg-error','Erreur serveur: '+e.message);}
}
function saveAuth(data){
  state.token=data.token;state.pseudo=data.pseudo;state.elo=data.elo||1000;
  localStorage.setItem('token',data.token);localStorage.setItem('pseudo',data.pseudo);localStorage.setItem('elo',data.elo||1000);
  socket.auth={token:data.token};
}
function switchTab(tab){
  document.getElementById('auth-login').classList.toggle('hidden',tab!=='login');
  document.getElementById('auth-register').classList.toggle('hidden',tab!=='register');
  document.getElementById('tab-login').classList.toggle('active',tab==='login');
  document.getElementById('tab-register').classList.toggle('active',tab==='register');
}
function promptGuest(){const p=prompt('Choisis un pseudo invité :');if(p&&p.trim().length>=2){state.pseudo=p.trim().slice(0,20);showScreen('screen-home');}}
function updateChips(){
  const avatar = state.avatar || localStorage.getItem('avatar') || '🧑‍🎓';
  const avatarHtml = avatar.startsWith('data:') ? `<img src="${avatar}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle"/>` : avatar;
  ['play-user-info'].forEach(id=>{const c=document.getElementById(id);if(!c)return;if(state.pseudo){c.innerHTML=`${avatarHtml} ${state.pseudo} · ${state.elo} Elo`;c.classList.remove('hidden');}else c.classList.add('hidden');});
}
function updateSoloChip(){
  const c=document.getElementById('solo-user-info');if(!c)return;
  if(state.pseudo){c.textContent=`👤 ${state.pseudo} · ${state.elo} Elo`;c.classList.remove('hidden');}else c.classList.add('hidden');
}

// ── Profile ───────────────────────────────────────────
async function showProfile(){
  if(!state.token){ showScreen('screen-auth'); return; }
  showScreen('screen-profile');
  const pc = document.getElementById('profile-content');
  pc.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const data = await (await fetch('/api/profile', { headers: { Authorization: `Bearer ${state.token}` } })).json();
    const level = data.level || { name:'🔰 Apprenti', next:1020, level:1 };
    const acc = data.total_questions > 0 ? Math.round(data.total_correct / data.total_questions * 100) : 0;
    const avgScore = data.total_games > 0 ? Math.round(data.total_correct / data.total_games * 10) / 10 : 0;
    const winRate = data.total_games > 0 ? Math.round((data.wins || 0) / data.total_games * 100) : 0;
    const catStats = data.category_stats || {};
    const weakCats = Object.entries(catStats).filter(([,s]) => s.sessions > 0).sort((a,b) => (b[1].errors/b[1].sessions) - (a[1].errors/a[1].sessions)).slice(0, 4);
    const badges = data.badges || [];
    const eloToNext = level.next ? level.next - data.elo : null;
    const eloProgress = level.next ? Math.min(100, Math.round((data.elo - (level.level === 1 ? 0 : 1000)) / (level.next - 1000) * 100)) : 100;
    const totalTime = data.total_seconds || 0;
    const avatar = data.avatar || localStorage.getItem('avatar') || '🧑‍🎓';
    state.avatar = avatar;

    pc.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar-wrap" onclick="openAvatarModal()">
          <div class="profile-avatar-img" id="profile-avatar-display">
            ${avatar.startsWith('data:') ? `<img src="${avatar}" alt="avatar"/>` : avatar}
          </div>
          <div class="avatar-edit-btn">✏️</div>
        </div>
        <div style="font-size:1.3rem;font-weight:800;margin-bottom:.2rem">${data.pseudo}</div>
        <div class="profile-level">${level.name}</div>
        <div class="profile-elo">${data.elo} Elo${eloToNext ? ` · encore ${eloToNext} pts` : ' · Niveau max 🏆'}</div>
        <div class="level-bar-wrap" style="margin-top:.5rem">
          <div class="level-bar-bg"><div class="level-bar-fill" style="width:${eloProgress}%"></div></div>
          <div class="level-bar-label">${eloToNext ? `${eloProgress}% vers le niveau suivant` : 'Niveau maximum atteint !'}</div>
        </div>
      </div>

      <div class="time-stat">
        <div class="time-stat-icon">⏱️</div>
        <div><div class="time-stat-val">${formatTime(totalTime)}</div><div class="time-stat-label">passées sur le site</div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="time-stat-val">${data.total_games || 0}</div>
          <div class="time-stat-label">parties jouées</div>
        </div>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat"><div class="ps-num">${data.wins || 0}</div><div class="ps-label">Victoires</div></div>
        <div class="profile-stat"><div class="ps-num">${data.losses || 0}</div><div class="ps-label">Défaites</div></div>
        <div class="profile-stat"><div class="ps-num">${winRate}%</div><div class="ps-label">Taux victoire</div></div>
        <div class="profile-stat"><div class="ps-num">${acc}%</div><div class="ps-label">Précision</div></div>
        <div class="profile-stat"><div class="ps-num">${avgScore}</div><div class="ps-label">Moy. réponses</div></div>
        <div class="profile-stat"><div class="ps-num">${data.total_correct || 0}</div><div class="ps-label">Bonnes rép.</div></div>
      </div>

      <div class="profile-section-title">🎖️ Badges (${badges.length})</div>
      ${badges.length
        ? `<div class="profile-badges-wrap">${badges.map(b=>`<span class="badge-chip">${b}</span>`).join('')}</div>`
        : '<div class="no-badge">Aucun badge encore — joue pour en débloquer ! 💪</div>'}

      <div class="profile-section-title">📊 Analyse par thème</div>
      ${weakCats.length
        ? weakCats.map(([cat, s]) => {
            const pct = Math.round(s.errors / s.sessions * 100);
            const color = pct >= 60 ? '#f87171' : pct >= 30 ? '#fbbf24' : '#4ade80';
            return `<div class="weakness-row">
              <div class="weakness-cat">${catName(cat)}</div>
              <div class="weakness-bar-bg"><div class="weakness-bar-fill" style="width:${pct}%;background:${color}"></div></div>
              <div class="weakness-pct">${pct}%</div>
            </div>`;
          }).join('') + `<button class="btn btn-primary w-full" style="margin-top:.75rem" onclick="startSolo('training')">🧠 Entraînement ciblé sur mes failles</button>`
        : '<div class="no-badge">Joue des parties pour voir ton analyse ! 🚗</div>'}

      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;gap:.65rem;flex-wrap:wrap">
        <button class="btn btn-accent" onclick="startSolo('examen_blanc')">📋 Examen blanc</button>
        <button class="btn btn-ghost" onclick="showScreen('screen-solo')">🎯 Entraînement</button>
        <button class="btn btn-ghost" onclick="showScreen('screen-leaderboard')">🏆 Classement</button>
      </div>
    `;
  } catch(e) {
    pc.innerHTML = `<div style="text-align:center;padding:2rem"><p style="color:var(--red);margin-bottom:1rem">Erreur de chargement</p><button class="btn btn-primary" onclick="showScreen('screen-auth')">Se connecter</button></div>`;
  }
}

// ── SOLO MODE ─────────────────────────────────────────
async function startSolo(mode){
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  state.soloMode=mode;
  state.soloAnswers=[];state.soloIndex=0;state.soloCorrect=0;state.soloWrong=0;state.soloStreak=0;state.soloMaxStreak=0;
  document.getElementById('solo-category-picker').classList.add('hidden');

  let questions=[];
  const timeLimit=mode==='micro'?15:mode==='examen_blanc'?30:30;
  const count=mode==='micro'?5:mode==='examen_blanc'?40:10;

  if(mode==='training'&&state.token){
    try{
      const res=await fetch(`/api/training/session?mode=training&count=10`,{headers:{Authorization:`Bearer ${state.token}`}});
      const data=await res.json();
      questions=data.fullQuestions||[];
      if(data.weakCategories?.length) showToast(`🧠 Session ciblée : ${data.weakCategories.map(c=>catName(c)).join(', ')}`,3000);
      else showToast('🧠 Session générale — joue plus pour cibler tes failles !',3000);
    }catch{questions=getLocalQuestions({count,mode});}
  } else {
    questions=getLocalQuestions({count,mode,category:state.soloCategory});
  }

  if(!questions.length){showToast('Pas assez de questions pour ce mode','3000');return;}
  state.soloQuestions=questions;
  setText('solo-mode-badge',modeName(mode));
  showScreen('screen-solo-game');
  renderSoloQuestion();
}

function startSoloCategory(){
  document.getElementById('solo-category-picker').classList.toggle('hidden');
}
function selectSoloCat(cat,el){
  document.querySelectorAll('#solo-category-picker .pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');state.soloCategory=cat;
}

function getLocalQuestions({count=10,mode='normal',category='all'}){
  // Fetch questions from a global cache (set after first load)
  let pool=window._allQuestions||[];
  if(!pool.length)return[];
  if(mode==='piege')pool=pool.filter(q=>q.is_trap);
  else if(mode==='international')pool=pool.filter(q=>q.category==='international');
  else if(category&&category!=='all')pool=pool.filter(q=>q.category===category);
  return pool.sort(()=>Math.random()-.5).slice(0,Math.min(count,pool.length));
}

function renderSoloQuestion(){
  const q=state.soloQuestions[state.soloIndex];
  if(!q)return endSoloGame();
  const total=state.soloQuestions.length;
  const timeLimit=state.soloMode==='micro'?15:30;

  setText('sq-counter',`${state.soloIndex+1}/${total}`);
  setText('sq-category',catName(q.category));
  setText('sq-text',q.question);
  document.getElementById('solo-progress').style.width=`${(state.soloIndex/total)*100}%`;
  document.getElementById('sq-correct').textContent=`✅ ${state.soloCorrect}`;
  document.getElementById('sq-wrong').textContent=`❌ ${state.soloWrong}`;
  document.getElementById('sq-streak').textContent=state.soloStreak>=3?`🔥${state.soloStreak}`:'';
  document.getElementById('sq-trap-indicator').classList.toggle('hidden',!q.is_trap);

  const sitBox=document.getElementById('sq-situation-box');
  if(q.situation){sitBox.textContent=`📍 ${q.situation}`;sitBox.classList.remove('hidden');}else sitBox.classList.add('hidden');
  const imgWrap=document.getElementById('sq-image-wrap');
  if(q.image_url){document.getElementById('sq-image').src=q.image_url;imgWrap.classList.remove('hidden');}else imgWrap.classList.add('hidden');

  const cont=document.getElementById('sq-answers');cont.innerHTML='';
  q.answers.forEach(a=>{
    const btn=document.createElement('button');
    btn.className='answer-btn';btn.dataset.id=a.id;
    btn.textContent=`${a.id.toUpperCase()}) ${a.text}`;
    if(q.correct.length>1){
      btn.addEventListener('click',()=>{btn.classList.toggle('selected');});
    }else{
      btn.addEventListener('click',()=>submitSoloAnswer([a.id]));
    }
    cont.appendChild(btn);
  });

  // Multiple confirm
  let cb=document.getElementById('solo-confirm-btn');
  if(q.correct.length>1){
    if(!cb){cb=document.createElement('button');cb.id='solo-confirm-btn';cb.className='btn btn-primary confirm-btn';cb.textContent='Valider ✅';cb.addEventListener('click',()=>{const sel=[...cont.querySelectorAll('.answer-btn.selected')].map(b=>b.dataset.id);if(sel.length)submitSoloAnswer(sel);});}
    cont.after(cb);
  }else{if(cb)cb.remove();}

  const fb=document.getElementById('sq-feedback');fb.classList.add('hidden');fb.className='answer-feedback hidden';
  document.getElementById('sq-coach').classList.add('hidden');
  startSoloTimer(timeLimit);
}

function submitSoloAnswer(answers){
  clearInterval(state.soloTimerInterval);
  const q=state.soloQuestions[state.soloIndex];
  const isCorrect=[...answers].sort().join(',')===[...q.correct].sort().join(',');
  state.soloAnswers.push({questionIndex:state.soloIndex,answers,isCorrect,timeTaken:q.timeLimit-(state.soloTimerSeconds||0)});

  document.querySelectorAll('#sq-answers .answer-btn').forEach(b=>{
    b.disabled=true;
    if(q.correct.includes(b.dataset.id))b.classList.add('correct');
    else if(answers.includes(b.dataset.id))b.classList.add('wrong');
  });
  document.getElementById('solo-confirm-btn')?.setAttribute('disabled','true');

  if(isCorrect){state.soloCorrect++;state.soloStreak++;state.soloMaxStreak=Math.max(state.soloMaxStreak,state.soloStreak);playCorrect();}
  else{state.soloWrong++;state.soloStreak=0;playWrong();}

  // Feedback
  const fb=document.getElementById('sq-feedback');
  let html='';
  if(isCorrect)html=`<strong>✅ Bonne réponse !</strong>${state.soloStreak>=3?` <span class="streak-fire">🔥 ${state.soloStreak} en série !</span>`:''}<br>`;
  else html=`<strong>❌ Mauvaise réponse</strong>${q.is_trap&&q.trap_message?`<br><em>😏 ${q.trap_message}</em>`:''}<br>`;
  if(q.explanation&&state.soloMode!=='blitz')html+=`<span style="color:var(--text2);font-size:.85rem">💡 ${q.explanation}</span>`;
  // Trap stat
  if(q.is_trap)html+=`<br><span style="color:var(--yellow);font-size:.78rem">📊 ${Math.floor(Math.random()*40+40)}% des joueurs se trompent ici</span>`;
  fb.className=`answer-feedback ${isCorrect?'correct-fb':'wrong-fb'}`;
  fb.innerHTML=html;fb.classList.remove('hidden');

  // Coach IA
  const coach=document.getElementById('sq-coach');
  if(!isCorrect){
    coach.textContent=getCoachTip(q.category);
    coach.classList.remove('hidden');
  }

  setText('sq-correct',`✅ ${state.soloCorrect}`);
  setText('sq-wrong',`❌ ${state.soloWrong}`);
  setText('sq-streak',state.soloStreak>=3?`🔥${state.soloStreak}`:'');

  document.getElementById('screen-solo-game').classList.add(isCorrect?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-solo-game').classList.remove('flash-correct','flash-wrong'),600);

  const delay=state.soloMode==='micro'?1200:state.soloMode==='blitz'?1000:3000;
  setTimeout(()=>{state.soloIndex++;renderSoloQuestion();},delay);
}

function startSoloTimer(s){
  clearInterval(state.soloTimerInterval);
  state.soloTimerSeconds=s;
  const arc=document.getElementById('solo-timer-arc'),maxD=163.36;
  function tick(){
    setText('solo-timer-text',state.soloTimerSeconds);
    arc.style.strokeDashoffset=maxD*(1-state.soloTimerSeconds/s);
    arc.style.stroke=state.soloTimerSeconds<=5?'#f87171':state.soloTimerSeconds<=10?'#fbbf24':'#4ade80';
    if(state.soloTimerSeconds>0)state.soloTimerSeconds--;
    else{clearInterval(state.soloTimerInterval);onSoloTimeout();}
  }
  tick();state.soloTimerInterval=setInterval(tick,1000);
}
function onSoloTimeout(){
  const q=state.soloQuestions[state.soloIndex];
  state.soloAnswers.push({questionIndex:state.soloIndex,answers:[],isCorrect:false,timeTaken:q.timeLimit||30,timeout:true});
  state.soloWrong++;state.soloStreak=0;playWrong();
  const fb=document.getElementById('sq-feedback');
  fb.className='answer-feedback wrong-fb';
  let html=`<strong>⏰ Temps écoulé !</strong><br>`;
  if(q.explanation)html+=`<span style="color:var(--text2);font-size:.85rem">💡 ${q.explanation}</span>`;
  fb.innerHTML=html;fb.classList.remove('hidden');
  document.querySelectorAll('#sq-answers .answer-btn').forEach(b=>{b.disabled=true;if(q.correct.includes(b.dataset.id))b.classList.add('correct');});
  setText('sq-correct',`✅ ${state.soloCorrect}`);
  setText('sq-wrong',`❌ ${state.soloWrong}`);
  setTimeout(()=>{state.soloIndex++;renderSoloQuestion();},2000);
}

async function endSoloGame(){
  clearInterval(state.soloTimerInterval);
  const total=state.soloQuestions.length;
  const pct=Math.round(state.soloCorrect/total*100);
  showScreen('screen-solo-results');

  // Banner
  const banner=document.getElementById('solo-result-banner');
  if(pct>=90)banner.textContent='🌟 Excellent !';
  else if(pct>=70)banner.textContent='👍 Bien joué !';
  else if(pct>=50)banner.textContent='📚 À retravailler...';
  else banner.textContent='💪 Ne lâche pas !';
  if(pct===100)playVictory();

  // Score
  document.getElementById('solo-score-display').innerHTML=`<div class="big-num">${state.soloCorrect}/${total}</div><div class="big-label">${pct}% de réussite · streak max : 🔥${state.soloMaxStreak}</div>`;

  // Exam verdict
  if(state.soloMode==='examen_blanc'){
    const vd=document.getElementById('exam-verdict');
    vd.className=`exam-verdict ${pct>=87?'admis':'recale'}`;
    vd.textContent=pct>=87?`✅ ADMIS — ${pct}% (seuil : 87%)`:`❌ RECALÉ — ${pct}% (seuil : 87%)`;
    vd.classList.remove('hidden');
  }

  // Category breakdown
  const catErrors={};
  state.soloAnswers.filter(a=>!a.isCorrect).forEach(a=>{
    const cat=state.soloQuestions[a.questionIndex]?.category;
    if(cat)catErrors[cat]=(catErrors[cat]||0)+1;
  });
  const catEl=document.getElementById('solo-category-breakdown');
  if(Object.keys(catErrors).length){
    catEl.innerHTML=`<div class="analysis-title">📊 Erreurs par thème</div>`+Object.entries(catErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>`<div class="category-error"><span>${catName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`).join('');
  }else{catEl.innerHTML=`<div style="text-align:center;color:var(--green);padding:1rem">🌟 Aucune erreur !</div>`;}

  // Replay (first 5 wrong)
  const replayEl=document.getElementById('solo-replay');
  const wrongs=state.soloAnswers.filter(a=>!a.isCorrect).slice(0,5);
  if(wrongs.length){
    replayEl.innerHTML=`<div class="analysis-title">📹 Questions manquées</div>`+wrongs.map(a=>{
      const q=state.soloQuestions[a.questionIndex];
      return `<div class="replay-item wrong-q"><div class="replay-q">${q.question}</div><div style="color:var(--green);font-size:.8rem">✅ ${q.correct.join(', ')} — ${q.explanation?.slice(0,80)}...</div></div>`;
    }).join('');
  }

  // Coach advice
  const adviceEl=document.getElementById('solo-coach-advice');
  const weakCat=Object.keys(catErrors)[0];
  if(weakCat){
    const tips=coachTips[weakCat]||[];
    adviceEl.innerHTML=`<div class="coach-advice-title">🧑‍🏫 Conseils du coach sur ${catName(weakCat)}</div>`+tips.map(t=>`<div class="coach-advice-tip">${t}</div>`).join('');
  }else adviceEl.style.display='none';

  // Send to server if logged in
  if(state.token){
    try{
      const res=await fetch('/api/training/complete',{method:'POST',headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},body:JSON.stringify({answers:state.soloAnswers.map(a=>a.answers),questions:state.soloQuestions,mode:state.soloMode})});
      const data=await res.json();
      if(data.newBadges?.length){
        const bd=document.getElementById('solo-badges-new');
        bd.innerHTML=`<div class="new-badges-title">🎖️ Nouveau${data.newBadges.length>1?'x':''} badge${data.newBadges.length>1?'s':''}  !</div>`+data.newBadges.map(b=>`<span class="badge-item">${b}</span>`).join('');
        bd.classList.remove('hidden');
        showToast(`🎖️ Badge débloqué : ${data.newBadges[0]} !`,4000);
      }
    }catch{}
  }
}

// ── Game options (duel) ────────────────────────────────
function showCreateForm(){
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  document.getElementById('create-form').classList.toggle('hidden');
  document.getElementById('join-form').classList.add('hidden');
}
function showJoinForm(){
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  document.getElementById('join-form').classList.toggle('hidden');
  document.getElementById('create-form').classList.add('hidden');
}
function selectOption(type,val,el){el.closest('.option-pills').querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));el.classList.add('active');state.selectedOptions[type]=val;}
function selectMode(mode,el){document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('active'));el.classList.add('active');state.selectedOptions.mode=mode;}
function openCreateGame(){
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  hideError('play-error');
  socket.emit('create_game',{pseudo:state.pseudo,avatar:state.avatar,options:{maxPlayers:state.selectedOptions.players,questionCount:state.selectedOptions.questions,timeLimit:state.selectedOptions.time,category:state.selectedOptions.category,mode:state.selectedOptions.mode}});
}
function doJoinGame(){
  const code=document.getElementById('join-code').value.trim().toUpperCase();
  if(code.length<4)return showError('join-error','Entrez un code valide');
  hideError('join-error');socket.emit('join_game',{roomCode:code,pseudo:state.pseudo});
}
function copyRoomCode(){navigator.clipboard.writeText(document.getElementById('display-room-code').textContent).then(()=>showToast('Code copié ! 📋'));}
function sendReady(){document.getElementById('btn-ready').disabled=true;document.getElementById('btn-ready').textContent='⏳ En attente...';socket.emit('player_ready');}
function forceStart(){socket.emit('force_start');}

// ── Waiting room ──────────────────────────────────────
function renderWaitingPlayers(players,maxPlayers){
  const c=document.getElementById('players-waiting');c.innerHTML='';
  for(let i=0;i<maxPlayers;i++){
    const p=players[i];const div=document.createElement('div');
    div.className=`waiting-player ${p?'connected':'empty'}`;
    const av = p?.avatar ? (p.avatar.startsWith('data:') ? `<img class="wp-avatar-img" src="${p.avatar}"/>` : p.avatar) : (p ? p.pseudo[0].toUpperCase() : '?');
    div.innerHTML=p
      ?`<div class="wp-avatar connected" style="${!p.avatar||p.avatar.startsWith('data:')?'':'font-size:1.3rem'}">${av}</div><div><div class="wp-name">${p.pseudo}${p.pseudo===state.pseudo?' <small style="color:var(--accent2)">(toi)</small>':''}</div><div class="wp-tag">${i===0?'👑 Hôte':'Joueur '+(i+1)}</div></div><div class="wp-status">${p.ready?'✅':'⏳'}</div>`
      :`<div class="wp-avatar">?</div><div><div class="wp-name" style="color:var(--text3)">En attente...</div><div class="wp-tag">Joueur ${i+1}</div></div><div class="wp-status">⏳</div>`;
    c.appendChild(div);
  }
  const myP=players.find(p=>p.pseudo===state.pseudo);
  const btnR=document.getElementById('btn-ready');
  const btnF=document.getElementById('btn-force-start');
  if(myP&&!myP.ready){btnR.classList.remove('hidden');btnR.disabled=false;btnR.textContent='✅ Je suis prêt !';}
  else if(myP?.ready){btnR.classList.remove('hidden');btnR.disabled=true;btnR.textContent='✅ Prêt !';}
  if(state.isHost&&players.length>=2)btnF.classList.remove('hidden');else btnF.classList.add('hidden');
  const msg=document.getElementById('waiting-msg');
  if(players.length<maxPlayers){msg.innerHTML=`<div class="spinner"></div> En attente... (${players.length}/${maxPlayers})`;msg.style.display='flex';}
  else msg.style.display='none';
}
function renderOptionsDisplay(options){
  document.getElementById('options-display').innerHTML=[`👥 ${options.maxPlayers} joueurs`,`❓ ${options.questionCount} questions`,`⏱️ ${options.timeLimit}s`,catName(options.category),modeName(options.mode)].map(t=>`<span class="options-tag">${t}</span>`).join('');
}

// ── Duel HUD ──────────────────────────────────────────
function renderHUD(){
  const c=document.getElementById('hud-scores');c.innerHTML='';
  const max=Math.max(...state.allPlayers.map(p=>p.score),0);
  state.allPlayers.forEach(p=>{
    const isMe=p.pseudo===state.pseudo;
    const div=document.createElement('div');
    div.className=`hud-player-score ${isMe?'me':''} ${p.score===max&&max>0&&!isMe?'leading':''}`;
    const av2 = p.avatar ? (p.avatar.startsWith('data:') ? `<img src="${p.avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover"/>` : `<span style="font-size:.85rem">${p.avatar}</span>`) : `<span style="font-size:.75rem;font-weight:700;color:var(--accent2)">${p.pseudo[0].toUpperCase()}</span>`;
    div.innerHTML=`<div style="display:flex;align-items:center;gap:.25rem;width:26px">${av2}</div><div><div class="hps-name">${p.pseudo}</div>${p.answered?'<div style="font-size:.6rem;color:var(--green)">✓</div>':''}</div><div class="hps-score">${p.score}</div>${p.streak>=3?`<div style="font-size:.72rem">🔥${p.streak}</div>`:''}`;
    c.appendChild(div);
  });
}

// ── Duel question rendering ────────────────────────────
function renderQuestion(data){
  state.currentQuestion=data;state.selectedAnswers=[];state.answered=false;
  setText('q-counter',`${data.index+1}/${data.total}`);
  setText('q-category',catName(data.category));
  setText('q-text',data.question);
  setText('mode-badge',modeName(data.mode||state.gameMode));
  document.getElementById('game-progress').style.width=`${(data.index/data.total)*100}%`;
  document.getElementById('trap-indicator').classList.toggle('hidden',!data.isTrap);
  const sb=document.getElementById('situation-box');
  if(data.situation){sb.textContent=`📍 ${data.situation}`;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  const iw=document.getElementById('q-image-wrap');
  if(data.image_url){document.getElementById('q-image').src=data.image_url;iw.classList.remove('hidden');document.getElementById('q-image').onerror=()=>iw.classList.add('hidden');}else iw.classList.add('hidden');
  let hint=document.getElementById('multi-hint');
  if(data.isMultiple){if(!hint){hint=document.createElement('div');hint.id='multi-hint';hint.className='multiple-hint';}hint.textContent='⚠️ Plusieurs bonnes réponses !';document.getElementById('q-text').after(hint);}else hint?.remove();
  const cont=document.getElementById('answers-container');cont.innerHTML='';
  data.answers.forEach(a=>{
    const btn=document.createElement('button');btn.className='answer-btn';btn.dataset.id=a.id;btn.textContent=`${a.id.toUpperCase()}) ${a.text}`;
    if(data.isMultiple){btn.addEventListener('click',()=>{if(state.answered)return;btn.classList.toggle('selected');const idx=state.selectedAnswers.indexOf(a.id);if(idx>=0)state.selectedAnswers.splice(idx,1);else state.selectedAnswers.push(a.id);updateConfirmBtn();});}
    else{btn.addEventListener('click',()=>{if(!state.answered)submitDuelAnswer([a.id]);});}
    cont.appendChild(btn);
  });
  let cb=document.getElementById('confirm-btn');
  if(data.isMultiple){if(!cb){cb=document.createElement('button');cb.id='confirm-btn';cb.className='btn btn-primary confirm-btn';cb.textContent='Valider ✅';cb.addEventListener('click',()=>{if(state.selectedAnswers.length>0)submitDuelAnswer(state.selectedAnswers);});}cb.disabled=true;cont.after(cb);}else cb?.remove();
  const fb=document.getElementById('answer-feedback');fb.classList.add('hidden');fb.className='answer-feedback hidden';
  ['fifty50','timeBonus','stress'].forEach(pu=>{const b=document.getElementById(`pu-${pu}`);if(b)b.disabled=!state.powerups[pu];});
  startTimer(data.timeLimit||30);
  if(Math.random()<.25)showCoach(getCoachTip(data.category));
}
function updateConfirmBtn(){const b=document.getElementById('confirm-btn');if(b)b.disabled=state.selectedAnswers.length===0;}
function submitDuelAnswer(answers){
  if(state.answered)return;state.answered=true;
  const timeTaken=(state.currentQuestion?.timeLimit||30)-state.timerSeconds;
  document.querySelectorAll('.answer-btn').forEach(b=>b.disabled=true);
  document.getElementById('confirm-btn')?.setAttribute('disabled','true');
  socket.emit('submit_answer',{answers,timeTaken});
  const fb=document.getElementById('answer-feedback');fb.className='answer-feedback neutral-fb';
  fb.innerHTML='<div style="display:flex;align-items:center;gap:.5rem;color:var(--text2)"><div class="spinner"></div> En attente...</div>';
  fb.classList.remove('hidden');
}
function showAnswerResult(data){
  stopTimer();if(data.hidden)return;
  document.querySelectorAll('.answer-btn').forEach(btn=>{const id=btn.dataset.id;if(data.correctAnswers?.includes(id))btn.classList.add('correct');else if(state.selectedAnswers.includes(id))btn.classList.add('wrong');});
  document.getElementById('screen-game').classList.add(data.isCorrect?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-game').classList.remove('flash-correct','flash-wrong'),600);
  if(data.isCorrect!==null){if(data.isCorrect)playCorrect();else playWrong();}
  const fb=document.getElementById('answer-feedback');
  let html='';
  if(data.timeout)html='<strong>⏰ Temps écoulé !</strong><br>';
  else if(data.isCorrect)html=`<strong>✅ Bonne réponse !</strong>${data.streak>=3?` <span class="streak-fire">🔥 ${data.streak}</span>`:''}<br>`;
  else html=`<strong>❌ Mauvaise réponse</strong>${data.isTrap&&data.trapMessage?`<br><em>😏 ${data.trapMessage}</em>`:''}<br>`;
  if(data.explanation)html+=`<span style="color:var(--text2);font-size:.85rem">💡 ${data.explanation}</span>`;
  if(data.trapStats)html+=`<br><span style="color:var(--yellow);font-size:.78rem">📊 ${data.trapStats}</span>`;
  fb.className=`answer-feedback ${data.isCorrect?'correct-fb':data.isCorrect===null?'neutral-fb':'wrong-fb'}`;
  fb.innerHTML=html;fb.classList.remove('hidden');
  if(data.isCorrect&&data.streak>=3)showCoach(`🔥 ${data.streak} en série !`);
  else if(data.isCorrect===false)showCoach(getCoachTip(state.currentQuestion?.category));
}
function startTimer(s){stopTimer();state.timerSeconds=s;const arc=document.getElementById('timer-arc'),maxD=163.36;function tick(){setText('timer-text',state.timerSeconds);arc.style.strokeDashoffset=maxD*(1-state.timerSeconds/s);arc.style.stroke=state.timerSeconds<=5?'#f87171':state.timerSeconds<=10?'#fbbf24':'#4ade80';if(state.timerSeconds>0)state.timerSeconds--;else stopTimer();}tick();state.timerInterval=setInterval(tick,1000);}
function stopTimer(){clearInterval(state.timerInterval);state.timerInterval=null;}
function showCoach(text){const b=document.getElementById('coach-bubble');setText('coach-text',text);b.classList.remove('hidden');clearTimeout(b._t);b._t=setTimeout(()=>b.classList.add('hidden'),4500);}
function usePowerup(type){if(!state.powerups[type]||state.answered)return;state.powerups[type]--;document.getElementById(`pu-${type}`).disabled=true;socket.emit('use_powerup',{type});}

// ── Duel Results ──────────────────────────────────────
function showResults(data){
  stopTimer();showScreen('screen-results');
  const banner=document.getElementById('victory-banner');
  if(data.isDraw)banner.textContent='🤝 Match nul !';
  else if(data.winner===state.pseudo){banner.textContent='🏆 VICTOIRE !';playVictory();}
  else banner.textContent=`🎖️ Victoire de ${data.winner} !`;

  // Podium
  document.getElementById('podium').innerHTML=data.results.map(r=>{
    const isMe=r.pseudo===state.pseudo;
    const elo=r.eloChange?`<div class="podium-elo ${r.eloChange>0?'pos':'neg'}">${r.eloChange>0?'+':''}${r.eloChange}</div>`:'';
    return `<div class="podium-item rank-${r.rank} ${isMe?'me':''}"><div class="podium-rank">${rankEmoji(r.rank)}</div><div class="podium-pseudo">${r.pseudo}${isMe?'<span class="podium-you">toi</span>':''}</div><div><div class="podium-score">${r.score}<span style="font-size:.75rem;color:var(--text3)">/${r.total}</span></div><div class="podium-pct">${r.percentage}%</div></div>${elo}</div>`;
  }).join('');

  // Exam results
  if(data.examPassed){
    const ex=document.getElementById('exam-results-duel');
    ex.innerHTML=data.examPassed.map(p=>`<div class="exam-verdict ${p.passed?'admis':'recale'}">${p.pseudo} : ${p.passed?'✅ ADMIS':'❌ RECALÉ'}</div>`).join('');
    ex.classList.remove('hidden');
  }

  // New badges
  const myBadges=data.newBadges?.[state.pseudo];
  if(myBadges?.length){
    const nb=document.getElementById('new-badges-duel');
    nb.innerHTML=`<div class="new-badges-title">🎖️ Badge débloqué !</div>`+myBadges.map(b=>`<span class="badge-item">${b}</span>`).join('');
    nb.classList.remove('hidden');showToast(`🎖️ ${myBadges[0]} !`,4000);
  }

  // Analysis
  const myR=data.results.find(r=>r.pseudo===state.pseudo);
  if(myR?.eloChange)state.elo+=myR.eloChange,localStorage.setItem('elo',state.elo);
  const an=document.getElementById('results-analysis');
  if(myR&&Object.keys(myR.categoryErrors||{}).length){
    an.innerHTML=`<div class="analysis-title">📊 Tes erreurs</div>`+Object.entries(myR.categoryErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>`<div class="category-error"><span>${catName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`).join('');
  }else an.innerHTML='';

  // Replay
  if(data.replayData?.length){
    document.getElementById('replay-toggle').classList.remove('hidden');
    state.replayData=data.replayData;
  }

  // Rematch
  state.hostPseudo=data.hostPseudo;
  const btnR=document.getElementById('btn-rematch');
  if(state.pseudo===data.hostPseudo)btnR.classList.remove('hidden');else btnR.classList.add('hidden');
}

function toggleReplay(){
  const rc=document.getElementById('replay-content');
  if(!rc.classList.contains('hidden')){rc.classList.add('hidden');return;}
  rc.classList.remove('hidden');
  if(!state.replayData)return;
  rc.innerHTML=state.replayData.slice(0,10).map((q,i)=>{
    const allCorrect=q.playerAnswers.every(p=>p.isCorrect);
    return `<div class="replay-item ${allCorrect?'correct-q':'wrong-q'}">
      <div class="replay-q">${i+1}. ${q.question}</div>
      ${q.playerAnswers.map(p=>`<div class="replay-player"><span>${p.pseudo}</span><span>${p.isCorrect?'✅':'❌'} ${p.timeTaken?.toFixed(0)||'?'}s</span></div>`).join('')}
    </div>`;
  }).join('');
}

function requestRematch(){document.getElementById('btn-rematch').disabled=true;socket.emit('request_rematch');}

// ── Leaderboard ────────────────────────────────────────
async function loadLeaderboard(){
  const el=document.getElementById('leaderboard-list');
  el.innerHTML='<div class="spinner-center"><div class="spinner"></div></div>';
  try{
    const data=await(await fetch('/api/leaderboard')).json();
    if(!data.length){el.innerHTML='<p style="text-align:center;color:var(--text2)">Aucun joueur pour l\'instant 🤷</p>';return;}
    el.innerHTML=data.map((p,i)=>{const rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';const re=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;return `<div class="lb-item"><div class="lb-rank ${rc}">${re}</div><div><div class="lb-pseudo">${p.pseudo}</div><div class="lb-level">${p.levelInfo?.name||''}</div></div><div class="lb-elo">${p.elo} Elo</div><div class="lb-record">${p.wins||0}V ${p.losses||0}D</div></div>`;}).join('');
  }catch{el.innerHTML='<p style="color:var(--red)">Erreur</p>';}
}

// ── Preload questions for solo mode ───────────────────
async function preloadQuestions(){
  try{const res=await fetch('/api/training/session?count=100&mode=libre',{headers:state.token?{Authorization:`Bearer ${state.token}`}:{}});const data=await res.json();window._allQuestions=data.fullQuestions||[];}catch{}
}

// ── Socket Events ─────────────────────────────────────
socket.on('game_created',({roomCode,options,isHost})=>{state.roomCode=roomCode;state.isHost=isHost;state.gameOptions=options;showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);renderWaitingPlayers([{pseudo:state.pseudo,ready:false}],options.maxPlayers);});
socket.on('game_joined',({roomCode,players,options,isHost})=>{state.roomCode=roomCode;state.isHost=isHost;state.gameOptions=options;showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);renderWaitingPlayers(players,options.maxPlayers);});
socket.on('player_list_update',({players,maxPlayers})=>renderWaitingPlayers(players,maxPlayers));
socket.on('game_start',({players,options})=>{playStart();state.gameMode=options.mode;state.gameOptions=options;state.allPlayers=players.map(p=>({...p,score:0,streak:0,answered:false}));state.powerups={fifty50:1,timeBonus:1,stress:1};showScreen('screen-game');renderHUD();});
socket.on('new_question',data=>{state.allPlayers.forEach(p=>p.answered=false);renderQuestion(data);});
socket.on('scores_update',({players})=>{state.allPlayers=players;renderHUD();});
socket.on('answer_result',data=>{const me=state.allPlayers.find(p=>p.pseudo===state.pseudo);if(me){me.score=data.score;me.streak=data.streak;me.answered=true;}showAnswerResult(data);renderHUD();});
socket.on('powerup_result',({type,removed,bonusSeconds})=>{if(type==='fifty50'&&removed){removed.forEach(id=>document.querySelector(`.answer-btn[data-id="${id}"]`)?.classList.add('removed'));showToast('⚡ 50/50 utilisé !');}else if(type==='timeBonus'&&bonusSeconds){state.timerSeconds+=bonusSeconds;showToast(`⏱️ +${bonusSeconds}s !`);}else if(type==='stress')showToast('😱 Stress envoyé !');});
socket.on('powerup_applied',({type,penaltySeconds,from})=>{if(type==='stress'){state.timerSeconds=Math.max(3,state.timerSeconds-penaltySeconds);showToast(`😱 ${from} t'a stressé ! -${penaltySeconds}s`,3000);}});
socket.on('game_end',data=>showResults(data));
socket.on('player_disconnected',({pseudo})=>showToast(`💔 ${pseudo} a quitté...`,3000));
socket.on('rematch_started',({roomCode,options,players})=>{state.roomCode=roomCode;state.isHost=players[0]?.pseudo===state.pseudo;state.gameOptions=options;showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);renderWaitingPlayers(players,options.maxPlayers);showToast('🔄 Revanche ! Cliquez sur Prêt !');});
socket.on('error',msg=>{showError('play-error',msg);showError('join-error',msg);showToast(`❌ ${msg}`,3000);});


function confirmLeaveGame() {
  if (confirm('Quitter la partie en cours ?')) {
    stopTimer();
    showScreen('screen-home');
  }
}
// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  if(state.pseudo){updateChips();updateSoloChip();startSessionTracking();}
  preloadQuestions();
  // Load avatar from server if logged in
  if(state.token){fetch('/api/profile',{headers:{Authorization:`Bearer ${state.token}`}}).then(r=>r.json()).then(data=>{if(data.avatar){state.avatar=data.avatar;localStorage.setItem('avatar',data.avatar);updateChips();}}).catch(()=>{});}
  document.getElementById('login-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('reg-password').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
  document.getElementById('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')doJoinGame();});
  document.getElementById('join-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
});
