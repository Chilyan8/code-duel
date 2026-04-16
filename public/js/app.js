/* CODE DUEL v3 — Multi-joueurs, MongoDB, Rematch, Images */
const state = {
  token: localStorage.getItem('token'),
  pseudo: localStorage.getItem('pseudo'),
  elo: parseInt(localStorage.getItem('elo') || '0'),
  roomCode: null, isHost: false,
  gameOptions: {}, selectedOptions: { players:2, questions:40, time:30, category:'all', mode:'normal' },
  currentQuestion: null, selectedAnswers: [], answered: false,
  timerInterval: null, timerSeconds: 30,
  powerups: { fifty50:1, timeBonus:1, stress:1 },
  allPlayers: [], gameMode: 'normal', hostPseudo: null,
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
  document.getElementById(id)?.classList.add('active');
  if (id==='screen-leaderboard') loadLeaderboard();
  if (id==='screen-play') updatePlayScreen();
}
function showToast(msg,d=2500) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),d);
}
function showError(id,msg) { const e=document.getElementById(id); if(e){e.textContent=msg;e.classList.remove('hidden');} }
function hideError(id) { document.getElementById(id)?.classList.add('hidden'); }
function setText(id,v) { const e=document.getElementById(id); if(e) e.textContent=v; }
const catNames = {priorites:'🚦 Priorités',panneaux:'🪧 Panneaux',vitesse:'⚡ Vitesses',alcool:'🍺 Alcool',regles:'📋 Règles',securite:'🛡️ Sécurité',vehicule:'🔧 Véhicule',permis:'📄 Permis',situation:'🚗 Situation'};
function categoryName(c) { return catNames[c] || c; }
function modeName(m) { return {normal:'🎯 Normal',blitz:'⚡ Blitz',examen:'📋 Examen',tournoi:'🏆 Tournoi'}[m]||m; }
function rankEmoji(r) { return ['🥇','🥈','🥉'][r-1]||`${r}.`; }

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
    saveAuth(data); showToast(`Compte créé et enregistré ! Bienvenue ${pseudo} 🚗`); showScreen('screen-play');
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

// ── Game options ───────────────────────────────────────
function showCreateForm() {
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  document.getElementById('create-form').classList.toggle('hidden');
  document.getElementById('join-form').classList.add('hidden');
}
function showJoinForm() {
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  document.getElementById('join-form').classList.toggle('hidden');
  document.getElementById('create-form').classList.add('hidden');
}
function selectOption(type,val,el) {
  el.closest('.option-pills').querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); state.selectedOptions[type]=val;
}
function selectMode(mode,el) {
  document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('active'));
  el.classList.add('active'); state.selectedOptions.mode=mode;
}
function openCreateGame() {
  if(!state.pseudo){promptGuest();if(!state.pseudo)return;}
  hideError('play-error');
  socket.emit('create_game',{ pseudo:state.pseudo, options:{ maxPlayers:state.selectedOptions.players, questionCount:state.selectedOptions.questions, timeLimit:state.selectedOptions.time, category:state.selectedOptions.category, mode:state.selectedOptions.mode }});
}
function doJoinGame() {
  const code=document.getElementById('join-code').value.trim().toUpperCase();
  if(code.length<4) return showError('join-error','Entrez un code valide');
  hideError('join-error'); socket.emit('join_game',{roomCode:code,pseudo:state.pseudo});
}
function copyRoomCode() {
  navigator.clipboard.writeText(document.getElementById('display-room-code').textContent).then(()=>showToast('Code copié ! 📋'));
}
function sendReady() {
  document.getElementById('btn-ready').disabled=true;
  document.getElementById('btn-ready').textContent='⏳ En attente...';
  socket.emit('player_ready');
}
function forceStart() { socket.emit('force_start'); }

