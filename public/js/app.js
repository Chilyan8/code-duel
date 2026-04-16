/* ═══════════════════════════════════════════════════════
   CODE DUEL — Frontend App (multi-player + options)
   ═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
const state = {
  token: localStorage.getItem('token'),
  pseudo: localStorage.getItem('pseudo'),
  elo: parseInt(localStorage.getItem('elo') || '0'),
  roomCode: null,
  isHost: false,
  gameOptions: { maxPlayers:2, questionCount:40, timeLimit:30, category:'all', mode:'normal' },
  // Selected options in form
  selectedOptions: { players:2, questions:40, time:30, category:'all', mode:'normal' },
  // Game state
  currentQuestion: null,
  selectedAnswers: [],
  answered: false,
  timerInterval: null,
  timerSeconds: 30,
  powerups: { fifty50:1, timeBonus:1, stress:1 },
  myScore: 0,
  allPlayers: [],
  gameMode: 'normal',
};

const socket = io({ auth: { token: state.token } });

// ── Audio ──────────────────────────────────────────────
let audioCtx = null;
function getAudio() { if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function playTone(f,t='sine',d=.15,v=.3) { try { const c=getAudio(),o=c.createOscillator(),g=c.createGain(); o.connect(g);g.connect(c.destination); o.frequency.value=f;o.type=t; g.gain.setValueAtTime(v,c.currentTime); g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d); o.start();o.stop(c.currentTime+d); } catch{} }
function playCorrect() { playTone(523,'sine',.1); setTimeout(()=>playTone(659,'sine',.15),100); }
function playWrong() { playTone(220,'sawtooth',.2,.2); }
function playStart() { [261,329,392,523].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',.15),i*100)); }
function playVictory() { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',.2),i*150)); }

// ── Helpers ────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (id==='screen-leaderboard') loadLeaderboard();
  if (id==='screen-play') updatePlayScreen();
}
function showToast(msg,d=2500) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),d);
}
function showError(id,msg) { const e=document.getElementById(id); if(e){e.textContent=msg;e.classList.remove('hidden');} }
function hideError(id) { const e=document.getElementById(id); if(e) e.classList.add('hidden'); }
function setText(id,v) { const e=document.getElementById(id); if(e) e.textContent=v; }
function categoryName(cat) {
  return {priorites:'🚦 Priorités',panneaux:'🪧 Panneaux',vitesse:'⚡ Vitesses',alcool:'🍺 Alcool & Drogues',regles:'📋 Règles',securite:'🛡️ Sécurité',vehicule:'🔧 Véhicule',permis:'📄 Permis'}[cat] || cat;
}
function modeName(m) { return {normal:'🎯 Normal',blitz:'⚡ Blitz',examen:'📋 Examen',tournoi:'🏆 Tournoi'}[m]||m; }
function rankEmoji(r) { return ['🥇','🥈','🥉'][r-1] || `${r}.`; }

// ── Auth ───────────────────────────────────────────────
async function doLogin() {
  hideError('login-error');
  const pseudo=document.getElementById('login-pseudo').value.trim();
  const password=document.getElementById('login-password').value;
  if(!pseudo||!password) return showError('login-error','Remplis tous les champs');
  try {
    const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const data=await res.json();
    if(!res.ok) return showError('login-error',data.error);
    saveAuth(data); showToast(`Bienvenue, ${pseudo} ! 🎉`); showScreen('screen-play');
  } catch { showError('login-error','Erreur réseau'); }
}
async function doRegister() {
  hideError('reg-error');
  const pseudo=document.getElementById('reg-pseudo').value.trim();
  const password=document.getElementById('reg-password').value;
  if(!pseudo||!password) return showError('reg-error','Remplis tous les champs');
  try {
    const res=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const data=await res.json();
    if(!res.ok) return showError('reg-error',data.error);
    saveAuth(data); showToast(`Compte créé ! Bienvenue ${pseudo} 🚗`); showScreen('screen-play');
  } catch { showError('reg-error','Erreur réseau'); }
}
function saveAuth(data) {
  state.token=data.token; state.pseudo=data.pseudo; state.elo=data.elo||1000;
  localStorage.setItem('token',data.token); localStorage.setItem('pseudo',data.pseudo); localStorage.setItem('elo',data.elo||1000);
  socket.auth={token:data.token};
}
function switchTab(tab) {
  document.getElementById('auth-login').classList.toggle('hidden',tab!=='login');
  document.getElementById('auth-register').classList.toggle('hidden',tab!=='register');
  document.getElementById('tab-login').classList.toggle('active',tab==='login');
  document.getElementById('tab-register').classList.toggle('active',tab==='register');
}
function promptGuest() {
  const p=prompt('Choisis un pseudo invité :');
  if(p&&p.trim().length>=2) { state.pseudo=p.trim().slice(0,20); showScreen('screen-play'); }
}
function updatePlayScreen() {
  const chip=document.getElementById('play-user-info');
  if(state.pseudo) { chip.textContent=`👤 ${state.pseudo}${state.elo?' · '+state.elo+' Elo':''}`; chip.classList.remove('hidden'); }
  else chip.classList.add('hidden');
}

// ── Game options form ──────────────────────────────────
function showCreateForm() {
  if(!state.pseudo) { promptGuest(); if(!state.pseudo) return; }
  document.getElementById('create-form').classList.toggle('hidden');
  document.getElementById('join-form').classList.add('hidden');
}
function showJoinForm() {
  if(!state.pseudo) { promptGuest(); if(!state.pseudo) return; }
  document.getElementById('join-form').classList.toggle('hidden');
  document.getElementById('create-form').classList.add('hidden');
}
function selectOption(type, val, el) {
  el.closest('.option-pills').querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  state.selectedOptions[type]=val;
}
function selectMode(mode, el) {
  document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  state.selectedOptions.mode=mode;
}
function openCreateGame() {
  if(!state.pseudo) { promptGuest(); if(!state.pseudo) return; }
  hideError('play-error');
  const options = {
    maxPlayers: state.selectedOptions.players,
    questionCount: state.selectedOptions.questions,
    timeLimit: state.selectedOptions.time,
    category: state.selectedOptions.category,
    mode: state.selectedOptions.mode,
  };
  socket.emit('create_game', { pseudo: state.pseudo, options });
}
function doJoinGame() {
  const code=document.getElementById('join-code').value.trim().toUpperCase();
  if(code.length<4) return showError('join-error','Entrez un code valide');
  hideError('join-error');
  socket.emit('join_game',{roomCode:code,pseudo:state.pseudo});
}
function copyRoomCode() {
  const code=document.getElementById('display-room-code').textContent;
  navigator.clipboard.writeText(code).then(()=>showToast('Code copié ! 📋'));
}
function sendReady() {
  document.getElementById('btn-ready').disabled=true;
  document.getElementById('btn-ready').textContent='⏳ En attente...';
  socket.emit('player_ready');
}
function forceStart() {
  socket.emit('force_start');
}

// ── Render waiting room ────────────────────────────────
function renderWaitingPlayers(players, maxPlayers, isHost) {
  const container = document.getElementById('players-waiting');
  container.innerHTML = '';

  // Show filled slots
  for(let i=0; i<maxPlayers; i++) {
    const p = players[i];
    const div = document.createElement('div');
    div.className = `waiting-player ${p ? 'connected' : 'empty'}`;
    if(p) {
      div.innerHTML = `
        <div class="wp-avatar connected">${p.pseudo[0].toUpperCase()}</div>
        <div>
          <div class="wp-name">${p.pseudo}${p.pseudo===state.pseudo?' <span style="font-size:.7rem;color:var(--accent2)">(toi)</span>':''}</div>
          <div class="wp-tag">${i===0?'👑 Hôte':'Joueur '+(i+1)}</div>
        </div>
        <div class="wp-status">${p.ready?'✅':'⏳'}</div>
      `;
    } else {
      div.innerHTML = `
        <div class="wp-avatar">?</div>
        <div><div class="wp-name" style="color:var(--text3)">En attente...</div><div class="wp-tag">Joueur ${i+1}</div></div>
        <div class="wp-status">⏳</div>
      `;
    }
    container.appendChild(div);
  }

  // Show/hide buttons
  const myPlayer = players.find(p=>p.pseudo===state.pseudo);
  const btnReady = document.getElementById('btn-ready');
  const btnForce = document.getElementById('btn-force-start');
  const waitMsg = document.getElementById('waiting-msg');

  if(myPlayer && !myPlayer.ready) {
    btnReady.classList.remove('hidden');
    btnReady.disabled = false;
    btnReady.textContent = '✅ Je suis prêt !';
  } else if(myPlayer?.ready) {
    btnReady.classList.remove('hidden');
    btnReady.disabled = true;
    btnReady.textContent = '✅ Prêt !';
  }

  if(isHost && players.length >= 2) {
    btnForce.classList.remove('hidden');
  } else {
    btnForce.classList.add('hidden');
  }

  if(players.length < maxPlayers) {
    waitMsg.innerHTML = '<div class="spinner"></div> En attente de joueurs... (' + players.length + '/' + maxPlayers + ')';
    waitMsg.style.display = 'flex';
  } else {
    waitMsg.style.display = 'none';
  }
}

function renderOptionsDisplay(options) {
  const el = document.getElementById('options-display');
  el.innerHTML = [
    `👥 ${options.maxPlayers} joueurs`,
    `❓ ${options.questionCount} questions`,
    `⏱️ ${options.timeLimit}s`,
    `${categoryName(options.category)}`,
    modeName(options.mode),
  ].map(t=>`<span class="options-tag">${t}</span>`).join('');
}

// ── Game HUD (multi-player) ────────────────────────────
function renderHUD() {
  const container = document.getElementById('hud-scores');
  container.innerHTML = '';
  const maxScore = Math.max(...state.allPlayers.map(p=>p.score), 0);
  state.allPlayers.forEach(p => {
    const isMe = p.pseudo === state.pseudo;
    const isLeading = p.score === maxScore && maxScore > 0;
    const div = document.createElement('div');
    div.className = `hud-player-score ${isMe?'me':''} ${isLeading&&!isMe?'leading':''}`;
    div.id = `hud-${p.pseudo}`;
    div.innerHTML = `
      <div>
        <div class="hps-name">${p.pseudo}</div>
        ${p.answered?'<div style="font-size:.65rem;color:var(--green)">✓</div>':''}
      </div>
      <div class="hps-score">${p.score}</div>
      ${p.streak>=3?`<div class="hps-streak">🔥${p.streak}</div>`:''}
    `;
    container.appendChild(div);
  });
}

// ── Render question ────────────────────────────────────
function renderQuestion(data) {
  state.currentQuestion = data;
  state.selectedAnswers = [];
  state.answered = false;

  setText('q-counter',`${data.index+1}/${data.total}`);
  setText('q-category',categoryName(data.category));
  setText('q-text',data.question);
  document.getElementById('game-progress').style.width=`${(data.index/data.total)*100}%`;
  document.getElementById('trap-indicator').classList.toggle('hidden',!data.isTrap);
  setText('mode-badge', modeName(data.mode||state.gameMode));

  // Multiple hint
  let hint = document.getElementById('multi-hint');
  if(data.isMultiple) {
    if(!hint){hint=document.createElement('div');hint.id='multi-hint';hint.className='multiple-hint';}
    hint.textContent='⚠️ Plusieurs bonnes réponses — coche toutes les bonnes !';
    document.getElementById('q-text').after(hint);
  } else { if(hint) hint.remove(); }

  // Build answers
  const container = document.getElementById('answers-container');
  container.innerHTML='';
  data.answers.forEach(a => {
    const btn = document.createElement('button');
    btn.className='answer-btn'; btn.dataset.id=a.id;
    btn.textContent=`${a.id.toUpperCase()}) ${a.text}`;
    if(data.isMultiple) {
      btn.addEventListener('click',()=>{
        if(state.answered) return;
        btn.classList.toggle('selected');
        const idx=state.selectedAnswers.indexOf(a.id);
        if(idx>=0) state.selectedAnswers.splice(idx,1); else state.selectedAnswers.push(a.id);
        updateConfirmBtn();
      });
    } else {
      btn.addEventListener('click',()=>{ if(!state.answered) submitAnswer([a.id]); });
    }
    container.appendChild(btn);
  });

  // Confirm button for multiple
  let confirm = document.getElementById('confirm-btn');
  if(data.isMultiple) {
    if(!confirm){confirm=document.createElement('button');confirm.id='confirm-btn';confirm.className='btn btn-primary confirm-btn';confirm.textContent='Valider ✅';confirm.addEventListener('click',()=>{if(state.selectedAnswers.length>0)submitAnswer(state.selectedAnswers);});}
    confirm.disabled=true;
    container.after(confirm);
  } else { if(confirm) confirm.remove(); }

  const fb=document.getElementById('answer-feedback');
  fb.classList.add('hidden');
  fb.className='answer-feedback hidden';

  ['fifty50','timeBonus','stress'].forEach(pu=>{
    const b=document.getElementById(`pu-${pu}`); if(b) b.disabled=!state.powerups[pu];
  });

  startTimer(data.timeLimit||30);

  const intros=['Concentre-toi ! 🧑‍🏫','Lis bien les choix 📖','Prends le temps ⏱️','Fais confiance à ta mémoire 🧠','Attention aux pièges ! 👀'];
  if(Math.random()<.25) showCoach(intros[Math.floor(Math.random()*intros.length)]);
}

function updateConfirmBtn() {
  const b=document.getElementById('confirm-btn'); if(b) b.disabled=state.selectedAnswers.length===0;
}

function submitAnswer(answers) {
  if(state.answered) return;
  state.answered=true;
  const timeTaken=state.currentQuestion.timeLimit - state.timerSeconds;
  document.querySelectorAll('.answer-btn').forEach(b=>b.disabled=true);
  const cb=document.getElementById('confirm-btn'); if(cb) cb.disabled=true;
  socket.emit('submit_answer',{answers,timeTaken});
  const fb=document.getElementById('answer-feedback');
  fb.className='answer-feedback neutral-fb';
  fb.innerHTML='<div style="display:flex;align-items:center;gap:.5rem;color:var(--text2)"><div class="spinner"></div> En attente des autres...</div>';
  fb.classList.remove('hidden');
}

function showAnswerResult(data) {
  stopTimer();
  if(data.hidden) return; // examen mode

  document.querySelectorAll('.answer-btn').forEach(btn=>{
    const id=btn.dataset.id;
    if(data.correctAnswers?.includes(id)) btn.classList.add('correct');
    else if(state.selectedAnswers.includes(id)&&!data.correctAnswers?.includes(id)) btn.classList.add('wrong');
  });

  document.getElementById('screen-game').classList.add(data.isCorrect?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-game').classList.remove('flash-correct','flash-wrong'),600);
  if(data.isCorrect!==null) { if(data.isCorrect) playCorrect(); else playWrong(); }

  const fb=document.getElementById('answer-feedback');
  let html='';
  if(data.timeout) html='<strong>⏰ Temps écoulé !</strong><br>';
  else if(data.isCorrect) {
    html=`<strong>✅ Bonne réponse !</strong>${data.streak>=3?` <span class="streak-fire">🔥 ${data.streak} de suite !</span>`:''}<br>`;
  } else {
    html=`<strong>❌ Mauvaise réponse</strong>${data.isTrap&&data.trapMessage?`<br><em>😏 ${data.trapMessage}</em>`:''}<br>`;
  }
  if(data.explanation) html+=`<span style="color:var(--text2);font-size:.85rem">💡 ${data.explanation}</span>`;
  fb.className=`answer-feedback ${data.isCorrect?'correct-fb':data.isCorrect===null?'neutral-fb':'wrong-fb'}`;
  fb.innerHTML=html; fb.classList.remove('hidden');

  if(data.isCorrect&&data.streak>=3) showCoach(`🔥 ${data.streak} bonnes réponses d'affilée !`);
  else if(data.isCorrect===false) {
    const c=['Aïe ! On retiendra ! 📚','Pas de panique, on révise ! 💪','Ton adversaire a peut-être aussi raté ! 🤞'];
    showCoach(c[Math.floor(Math.random()*c.length)]);
  }
}

function startTimer(seconds) {
  stopTimer();
  state.timerSeconds=seconds;
  const arc=document.getElementById('timer-arc'), maxDash=163.36;
  function tick() {
    setText('timer-text',state.timerSeconds);
    const pct=state.timerSeconds/seconds;
    arc.style.strokeDashoffset=maxDash*(1-pct);
    arc.style.stroke=state.timerSeconds<=5?'#f87171':state.timerSeconds<=10?'#fbbf24':'#4ade80';
    if(state.timerSeconds>0) state.timerSeconds--;
    else stopTimer();
  }
  tick(); state.timerInterval=setInterval(tick,1000);
}
function stopTimer() { clearInterval(state.timerInterval); state.timerInterval=null; }

function showCoach(text) {
  const b=document.getElementById('coach-bubble'); setText('coach-text',text);
  b.classList.remove('hidden'); clearTimeout(b._t); b._t=setTimeout(()=>b.classList.add('hidden'),4000);
}

// ── Power-ups ──────────────────────────────────────────
function usePowerup(type) {
  if(!state.powerups[type]||state.answered) return;
  state.powerups[type]--;
  document.getElementById(`pu-${type}`).disabled=true;
  socket.emit('use_powerup',{type});
}

// ── Results ────────────────────────────────────────────
function showResults(data) {
  stopTimer();
  showScreen('screen-results');

  const banner=document.getElementById('victory-banner');
  if(data.isDraw) { banner.textContent='🤝 Match nul !'; }
  else if(data.winner===state.pseudo) { banner.textContent='🏆 VICTOIRE !'; playVictory(); }
  else { banner.textContent=`🎖️ Victoire de ${data.winner} !`; }

  // Podium
  const podium=document.getElementById('podium');
  podium.innerHTML=data.results.map(r=>{
    const isMe=r.pseudo===state.pseudo;
    const eloHtml=r.eloChange?`<div class="podium-elo ${r.eloChange>0?'pos':'neg'}">${r.eloChange>0?'+':''}${r.eloChange} Elo</div>`:'';
    return `<div class="podium-item rank-${r.rank} ${isMe?'me':''}">
      <div class="podium-rank">${rankEmoji(r.rank)}</div>
      <div class="podium-pseudo">${r.pseudo}${isMe?'<span class="podium-you">toi</span>':''}</div>
      <div>
        <div class="podium-score">${r.score}<span style="font-size:.8rem;color:var(--text3)">/${r.total}</span></div>
        <div class="podium-pct">${r.percentage}%</div>
      </div>
      ${eloHtml}
    </div>`;
  }).join('');

  // Update local elo
  const myResult=data.results.find(r=>r.pseudo===state.pseudo);
  if(myResult?.eloChange&&state.token) {
    state.elo+=myResult.eloChange; localStorage.setItem('elo',state.elo);
  }

  // Analysis for me
  const analysis=document.getElementById('results-analysis');
  if(myResult&&Object.keys(myResult.categoryErrors||{}).length>0) {
    let html=`<div class="analysis-title">📊 Tes erreurs par thème</div>`;
    html+=Object.entries(myResult.categoryErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>
      `<div class="category-error"><span>${categoryName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`
    ).join('');
    analysis.innerHTML=html;
  } else {
    analysis.innerHTML=myResult?`<div style="text-align:center;color:var(--green);padding:1rem">🌟 Aucune erreur pour toi !</div>`:'';
  }
}

// ── Leaderboard ────────────────────────────────────────
async function loadLeaderboard() {
  const el=document.getElementById('leaderboard-list');
  el.innerHTML='<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const data=await (await fetch('/api/leaderboard')).json();
    if(!data.length){el.innerHTML='<p style="text-align:center;color:var(--text2)">Aucun joueur 🤷</p>';return;}
    el.innerHTML=data.map((p,i)=>{
      const rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';
      const re=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      return `<div class="lb-item"><div class="lb-rank ${rc}">${re}</div><div class="lb-pseudo">${p.pseudo}</div><div class="lb-elo">${p.elo} Elo</div><div class="lb-record">${p.wins}V ${p.losses}D</div></div>`;
    }).join('');
  } catch { el.innerHTML='<p style="color:var(--red)">Erreur</p>'; }
}

// ── Socket Events ──────────────────────────────────────
socket.on('game_created', ({ roomCode, options, isHost }) => {
  state.roomCode=roomCode; state.isHost=isHost; state.gameOptions=options;
  showScreen('screen-waiting');
  setText('display-room-code',roomCode);
  renderOptionsDisplay(options);
  renderWaitingPlayers([{pseudo:state.pseudo,ready:false}], options.maxPlayers, true);
});

socket.on('game_joined', ({ roomCode, players, options, isHost }) => {
  state.roomCode=roomCode; state.isHost=isHost; state.gameOptions=options;
  showScreen('screen-waiting');
  setText('display-room-code',roomCode);
  renderOptionsDisplay(options);
  renderWaitingPlayers(players, options.maxPlayers, false);
});

socket.on('player_list_update', ({ players, maxPlayers }) => {
  renderWaitingPlayers(players, maxPlayers, state.isHost);
});

socket.on('game_start', ({ totalQuestions, players, options }) => {
  playStart();
  state.gameMode=options.mode;
  state.gameOptions=options;
  state.allPlayers=players.map(p=>({...p,score:0,streak:0,answered:false}));
  state.powerups={fifty50:1,timeBonus:1,stress:1};
  showScreen('screen-game');
  renderHUD();
});

socket.on('new_question', (data) => {
  // Reset answered status in allPlayers
  state.allPlayers.forEach(p=>p.answered=false);
  renderQuestion(data);
});

socket.on('scores_update', ({ players }) => {
  state.allPlayers=players;
  renderHUD();
});

socket.on('answer_result', (data) => {
  const me=state.allPlayers.find(p=>p.pseudo===state.pseudo);
  if(me){ me.score=data.score; me.streak=data.streak; me.answered=true; }
  showAnswerResult(data);
  renderHUD();
});

socket.on('powerup_result', ({ type, removed, bonusSeconds }) => {
  if(type==='fifty50'&&removed) {
    removed.forEach(id=>{const b=document.querySelector(`.answer-btn[data-id="${id}"]`);if(b)b.classList.add('removed');});
    showToast('⚡ 50/50 utilisé !');
  } else if(type==='timeBonus'&&bonusSeconds) {
    state.timerSeconds+=bonusSeconds; showToast(`⏱️ +${bonusSeconds} secondes !`);
  } else if(type==='stress') { showToast('😱 Stress envoyé !'); }
});

socket.on('powerup_applied', ({ type, penaltySeconds, from }) => {
  if(type==='stress') {
    state.timerSeconds=Math.max(3,state.timerSeconds-penaltySeconds);
    showToast(`😱 ${from} t'a stressé ! -${penaltySeconds}s !`,3000);
  }
});

socket.on('game_end', (data) => { showResults(data); });

socket.on('player_disconnected', ({ pseudo }) => {
  showToast(`💔 ${pseudo} a quitté la partie...`,3000);
});

socket.on('error', (msg) => {
  showError('play-error', msg);
  showError('join-error', msg);
  showToast(`❌ ${msg}`,3000);
});

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if(state.pseudo) updatePlayScreen();
  document.getElementById('login-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('reg-password').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
  document.getElementById('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')doJoinGame();});
  document.getElementById('join-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
});