// ── Waiting room ───────────────────────────────────────
function renderWaitingPlayers(players, maxPlayers) {
  const c=document.getElementById('players-waiting'); c.innerHTML='';
  for(let i=0;i<maxPlayers;i++) {
    const p=players[i]; const div=document.createElement('div');
    div.className=`waiting-player ${p?'connected':'empty'}`;
    div.innerHTML=p
      ?`<div class="wp-avatar connected">${p.pseudo[0].toUpperCase()}</div><div><div class="wp-name">${p.pseudo}${p.pseudo===state.pseudo?' <small style="color:var(--accent2)">(toi)</small>':''}</div><div class="wp-tag">${i===0?'👑 Hôte':'Joueur '+(i+1)}</div></div><div class="wp-status">${p.ready?'✅':'⏳'}</div>`
      :`<div class="wp-avatar">?</div><div><div class="wp-name" style="color:var(--text3)">En attente...</div><div class="wp-tag">Joueur ${i+1}</div></div><div class="wp-status">⏳</div>`;
    c.appendChild(div);
  }
  const myP=players.find(p=>p.pseudo===state.pseudo);
  const btnR=document.getElementById('btn-ready');
  const btnF=document.getElementById('btn-force-start');
  if(myP&&!myP.ready){btnR.classList.remove('hidden');btnR.disabled=false;btnR.textContent='✅ Je suis prêt !';}
  else if(myP?.ready){btnR.classList.remove('hidden');btnR.disabled=true;btnR.textContent='✅ Prêt !';}
  if(state.isHost&&players.length>=2) btnF.classList.remove('hidden'); else btnF.classList.add('hidden');
  const msg=document.getElementById('waiting-msg');
  if(players.length<maxPlayers){msg.innerHTML=`<div class="spinner"></div> En attente... (${players.length}/${maxPlayers})`;msg.style.display='flex';}
  else msg.style.display='none';
}
function renderOptionsDisplay(options) {
  document.getElementById('options-display').innerHTML=[
    `👥 ${options.maxPlayers} joueurs`,`❓ ${options.questionCount} questions`,`⏱️ ${options.timeLimit}s`,
    categoryName(options.category), modeName(options.mode)
  ].map(t=>`<span class="options-tag">${t}</span>`).join('');
}

// ── HUD (multi-player) ────────────────────────────────
function renderHUD() {
  const c=document.getElementById('hud-scores'); c.innerHTML='';
  const max=Math.max(...state.allPlayers.map(p=>p.score),0);
  state.allPlayers.forEach(p=>{
    const isMe=p.pseudo===state.pseudo;
    const div=document.createElement('div');
    div.className=`hud-player-score ${isMe?'me':''} ${p.score===max&&max>0&&!isMe?'leading':''}`;
    div.id=`hud-${p.pseudo}`;
    div.innerHTML=`<div><div class="hps-name">${p.pseudo}</div>${p.answered?'<div style="font-size:.6rem;color:var(--green)">✓</div>':''}</div><div class="hps-score">${p.score}</div>${p.streak>=3?`<div style="font-size:.75rem">🔥${p.streak}</div>`:''}`;
    c.appendChild(div);
  });
}

// ── Question rendering ────────────────────────────────
function renderQuestion(data) {
  state.currentQuestion=data; state.selectedAnswers=[]; state.answered=false;
  setText('q-counter',`${data.index+1}/${data.total}`);
  setText('q-category',categoryName(data.category));
  setText('q-text',data.question);
  setText('mode-badge',modeName(data.mode||state.gameMode));
  document.getElementById('game-progress').style.width=`${(data.index/data.total)*100}%`;
  document.getElementById('trap-indicator').classList.toggle('hidden',!data.isTrap);

  // Situation box
  const sitBox=document.getElementById('situation-box');
  if(data.situation){sitBox.textContent=`📍 ${data.situation}`;sitBox.classList.remove('hidden');}
  else sitBox.classList.add('hidden');

  // Image
  const imgWrap=document.getElementById('q-image-wrap');
  const img=document.getElementById('q-image');
  if(data.image_url){img.src=data.image_url;imgWrap.classList.remove('hidden');img.onerror=()=>imgWrap.classList.add('hidden');}
  else imgWrap.classList.add('hidden');

  // Multiple hint
  let hint=document.getElementById('multi-hint');
  if(data.isMultiple){
    if(!hint){hint=document.createElement('div');hint.id='multi-hint';hint.className='multiple-hint';}
    hint.textContent='⚠️ Plusieurs bonnes réponses — coche toutes les bonnes !';
    document.getElementById('q-text').after(hint);
  } else { hint?.remove(); }

  // Answers
  const cont=document.getElementById('answers-container'); cont.innerHTML='';
  data.answers.forEach(a=>{
    const btn=document.createElement('button');
    btn.className='answer-btn'; btn.dataset.id=a.id;
    btn.textContent=`${a.id.toUpperCase()}) ${a.text}`;
    if(data.isMultiple){
      btn.addEventListener('click',()=>{if(state.answered)return;btn.classList.toggle('selected');const idx=state.selectedAnswers.indexOf(a.id);if(idx>=0)state.selectedAnswers.splice(idx,1);else state.selectedAnswers.push(a.id);updateConfirmBtn();});
    } else {
      btn.addEventListener('click',()=>{if(!state.answered)submitAnswer([a.id]);});
    }
    cont.appendChild(btn);
  });

  // Confirm btn for multiple
  let cb=document.getElementById('confirm-btn');
  if(data.isMultiple){
    if(!cb){cb=document.createElement('button');cb.id='confirm-btn';cb.className='btn btn-primary confirm-btn';cb.textContent='Valider ✅';cb.addEventListener('click',()=>{if(state.selectedAnswers.length>0)submitAnswer(state.selectedAnswers);});}
    cb.disabled=true; cont.after(cb);
  } else cb?.remove();

  const fb=document.getElementById('answer-feedback'); fb.classList.add('hidden'); fb.className='answer-feedback hidden';
  ['fifty50','timeBonus','stress'].forEach(pu=>{const b=document.getElementById(`pu-${pu}`);if(b)b.disabled=!state.powerups[pu];});
  startTimer(data.timeLimit||30);
  const intros=['Concentre-toi ! 🧑‍🏫','Lis bien les choix ! 📖','Prends le temps ! ⏱️','Fais confiance à toi ! 🧠'];
  if(Math.random()<.25) showCoach(intros[Math.floor(Math.random()*intros.length)]);
}
function updateConfirmBtn(){const b=document.getElementById('confirm-btn');if(b)b.disabled=state.selectedAnswers.length===0;}
function submitAnswer(answers) {
  if(state.answered)return; state.answered=true;
  const timeTaken=(state.currentQuestion?.timeLimit||30)-state.timerSeconds;
  document.querySelectorAll('.answer-btn').forEach(b=>b.disabled=true);
  document.getElementById('confirm-btn')?.setAttribute('disabled','true');
  socket.emit('submit_answer',{answers,timeTaken});
  const fb=document.getElementById('answer-feedback');
  fb.className='answer-feedback neutral-fb';
  fb.innerHTML='<div style="display:flex;align-items:center;gap:.5rem;color:var(--text2)"><div class="spinner"></div> En attente des autres...</div>';
  fb.classList.remove('hidden');
}
function showAnswerResult(data) {
  stopTimer(); if(data.hidden) return;
  document.querySelectorAll('.answer-btn').forEach(btn=>{
    const id=btn.dataset.id;
    if(data.correctAnswers?.includes(id)) btn.classList.add('correct');
    else if(state.selectedAnswers.includes(id)) btn.classList.add('wrong');
  });
  document.getElementById('screen-game').classList.add(data.isCorrect?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-game').classList.remove('flash-correct','flash-wrong'),600);
  if(data.isCorrect!==null){if(data.isCorrect)playCorrect();else playWrong();}
  const fb=document.getElementById('answer-feedback');
  let html='';
  if(data.timeout) html='<strong>⏰ Temps écoulé !</strong><br>';
  else if(data.isCorrect) html=`<strong>✅ Bonne réponse !</strong>${data.streak>=3?` <span class="streak-fire">🔥 ${data.streak} de suite !</span>`:''}<br>`;
  else html=`<strong>❌ Mauvaise réponse</strong>${data.isTrap&&data.trapMessage?`<br><em>😏 ${data.trapMessage}</em>`:''}<br>`;
  if(data.explanation) html+=`<span style="color:var(--text2);font-size:.85rem">💡 ${data.explanation}</span>`;
  fb.className=`answer-feedback ${data.isCorrect?'correct-fb':data.isCorrect===null?'neutral-fb':'wrong-fb'}`;
  fb.innerHTML=html; fb.classList.remove('hidden');
  if(data.isCorrect&&data.streak>=3) showCoach(`🔥 ${data.streak} bonnes réponses d'affilée !`);
  else if(data.isCorrect===false){const c=['Aïe ! 📚','Pas de panique ! 💪','Garde confiance ! 🤞'];showCoach(c[Math.floor(Math.random()*c.length)]);}
}

function startTimer(s) {
  stopTimer(); state.timerSeconds=s;
  const arc=document.getElementById('timer-arc'),maxD=163.36;
  function tick(){
    setText('timer-text',state.timerSeconds);
    arc.style.strokeDashoffset=maxD*(1-state.timerSeconds/s);
    arc.style.stroke=state.timerSeconds<=5?'#f87171':state.timerSeconds<=10?'#fbbf24':'#4ade80';
    if(state.timerSeconds>0)state.timerSeconds--;else stopTimer();
  }
  tick(); state.timerInterval=setInterval(tick,1000);
}
function stopTimer(){clearInterval(state.timerInterval);state.timerInterval=null;}
function showCoach(text){const b=document.getElementById('coach-bubble');setText('coach-text',text);b.classList.remove('hidden');clearTimeout(b._t);b._t=setTimeout(()=>b.classList.add('hidden'),4000);}
function usePowerup(type){if(!state.powerups[type]||state.answered)return;state.powerups[type]--;document.getElementById(`pu-${type}`).disabled=true;socket.emit('use_powerup',{type});}

// ── Results + Rematch ──────────────────────────────────
function showResults(data) {
  stopTimer(); showScreen('screen-results');
  const banner=document.getElementById('victory-banner');
  if(data.isDraw){banner.textContent='🤝 Match nul !';}
  else if(data.winner===state.pseudo){banner.textContent='🏆 VICTOIRE !';playVictory();}
  else{banner.textContent=`🎖️ Victoire de ${data.winner} !`;}

  // Podium
  document.getElementById('podium').innerHTML=data.results.map(r=>{
    const isMe=r.pseudo===state.pseudo;
    const elo=r.eloChange?`<div class="podium-elo ${r.eloChange>0?'pos':'neg'}">${r.eloChange>0?'+':''}${r.eloChange} Elo</div>`:'';
    return `<div class="podium-item rank-${r.rank} ${isMe?'me':''}">
      <div class="podium-rank">${rankEmoji(r.rank)}</div>
      <div class="podium-pseudo">${r.pseudo}${isMe?'<span class="podium-you">toi</span>':''}</div>
      <div><div class="podium-score">${r.score}<span style="font-size:.75rem;color:var(--text3)">/${r.total}</span></div><div class="podium-pct">${r.percentage}%</div></div>
      ${elo}
    </div>`;
  }).join('');

  // Elo local update
  const myR=data.results.find(r=>r.pseudo===state.pseudo);
  if(myR?.eloChange&&state.token){state.elo+=myR.eloChange;localStorage.setItem('elo',state.elo);}

  // Analysis
  const an=document.getElementById('results-analysis');
  if(myR&&Object.keys(myR.categoryErrors||{}).length>0){
    an.innerHTML=`<div class="analysis-title">📊 Tes erreurs par thème</div>`+
      Object.entries(myR.categoryErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>
        `<div class="category-error"><span>${categoryName(cat)}</span><span style="color:var(--red)">${n} erreur${n>1?'s':''}</span></div>`).join('');
  } else { an.innerHTML=myR?`<div style="text-align:center;color:var(--green);padding:1rem">🌟 Aucune erreur !</div>`:''; }

  // Rematch button (host only)
  state.hostPseudo = data.isHost;
  const btnRematch=document.getElementById('btn-rematch');
  if(state.pseudo===data.isHost) btnRematch.classList.remove('hidden'); else btnRematch.classList.add('hidden');
}

function requestRematch() {
  document.getElementById('btn-rematch').disabled=true;
  document.getElementById('rematch-status').textContent='🔄 Création de la revanche...';
  document.getElementById('rematch-status').classList.remove('hidden');
  socket.emit('request_rematch');
}

// ── Leaderboard ────────────────────────────────────────
async function loadLeaderboard() {
  const el=document.getElementById('leaderboard-list');
  el.innerHTML='<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const data=await(await fetch('/api/leaderboard')).json();
    if(!data.length){el.innerHTML='<p style="text-align:center;color:var(--text2)">Aucun joueur pour l\'instant 🤷</p>';return;}
    el.innerHTML=data.map((p,i)=>{
      const rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';
      const re=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      return `<div class="lb-item"><div class="lb-rank ${rc}">${re}</div><div class="lb-pseudo">${p.pseudo}</div><div class="lb-elo">${p.elo} Elo</div><div class="lb-record">${p.wins}V ${p.losses||0}D</div></div>`;
    }).join('');
  } catch{el.innerHTML='<p style="color:var(--red)">Erreur de chargement</p>';}
}

// ── Socket Events ──────────────────────────────────────
socket.on('game_created',({roomCode,options,isHost})=>{
  state.roomCode=roomCode;state.isHost=isHost;state.gameOptions=options;
  showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);
  renderWaitingPlayers([{pseudo:state.pseudo,ready:false}],options.maxPlayers);
});
socket.on('game_joined',({roomCode,players,options,isHost})=>{
  state.roomCode=roomCode;state.isHost=isHost;state.gameOptions=options;
  showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);
  renderWaitingPlayers(players,options.maxPlayers);
});
socket.on('player_list_update',({players,maxPlayers})=>renderWaitingPlayers(players,maxPlayers));
socket.on('game_start',({players,options})=>{
  playStart();state.gameMode=options.mode;state.gameOptions=options;
  state.allPlayers=players.map(p=>({...p,score:0,streak:0,answered:false}));
  state.powerups={fifty50:1,timeBonus:1,stress:1};
  showScreen('screen-game');renderHUD();
});
socket.on('new_question',data=>{state.allPlayers.forEach(p=>p.answered=false);renderQuestion(data);});
socket.on('scores_update',({players})=>{state.allPlayers=players;renderHUD();});
socket.on('answer_result',data=>{
  const me=state.allPlayers.find(p=>p.pseudo===state.pseudo);
  if(me){me.score=data.score;me.streak=data.streak;me.answered=true;}
  showAnswerResult(data);renderHUD();
});
socket.on('powerup_result',({type,removed,bonusSeconds})=>{
  if(type==='fifty50'&&removed){removed.forEach(id=>{document.querySelector(`.answer-btn[data-id="${id}"]`)?.classList.add('removed');});showToast('⚡ 50/50 utilisé !');}
  else if(type==='timeBonus'&&bonusSeconds){state.timerSeconds+=bonusSeconds;showToast(`⏱️ +${bonusSeconds}s !`);}
  else if(type==='stress')showToast('😱 Stress envoyé !');
});
socket.on('powerup_applied',({type,penaltySeconds,from})=>{
  if(type==='stress'){state.timerSeconds=Math.max(3,state.timerSeconds-penaltySeconds);showToast(`😱 ${from} t'a stressé ! -${penaltySeconds}s !`,3000);}
});
socket.on('game_end',data=>showResults(data));
socket.on('player_disconnected',({pseudo})=>showToast(`💔 ${pseudo} a quitté...`,3000));
socket.on('rematch_started',({roomCode,options,players})=>{
  state.roomCode=roomCode;state.isHost=(players[0]?.pseudo===state.pseudo);state.gameOptions=options;
  showScreen('screen-waiting');setText('display-room-code',roomCode);renderOptionsDisplay(options);
  renderWaitingPlayers(players,options.maxPlayers);
  showToast('🔄 Revanche ! Cliquez sur Prêt !');
});
socket.on('error',msg=>{showError('play-error',msg);showError('join-error',msg);showToast(`❌ ${msg}`,3000);});

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  if(state.pseudo)updatePlayScreen();
  document.getElementById('login-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('reg-password').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
  document.getElementById('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')doJoinGame();});
  document.getElementById('join-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
});
