/* CODE DUEL — App stable */

const S = {
  isAuth: false,
  pseudo: localStorage.getItem('pseudo') || null,
  elo:    parseInt(localStorage.getItem('elo') || '1000'),
  avatar: localStorage.getItem('avatar') || null,
  country: localStorage.getItem('country') || null,
  roomCode: null, isHost: false, gameOptions: {},
  selectedOptions: { players:2, questions:40, time:30, category:'all', mode:'normal' },
  currentQ: null, selectedAnswers: [], answered: false,
  timerInterval: null, timerSecs: 30,
  powerups: { fifty50:1, timeBonus:1, stress:1 },
  allPlayers: [], gameMode: 'normal', hostPseudo: null, replayData: null,
  soloMode: 'training', soloCategory: 'all',
  soloQs: [], soloAnswers: [], soloIdx: 0,
  soloCorrect: 0, soloWrong: 0, soloStreak: 0, soloMaxStreak: 0,
  soloTimer: null, soloSecs: 30,
  queueTimer: null, queueSecs: 0, queueCountdownInterval: null,
  gamePlaying: false,
};

function countryFlag(country) {
  if (country === 'france') return '🇫🇷';
  if (country === 'belgique') return '🇧🇪';
  return '';
}
function countryName(country) {
  if (country === 'france') return 'France';
  if (country === 'belgique') return 'Belgique';
  return 'Non défini';
}

function floatElo(delta, anchorEl) {
  if (!delta || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'elo-float ' + (delta > 0 ? 'pos' : 'neg');
  el.textContent = (delta > 0 ? '+' : '') + delta + ' Elo';
  el.style.left = rect.left + rect.width/2 + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

const socket = io();

// ── Audio ──
let _ac = null;
function tone(f,t='sine',d=.15,v=.3){try{if(!_ac)_ac=new(window.AudioContext||window.webkitAudioContext)();const o=_ac.createOscillator(),g=_ac.createGain();o.connect(g);g.connect(_ac.destination);o.frequency.value=f;o.type=t;g.gain.setValueAtTime(v,_ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,_ac.currentTime+d);o.start();o.stop(_ac.currentTime+d);}catch{}}
const sfx={correct:()=>{tone(523,'sine',.1);setTimeout(()=>tone(659,'sine',.15),100);},wrong:()=>tone(220,'sawtooth',.2,.2),start:()=>[261,329,392,523].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.15),i*100)),win:()=>[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.2),i*150))};

// ── Navigation ──
function go(id) {
  const prev = document.querySelector('.screen.active');
  if (prev?.id === 'screen-game' && id !== 'screen-game' && id !== 'screen-results' && S.gamePlaying) {
    socket.emit('forfeit_game');
    S.gamePlaying = false;
    S.roomCode = null;
    stopTimer();
  }
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = '';
  el.classList.add('active');
  if (id === 'screen-home') {
    updateHomeUI();
    if (S.isAuth) apiFetch('/api/profile').then(r=>r.ok?r.json():null).then(d=>{if(d?.elo!==undefined&&d.elo!==S.elo){S.elo=d.elo;localStorage.setItem('elo',String(d.elo));updateHomeUI();}}).catch(()=>{});
  }
  if (id === 'screen-leaderboard') loadLeaderboard();
  if (id === 'screen-profile')     loadProfile();
}

function openProfile() {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const el = document.getElementById('screen-profile');
  el.style.display = 'flex';
  el.classList.add('active');
  loadProfile();
}

// ── Toast / helpers ──
function toast(msg, d=2500) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),d); }
function err(id,msg) { const e=document.getElementById(id); if(e){e.textContent=msg;e.classList.remove('hidden');} }
function clearErr(id) { document.getElementById(id)?.classList.add('hidden'); }
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

async function apiFetch(url, opts={}) {
  return fetch(url, {
    ...opts,
    credentials: 'include',
    headers: {'Authorization':'Bearer '+(window.__K__||''), ...opts.headers},
  });
}

// ── Auth ──
async function doLogin() {
  clearErr('login-err');
  const pseudo=document.getElementById('login-pseudo').value.trim();
  const password=document.getElementById('login-password').value;
  if(!pseudo||!password) return err('login-err','Remplis tous les champs');
  try {
    const r=await apiFetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const d=await r.json();
    if(!r.ok) return err('login-err',d.error||'Erreur');
    saveAuth(d); toast('Bienvenue '+pseudo+' ! 🎉'); go('screen-home');
  } catch { err('login-err','Erreur réseau'); }
}

async function doRegister() {
  clearErr('reg-err');
  const pseudo=document.getElementById('reg-pseudo').value.trim();
  const password=document.getElementById('reg-password').value;
  if(!pseudo||!password) return err('reg-err','Remplis tous les champs');
  if(pseudo.length<3) return err('reg-err','Pseudo trop court (min 3)');
  if(password.length<6) return err('reg-err','Mot de passe trop court (min 6)');
  try {
    const r=await apiFetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo,password})});
    const d=await r.json();
    if(!r.ok) return err('reg-err',d.error||'Erreur');
    saveAuth(d); toast('Compte créé ! Bienvenue '+pseudo+' 🚗'); go('screen-home');
  } catch { err('reg-err','Erreur réseau'); }
}

function saveAuth(d) {
  S.isAuth=true; S.pseudo=d.pseudo; S.elo=d.elo||1000;
  if(d.avatar) S.avatar=d.avatar;
  if(d.country !== undefined) { S.country=d.country; if(d.country) localStorage.setItem('country',d.country); else localStorage.removeItem('country'); }
  localStorage.setItem('pseudo',S.pseudo);
  localStorage.setItem('elo',String(S.elo));
  if(d.avatar) localStorage.setItem('avatar',d.avatar);
  socket.disconnect();
  socket.connect();
}

function doLogout() {
  apiFetch('/api/auth/logout',{method:'POST'}).catch(()=>{});
  S.isAuth=false; S.pseudo=null; S.elo=0; S.avatar=null; S.country=null;
  ['pseudo','elo','avatar','country'].forEach(k=>localStorage.removeItem(k));
  socket.disconnect();
  socket.connect();
  toast('Déconnecté 👋'); go('screen-home');
}

function switchAuthTab(tab) {
  document.getElementById('auth-login').classList.toggle('hidden',tab!=='login');
  document.getElementById('auth-register').classList.toggle('hidden',tab!=='register');
  document.getElementById('tab-login').classList.toggle('active',tab==='login');
  document.getElementById('tab-register').classList.toggle('active',tab==='register');
}

function promptGuest() {
  const p=prompt('Choisis un pseudo invité :');
  if(p&&p.trim().length>=2) { S.pseudo=p.trim().slice(0,20); localStorage.setItem('pseudo',S.pseudo); go('screen-home'); }
}

// ── Home UI ──
function updateHomeUI() {
  const el=document.getElementById('home-user');
  const authBtn=document.getElementById('home-auth-btn');
  const guestNote=document.getElementById('home-guest-note');
  if(S.pseudo&&S.isAuth) {
    // Construire l'avatar sans innerHTML direct sur données utilisateur
    el.innerHTML='';
    const avWrap=document.createElement('span');
    if(S.avatar&&S.avatar.startsWith('data:image/')) {
      const img=document.createElement('img');
      img.src=S.avatar;
      img.style.cssText='width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle';
      avWrap.appendChild(img);
    } else {
      avWrap.style.cssText='width:20px;height:20px;border-radius:50%;background:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:900;color:#fff;vertical-align:middle';
      avWrap.textContent=(S.pseudo[0]||'?').toUpperCase();
    }
    el.appendChild(avWrap);
    const sep = document.createTextNode(' ');
    const strong = document.createElement('strong');
    strong.textContent = S.pseudo;
    const dot = document.createTextNode(' · ');
    const eloSpan = document.createElement('span');
    eloSpan.style.color = 'var(--accent2)';
    eloSpan.textContent = S.elo;
    const eloLabel = document.createTextNode(' Elo');
    const flag = countryFlag(S.country);
    if (flag) {
      const flagSpan = document.createElement('span');
      flagSpan.textContent = ' ' + flag;
      el.append(sep, strong, dot, eloSpan, eloLabel, flagSpan);
    } else {
      el.append(sep, strong, dot, eloSpan, eloLabel);
    }
    el.style.display='flex';
    if(authBtn) authBtn.textContent='Déconnexion';
    if(guestNote) guestNote.style.display='none';
  } else {
    el.innerHTML='';
    if(S.pseudo&&!S.isAuth){
      const strong=document.createElement('strong');
      strong.textContent=S.pseudo;
      const badge=document.createElement('span');
      badge.style.cssText='color:var(--text3);font-size:.8rem';
      badge.textContent=' (invité)';
      el.append(strong, badge);
      el.style.display='flex';
    } else el.style.display='none';
    if(authBtn) authBtn.textContent='Connexion';
    if(guestNote) guestNote.style.display='';
  }
}

// ── Profile ──
async function loadProfile() {
  const pc=document.getElementById('profile-content');
  if(!pc) return;
  if(!S.isAuth) {
    pc.innerHTML='<div style="text-align:center;padding:2rem"><div style="font-size:3rem;margin-bottom:1rem">👤</div><p style="font-weight:700;margin-bottom:.5rem">Connecte-toi pour voir ton profil</p><p style="color:var(--text2);font-size:.9rem;margin-bottom:1.5rem">Tes stats et badges sont sauvegardés avec ton compte.</p><button class="btn btn-primary" onclick="go(\'screen-auth\')">Se connecter</button></div>';
    return;
  }
  pc.innerHTML='<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const r=await apiFetch('/api/profile');
    if(r.status===401){doLogout();return;}
    const d=await r.json();
    const wins=d.wins||0,losses=d.losses||0,games=d.total_games||0;
    const correct=d.total_correct||0,questions=d.total_questions||0;
    const acc=questions>0?Math.round(correct/questions*100):0;
    const winRate=games>0?Math.round(wins/games*100):0;
    const avgPerGame=games>0?(correct/games).toFixed(1):'0';
    const secs=d.total_seconds||0;
    const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60);
    const timeStr=h>0?h+'h '+m+'min':m>0?m+' min':secs>0?secs+'s':'< 1 min';
    const lv=d.level||{name:'🔰 Apprenti',next:1020,level:1};
    const eloBase={1:0,2:1000,3:1020,4:1080,5:1150,6:1250}[lv.level]||0;
    const eloRange=lv.next?lv.next-eloBase:1;
    const eloProgress=lv.next?Math.min(100,Math.round((d.elo-eloBase)/eloRange*100)):100;
    const avatar=d.avatar&&d.avatar.startsWith('data:image/')?d.avatar:null;
    if(avatar){S.avatar=avatar;localStorage.setItem('avatar',avatar);}
    if(d.country !== undefined) { S.country=d.country; if(d.country) localStorage.setItem('country',d.country); else localStorage.removeItem('country'); }
    const displayAvatar=avatar||S.avatar||null;
    const avHtml=displayAvatar?'<img src="'+displayAvatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">':"<span style='font-size:2.5rem;font-weight:900;color:var(--accent2)'>"+esc((d.pseudo[0]||'?').toUpperCase())+"</span>";
    const badges=d.badges||[];
    const catStats=d.category_stats||{};
    const weakCats=Object.entries(catStats).filter(([,s])=>s.sessions>0).sort((a,b)=>(b[1].errors/b[1].sessions)-(a[1].errors/a[1].sessions)).slice(0,4);
    const catNames={priorites:'🚦 Priorités',panneaux:'🪧 Panneaux',vitesse:'⚡ Vitesses',alcool:'🍺 Alcool',regles:'📋 Règles',securite:'🛡️ Sécurité',vehicule:'🔧 Véhicule',permis:'📄 Permis',situation:'🚗 Situation'};
    const catName=c=>catNames[c]||esc(c);
    const flag = countryFlag(d.country);
    pc.innerHTML=
      '<div style="text-align:center;padding:.5rem 0 1.5rem">'+
        '<div class="profile-avatar-wrap avatar-wrap-rel" id="prof-avatar-wrap">'+
          '<div class="profile-avatar-img" id="prof-av">'+avHtml+'</div>'+
          '<div class="avatar-edit-btn">✏️</div>'+
          (flag ? '<div class="country-badge" style="font-size:1.2rem;bottom:22px;right:-2px">'+flag+'</div>' : '')+
        '</div>'+
        '<div style="font-size:1.3rem;font-weight:800;margin:.4rem 0 .2rem">'+esc(d.pseudo)+' <button id="prof-pseudo-btn" style="background:none;border:1px solid var(--border);border-radius:6px;padding:.1rem .4rem;color:var(--text3);cursor:pointer;font-size:.65rem;vertical-align:middle">✏️</button></div>'+
        '<div style="color:var(--accent2);font-weight:700">'+esc(lv.name)+'</div>'+
        '<div style="color:var(--text2);font-size:.85rem">'+esc(d.elo)+' Elo'+(lv.next?' · encore '+(lv.next-d.elo)+' pts':' · Niveau max 🏆')+'</div>'+
        '<div style="width:180px;margin:.6rem auto 0">'+
          '<div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">'+
            '<div style="height:100%;width:'+eloProgress+'%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div>'+
          '</div>'+
          '<div style="font-size:.72rem;color:var(--text3);text-align:center;margin-top:.2rem">'+eloProgress+'% vers le prochain niveau</div>'+
        '</div>'+
      '</div>'+
      '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:.85rem 1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1rem">'+
        '<span style="font-size:1.5rem">⏱️</span>'+
        '<div><div style="font-weight:700">'+timeStr+'</div><div style="color:var(--text2);font-size:.78rem">passées sur le site</div></div>'+
        '<div style="margin-left:auto;text-align:right"><div style="font-weight:700">'+games+'</div><div style="color:var(--text2);font-size:.78rem">parties jouées</div></div>'+
      '</div>'+
      '<div class="profile-country-row" id="prof-country-row">'+
        '<div class="pcr-flag">'+(flag || '🌍')+'</div>'+
        '<div class="pcr-info">'+
          '<div class="pcr-label">🌍 Mon pays</div>'+
          '<div class="pcr-val">'+(d.country ? countryName(d.country) : 'Non défini')+'</div>'+
        '</div>'+
        '<div class="pcr-change">Changer ›</div>'+
      '</div>'+
      '<div class="profile-stats-grid">'+
        '<div class="profile-stat"><div class="ps-num">'+wins+'</div><div class="ps-label">✅ Victoires</div></div>'+
        '<div class="profile-stat"><div class="ps-num">'+losses+'</div><div class="ps-label">❌ Défaites</div></div>'+
        '<div class="profile-stat"><div class="ps-num">'+winRate+'%</div><div class="ps-label">🏆 Taux victoire</div></div>'+
        '<div class="profile-stat"><div class="ps-num">'+acc+'%</div><div class="ps-label">🎯 Précision</div></div>'+
        '<div class="profile-stat"><div class="ps-num">'+avgPerGame+'</div><div class="ps-label">📊 Moy/partie</div></div>'+
        '<div class="profile-stat"><div class="ps-num">'+correct+'</div><div class="ps-label">✔️ Bonnes rép.</div></div>'+
      '</div>'+
      '<div style="font-size:.8rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:1.1rem 0 .6rem">🎖️ Badges ('+badges.length+')</div>'+
      (badges.length?'<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">'+badges.map(b=>'<span style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);color:var(--yellow);padding:.3rem .75rem;border-radius:16px;font-size:.82rem">'+esc(b)+'</span>').join('')+'</div>':'<div style="color:var(--text3);font-size:.85rem;margin-bottom:.5rem">Aucun badge encore — joue pour en débloquer ! 💪</div>')+
      '<div style="font-size:.8rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:1.1rem 0 .6rem">📊 Analyse par thème</div>'+
      (weakCats.length?weakCats.map(([cat,s])=>{const pct=Math.round(s.errors/s.sessions*100);const col=pct>=60?'#f87171':pct>=30?'#fbbf24':'#4ade80';return '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem"><span style="font-size:.82rem;width:110px;flex-shrink:0">'+catName(cat)+'</span><div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:4px"></div></div><span style="font-size:.78rem;color:'+col+';width:36px;text-align:right">'+pct+'%</span></div>';}).join('')+'<button class="btn btn-primary w-full" id="prof-btn-training" style="margin-top:.75rem">🧠 Entraînement ciblé</button>':'<div style="color:var(--text3);font-size:.85rem">Joue des parties pour voir ton analyse !</div>')+
      '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;gap:.6rem;flex-wrap:wrap">'+
        '<button class="btn btn-primary" id="prof-btn-home">🏠 Accueil</button>'+
        '<button class="btn btn-ghost" id="prof-btn-play">⚔️ Duel</button>'+
        '<button class="btn btn-ghost" id="prof-btn-exam">📋 Examen</button>'+
        '<button class="btn btn-ghost-sm" id="prof-btn-logout" style="margin-left:auto;color:var(--red)">Déconnexion</button>'+
      '</div>';
    // Attach event listeners (CSP blocks inline onclick in dynamically generated HTML)
    pc.querySelector('#prof-avatar-wrap')?.addEventListener('click', openAvatarModal);
    pc.querySelector('#prof-pseudo-btn')?.addEventListener('click', openPseudoModal);
    pc.querySelector('#prof-country-row')?.addEventListener('click', openCountryModal);
    pc.querySelector('#prof-btn-home')?.addEventListener('click', () => go('screen-home'));
    pc.querySelector('#prof-btn-play')?.addEventListener('click', () => go('screen-play'));
    pc.querySelector('#prof-btn-exam')?.addEventListener('click', () => startSolo('examen_blanc'));
    pc.querySelector('#prof-btn-logout')?.addEventListener('click', doLogout);
    pc.querySelector('#prof-btn-training')?.addEventListener('click', () => startSolo('training'));
  } catch {
    pc.innerHTML='<div style="text-align:center;padding:2rem"><p style="color:var(--red);margin-bottom:1rem">Erreur de chargement du profil</p><button class="btn btn-primary" id="prof-err-auth">Se connecter</button><div style="margin-top:.75rem"><button class="btn btn-ghost" id="prof-err-home">🏠 Accueil</button></div></div>';
    pc.querySelector('#prof-err-auth')?.addEventListener('click', () => go('screen-auth'));
    pc.querySelector('#prof-err-home')?.addEventListener('click', () => go('screen-home'));
  }
}

// ── Pseudo change ──
function openPseudoModal(){
  document.getElementById('new-pseudo-input').value=S.pseudo||'';
  document.getElementById('pseudo-modal-err').classList.add('hidden');
  document.getElementById('pseudo-modal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('new-pseudo-input').focus(),100);
}
function closePseudoModal(){document.getElementById('pseudo-modal').classList.add('hidden');}
async function savePseudo(){
  const pseudo=document.getElementById('new-pseudo-input').value.trim();
  if(!pseudo)return;
  clearErr('pseudo-modal-err');
  try{
    const r=await apiFetch('/api/profile/pseudo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pseudo})});
    const d=await r.json();
    if(!r.ok)return err('pseudo-modal-err',d.error||'Erreur');
    S.pseudo=d.pseudo;
    localStorage.setItem('pseudo',d.pseudo);
    // Reconnecte le socket pour utiliser le nouveau cookie (pseudo mis à jour dans le token)
    socket.disconnect();
    socket.connect();
    closePseudoModal(); toast('Pseudo mis à jour ! 🎉'); loadProfile(); updateHomeUI();
  }catch{err('pseudo-modal-err','Erreur réseau');}
}

// ── Country ──
function openCountryModal() {
  const modal = document.getElementById('country-modal');
  document.querySelectorAll('.country-option').forEach(o => {
    o.classList.toggle('selected', o.dataset.country === S.country);
  });
  modal.classList.remove('hidden');
}
function closeCountryModal() { document.getElementById('country-modal').classList.add('hidden'); }
async function selectCountry(country) {
  if (!S.isAuth) { toast('Connecte-toi pour définir ton pays !', 2500); return; }
  document.querySelectorAll('.country-option').forEach(o => o.classList.toggle('selected', o.dataset.country === country));
  try {
    const r = await apiFetch('/api/profile/country', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({country})});
    const d = await r.json();
    if (!r.ok) { toast('Erreur : ' + (d.error || 'inconnue')); return; }
    S.country = country;
    localStorage.setItem('country', country);
    closeCountryModal();
    toast('Pays mis à jour ! ' + countryFlag(country) + ' ' + countryName(country));
    loadProfile();
    updateHomeUI();
  } catch { toast('Erreur réseau'); }
}

// ── Avatar ──
function openAvatarModal() {
  const prev = document.getElementById('avatar-preview');
  if (prev) {
    if (S.avatar && S.avatar.startsWith('data:image/')) {
      prev.innerHTML = '<img src="'+S.avatar+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      prev.textContent = ((S.pseudo||'?')[0]||'?').toUpperCase();
    }
  }
  document.getElementById('avatar-modal').classList.remove('hidden');
}
function closeAvatarModal(e) { if (!e || e.target.id === 'avatar-modal') document.getElementById('avatar-modal').classList.add('hidden'); }
async function uploadAvatar(event) {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Fichier invalide'); return; }
  if (file.size > 500000) { toast('Image trop grande (max 500kb)'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 150;
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(150/img.width, 150/img.height);
      const w = img.width*ratio, h = img.height*ratio;
      ctx.drawImage(img, (150-w)/2, (150-h)/2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', .8);
      S.avatar = dataUrl; localStorage.setItem('avatar', dataUrl);
      document.getElementById('avatar-modal').classList.add('hidden');
      const el = document.getElementById('prof-av');
      if (el) {
        el.innerHTML = '';
        const img2 = document.createElement('img');
        img2.src = dataUrl;
        img2.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
        el.appendChild(img2);
      }
      await saveAvatar(dataUrl); updateHomeUI(); toast('Photo mise à jour !');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function saveAvatar(av) {
  if (!S.isAuth) return;
  try { await apiFetch('/api/profile/photo', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo:av})}); } catch {}
}

// ── Helpers ──
const catNames={priorites:'🚦 Priorités',panneaux:'🪧 Panneaux',vitesse:'⚡ Vitesses',alcool:'🍺 Alcool',regles:'📋 Règles',securite:'🛡️ Sécurité',vehicule:'🔧 Véhicule',permis:'📄 Permis',situation:'🚗 Situation',international:'🌍 International'};
function catName(c){return catNames[c]||esc(c);}
function modeName(m){return{normal:'🎯 Normal',blitz:'⚡ Blitz',examen_blanc:'📋 Examen',piege:'😈 Piège',micro:'⚡ Micro',training:'🧠 Entraînement',libre:'📚 Libre'}[m]||esc(m);}
const COACH={priorites:['Priorité à droite SAUF panneau 🚦','STOP = arrêt TOTAL 🛑','Cédez ≠ arrêt obligatoire 🔺'],panneaux:['Rouge=interdit, Bleu=obligation, Triangle=danger 🪧','Losange jaune=route prioritaire 💛','Rond bleu+chiffre=vitesse MINIMALE 🔵'],vitesse:['Autoroute: 130 sec, 110 pluie ⚡','Ville=50 km/h par défaut 🏙️','Permis probatoire: 110 max autoroute 🔰'],alcool:['0,5 g/L standard · 0,2 g/L jeune 🍺','Seul le TEMPS élimine alcool ☕'],securite:['Gilet AVANT de sortir 🦺','PAS=Protéger,Alerter,Secourir 🚨'],regles:['Ligne continue=jamais franchir ⚡','Ceinture avant ET arrière 🔒']};
function coachTip(cat){const t=COACH[cat]||['Lis bien la question ! 📖','Prends le temps ⏱️'];return t[Math.floor(Math.random()*t.length)];}

// ── Waiting room ──
function leaveWaiting() {
  socket.emit('leave_waiting');
  S.roomCode = null;
  go('screen-play');
}

// ── Chat ──
function toggleChat() {
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    document.getElementById('chat-badge').classList.add('hidden');
    document.getElementById('chat-input')?.focus();
  }
}
function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat_message', { message: msg });
  input.value = '';
}

// ── Matchmaking queue ──
function avatarHtml(av, size, pseudo) {
  const sz = size || 72;
  const letter = esc(((pseudo||S.pseudo||'?')[0]||'?').toUpperCase());
  if (av && (av.startsWith('data:image/')||av.startsWith('data:image:'))) return '<img src="'+av+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  return '<span style="font-size:'+(sz*.38)+'px;font-weight:900;color:var(--accent2);line-height:1">'+letter+'</span>';
}

function joinQueue() {
  if (!S.pseudo) { promptGuest(); if (!S.pseudo) return; }
  if (!S.isAuth) { toast('Connecte-toi pour jouer en classé ! 🔒', 3000); go('screen-auth'); return; }
  clearInterval(S.queueTimer); clearInterval(S.queueCountdownInterval);
  S.queueSecs = 0;
  go('screen-queue');
  document.getElementById('queue-my-avatar').innerHTML = avatarHtml(S.avatar);
  document.getElementById('queue-my-pseudo').textContent = S.pseudo;
  document.getElementById('queue-my-elo').textContent = S.elo + ' Elo';
  const myFlagEl = document.getElementById('queue-my-flag');
  if (myFlagEl) myFlagEl.textContent = countryFlag(S.country) || '';
  const oppAv = document.getElementById('queue-opp-avatar');
  oppAv.innerHTML = '?'; oppAv.className = 'queue-avatar queue-avatar-unknown';
  document.getElementById('queue-opp-pseudo').textContent = 'Recherche...';
  document.getElementById('queue-opp-elo').textContent = '??? Elo';
  document.getElementById('queue-matched-extra').classList.add('hidden');
  document.getElementById('queue-searching-row').classList.remove('hidden');
  document.getElementById('btn-leave-queue').classList.remove('hidden');
  document.getElementById('queue-wait-time').textContent = '0';
  document.getElementById('queue-position').textContent = 'Connexion...';
  S.queueTimer = setInterval(() => {
    S.queueSecs++;
    document.getElementById('queue-wait-time').textContent = S.queueSecs;
  }, 1000);
  socket.emit('join_queue', { pseudo: S.pseudo, elo: S.elo, avatar: S.avatar, country: S.country });
}

function leaveQueue() {
  clearInterval(S.queueTimer); clearInterval(S.queueCountdownInterval);
  socket.emit('leave_queue');
  go('screen-home');
}

// ── Play screen ──
function showCreateForm(){if(!S.pseudo){promptGuest();return;}document.getElementById('create-form').classList.toggle('hidden');document.getElementById('join-form').classList.add('hidden');}
function showJoinForm(){if(!S.pseudo){promptGuest();return;}document.getElementById('join-form').classList.toggle('hidden');document.getElementById('create-form').classList.add('hidden');}
function selectOpt(type,val,el){el.closest('.option-pills').querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));el.classList.add('active');S.selectedOptions[type]=isNaN(val)||val===''?val:Number(val);}
function selectMode(mode,el){document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('active'));el.classList.add('active');S.selectedOptions.mode=mode;}
function openCreateGame(){if(!S.pseudo){promptGuest();return;}clearErr('play-err');socket.emit('create_game',{pseudo:S.pseudo,avatar:S.avatar,country:S.country,options:{maxPlayers:S.selectedOptions.players,questionCount:S.selectedOptions.questions,timeLimit:S.selectedOptions.time,category:S.selectedOptions.category,mode:S.selectedOptions.mode,country:S.country}});}
function doJoinGame(){const code=document.getElementById('join-code').value.trim().toUpperCase();if(code.length<4)return err('join-err','Code invalide');clearErr('join-err');socket.emit('join_game',{roomCode:code,pseudo:S.pseudo,avatar:S.avatar,country:S.country});}
function copyRoomCode(){navigator.clipboard.writeText(document.getElementById('display-room-code').textContent).then(()=>toast('Code copié ! 📋'));}
function sendReady(){const btn=document.getElementById('btn-ready');btn.disabled=true;btn.textContent='⏳ En attente...';socket.emit('player_ready');}
function forceStart(){socket.emit('force_start');}
function requestRematch(){document.getElementById('btn-rematch').disabled=true;socket.emit('request_rematch');}

// ── Waiting room ──
function renderWaiting(players,maxPlayers){
  const c=document.getElementById('players-waiting');c.innerHTML='';
  for(let i=0;i<maxPlayers;i++){
    const p=players[i];const div=document.createElement('div');
    div.className='waiting-player '+(p?'connected':'empty');
    if(p){const av=p.avatar&&p.avatar.startsWith('data:image/')?'<img src="'+p.avatar+'" class="wp-avatar-img">':'<span style="font-weight:900;color:var(--accent2)">'+esc((p.pseudo[0]||'?').toUpperCase())+'</span>';const flag=countryFlag(p.country);div.innerHTML='<div class="wp-avatar connected">'+av+'</div><div><div class="wp-name">'+esc(p.pseudo)+(flag?' <span class="wp-country">'+flag+'</span>':'')+(p.pseudo===S.pseudo?' <small style="color:var(--accent2)">(toi)</small>':'')+'</div><div class="wp-tag">'+(i===0?'👑 Hôte':'Joueur '+(i+1))+'</div></div><div class="wp-status">'+(p.ready?'✅':'⏳')+'</div>';}
    else{div.innerHTML='<div class="wp-avatar">?</div><div><div class="wp-name" style="color:var(--text3)">En attente...</div><div class="wp-tag">Joueur '+(i+1)+'</div></div><div class="wp-status">⏳</div>';}
    c.appendChild(div);
  }
  const me=players.find(p=>p.pseudo===S.pseudo);
  const btnR=document.getElementById('btn-ready'),btnF=document.getElementById('btn-force-start');
  if(me&&!me.ready){btnR.classList.remove('hidden');btnR.disabled=false;btnR.textContent='✅ Je suis prêt !';}
  else if(me?.ready){btnR.classList.remove('hidden');btnR.disabled=true;btnR.textContent='✅ Prêt !';}
  if(S.isHost&&players.length>=2)btnF.classList.remove('hidden');else btnF.classList.add('hidden');
  const msg=document.getElementById('waiting-msg');
  if(players.length<maxPlayers){msg.innerHTML='<div class="spinner"></div> En attente... ('+players.length+'/'+maxPlayers+')';msg.style.display='flex';}
  else msg.style.display='none';
}

function renderOptsDisplay(opts){document.getElementById('options-display').innerHTML=[opts.maxPlayers+' joueurs',opts.questionCount+' questions',opts.timeLimit+'s',catName(opts.category),modeName(opts.mode)].map(t=>'<span class="options-tag">'+t+'</span>').join('');}

// ── HUD ──
function renderHUD(){
  const c=document.getElementById('hud-scores');c.innerHTML='';
  const max=Math.max(...S.allPlayers.map(p=>p.score),0);
  S.allPlayers.forEach(p=>{
    const isMe=p.pseudo===S.pseudo;
    const avSrc=p.avatar&&p.avatar.startsWith('data:image/');
    const avContent=avSrc?'<img src="'+p.avatar+'" alt="">':'<span>'+esc((p.pseudo[0]||'?').toUpperCase())+'</span>';
    const flag=countryFlag(p.country);
    const d=document.createElement('div');
    const isLeading=p.score===max&&max>0;
    d.className='hud-player-score'+(isMe?' me':'')+(isLeading&&!isMe?' leading':'')+(p.answered&&!isMe?'':'')+' '+((p._lastCorrect===true&&p.answered)?' answered-ok':(p._lastCorrect===false&&p.answered)?' answered-wrong':'');
    d.innerHTML=
      '<div class="hps-avatar">'+avContent+'</div>'+
      '<div class="hps-info">'+
        '<div class="hps-name">'+(flag?flag+' ':'')+esc(p.pseudo)+'</div>'+
        '<div class="hps-score">'+esc(p.score)+(p.answered?'<span style="font-size:.6rem;color:var(--green);margin-left:.2rem">✓</span>':'')+'</div>'+
        (p.streak>=3?'<div class="hps-streak">🔥'+esc(p.streak)+'</div>':'')
      +'</div>';
    c.appendChild(d);
  });
}

// ── Duel question ──
function renderDuelQuestion(data){
  S.currentQ=data;S.selectedAnswers=[];S.answered=false;
  document.getElementById('q-counter').textContent=(data.index+1)+'/'+data.total;
  document.getElementById('q-category').textContent=catName(data.category);
  document.getElementById('q-text').textContent=data.question;
  document.getElementById('mode-badge').textContent=modeName(data.mode||S.gameMode);
  document.getElementById('game-progress').style.width=(data.index/data.total*100)+'%';
  document.getElementById('trap-indicator').classList.toggle('hidden',!data.isTrap);
  const sb=document.getElementById('situation-box');
  if(data.situation){sb.textContent='📍 '+data.situation;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  const iw=document.getElementById('q-image-wrap');
  if(data.image_url){
    iw.innerHTML='';
    const img=document.createElement('img');
    img.alt=''; img.style.cssText='max-width:100%;max-height:220px;object-fit:contain;border-radius:8px';
    img.src=data.image_url;
    iw.appendChild(img); iw.classList.remove('hidden');
  } else{iw.innerHTML='';iw.classList.add('hidden');}
  const cont=document.getElementById('answers-container');cont.innerHTML='';
  data.answers.forEach(a=>{const btn=document.createElement('button');btn.className='answer-btn';btn.dataset.id=a.id;btn.textContent=a.id.toUpperCase()+') '+a.text;if(data.isMultiple){btn.addEventListener('click',()=>{if(S.answered)return;btn.classList.toggle('selected');const idx=S.selectedAnswers.indexOf(a.id);idx>=0?S.selectedAnswers.splice(idx,1):S.selectedAnswers.push(a.id);const cb=document.getElementById('confirm-btn');if(cb)cb.disabled=S.selectedAnswers.length===0;});}else{btn.addEventListener('click',()=>{if(!S.answered)submitDuelAnswer([a.id]);});}cont.appendChild(btn);});
  let cb=document.getElementById('confirm-btn');
  if(data.isMultiple){if(!cb){cb=document.createElement('button');cb.id='confirm-btn';cb.className='btn btn-primary confirm-btn';cb.textContent='Valider ✅';cb.addEventListener('click',()=>{if(S.selectedAnswers.length)submitDuelAnswer(S.selectedAnswers);});}cb.disabled=true;cont.after(cb);}else cb?.remove();
  const fb=document.getElementById('answer-feedback');fb.classList.add('hidden');fb.className='answer-feedback hidden';
  ['fifty50','timeBonus','stress'].forEach(pu=>{const b=document.getElementById('pu-'+pu);if(b)b.disabled=!S.powerups[pu];});
  startTimer(data.timeLimit||30);
  if(Math.random()<.25)showCoach(coachTip(data.category));
}

function submitDuelAnswer(answers){if(S.answered)return;S.answered=true;const timeTaken=(S.currentQ?.timeLimit||30)-S.timerSecs;document.querySelectorAll('.answer-btn').forEach(b=>b.disabled=true);document.getElementById('confirm-btn')?.setAttribute('disabled','true');socket.emit('submit_answer',{answers,timeTaken});const fb=document.getElementById('answer-feedback');fb.className='answer-feedback neutral-fb';fb.innerHTML='<div style="display:flex;align-items:center;gap:.5rem;color:var(--text2)"><div class="spinner"></div> En attente...</div>';fb.classList.remove('hidden');}

function showDuelResult(data){
  stopTimer();if(data.hidden)return;
  document.querySelectorAll('.answer-btn').forEach(btn=>{if(data.correctAnswers?.includes(btn.dataset.id))btn.classList.add('correct');else if(S.selectedAnswers.includes(btn.dataset.id))btn.classList.add('wrong');});
  document.getElementById('screen-game').classList.add(data.isCorrect?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-game').classList.remove('flash-correct','flash-wrong'),600);
  if(data.isCorrect!==null){data.isCorrect?sfx.correct():sfx.wrong();}
  const fb=document.getElementById('answer-feedback');
  let html='';
  if(data.timeout)html='<strong>⏰ Temps écoulé !</strong><br>';
  else if(data.isCorrect)html='<strong>✅ Bonne réponse !</strong>'+(data.streak>=3?' <span class="streak-fire">🔥 '+data.streak+'</span>':'')+'<br>';
  else html='<strong>❌ Mauvaise réponse</strong>'+(data.isTrap&&data.trapMessage?'<br><em>😏 '+esc(data.trapMessage)+'</em>':'')+'<br>';
  if(data.explanation)html+='<span style="color:var(--text2);font-size:.85rem">💡 '+esc(data.explanation)+'</span>';
  fb.className='answer-feedback '+(data.isCorrect?'correct-fb':data.isCorrect===null?'neutral-fb':'wrong-fb');
  fb.innerHTML=html;fb.classList.remove('hidden');
  if(data.isCorrect&&data.streak>=3)showCoach('🔥 '+data.streak+' en série !');
  else if(data.isCorrect===false)showCoach(coachTip(S.currentQ?.category));
}

function startTimer(secs){stopTimer();S.timerSecs=secs;const arc=document.getElementById('timer-arc'),maxD=163.36;function tick(){document.getElementById('timer-text').textContent=S.timerSecs;arc.style.strokeDashoffset=maxD*(1-S.timerSecs/secs);arc.style.stroke=S.timerSecs<=5?'#f87171':S.timerSecs<=10?'#fbbf24':'#4ade80';if(S.timerSecs>0)S.timerSecs--;else stopTimer();}tick();S.timerInterval=setInterval(tick,1000);}
function stopTimer(){clearInterval(S.timerInterval);S.timerInterval=null;}
function showCoach(text){const b=document.getElementById('coach-bubble');document.getElementById('coach-text').textContent=text;b.classList.remove('hidden');clearTimeout(b._t);b._t=setTimeout(()=>b.classList.add('hidden'),4500);}
function usePowerup(type){if(!S.powerups[type]||S.answered)return;S.powerups[type]--;document.getElementById('pu-'+type).disabled=true;socket.emit('use_powerup',{type});}

// ── Duel results ──
function showDuelResults(data){
  stopTimer();S.gamePlaying=false;go('screen-results');
  const banner=document.getElementById('victory-banner');
  if(data.isDraw)banner.textContent='🤝 Match nul !';
  else if(data.winner===S.pseudo){banner.textContent='🏆 VICTOIRE !';sfx.win();}
  else banner.textContent='🎖️ Victoire de '+data.winner+' !';
  document.getElementById('podium').innerHTML=data.results.map(r=>{
    const isMe=r.pseudo===S.pseudo;
    const pData=S.allPlayers.find(p=>p.pseudo===r.pseudo);
    const av=pData?.avatar&&pData.avatar.startsWith('data:image/')?'<img src="'+pData.avatar+'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border)">':'<div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.9rem;color:var(--accent2)">'+esc((r.pseudo[0]||'?').toUpperCase())+'</div>';
    const flag=countryFlag(pData?.country);
    const elo=r.eloChange?'<div style="font-size:.82rem;font-weight:700;color:'+(r.eloChange>0?'var(--green)':'var(--red)')+';">'+(r.eloChange>0?'+':'')+esc(r.eloChange)+' Elo</div>':'';
    return '<div class="podium-item rank-'+r.rank+(isMe?' me':'')+'" ><div class="podium-rank">'+(['🥇','🥈','🥉'][r.rank-1]||r.rank+'.')+'</div>'+av+'<div class="podium-pseudo">'+esc(r.pseudo)+(flag?' '+flag:'')+(isMe?'<span class="podium-you">toi</span>':'')+'</div><div><div class="podium-score">'+esc(r.score)+'<span style="font-size:.75rem;color:var(--text3)">\/'+esc(r.total)+'</span></div><div class="podium-pct">'+esc(r.percentage)+'%</div></div>'+elo+'</div>';
  }).join('');
  const myR=data.results.find(r=>r.pseudo===S.pseudo);
  if(myR?.eloChange){
    S.elo+=myR.eloChange;
    localStorage.setItem('elo',String(S.elo));
    setTimeout(()=>floatElo(myR.eloChange, document.getElementById('victory-banner')),600);
  }
  const an=document.getElementById('results-analysis');an.innerHTML='';
  if(myR&&Object.keys(myR.categoryErrors||{}).length){an.innerHTML='<div class="analysis-title">📊 Tes erreurs</div>'+Object.entries(myR.categoryErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>'<div class="category-error"><span>'+catName(cat)+'</span><span style="color:var(--red)">'+n+' erreur'+(n>1?'s':'')+'</span></div>').join('');}
  if(data.replayData?.length){S.replayData=data.replayData;document.getElementById('replay-toggle').classList.remove('hidden');}
  const chatHistEl=document.getElementById('chat-history');
  const chatHistMsg=document.getElementById('chat-history-messages');
  if(data.chatHistory?.length){
    chatHistMsg.innerHTML=data.chatHistory.map(m=>{const isMe=m.pseudo===S.pseudo;return '<div class="chat-msg '+(isMe?'me':'other')+'">'+(isMe?'':' <span class="chat-sender">'+esc(m.pseudo)+'</span>')+'<span class="chat-text">'+esc(m.message)+'</span></div>';}).join('');
    chatHistEl.classList.remove('hidden');
  } else {
    chatHistEl.classList.add('hidden');
  }
  const examEl=document.getElementById('exam-results-duel');
  if(data.examPassed?.length){examEl.innerHTML=data.examPassed.map(p=>'<div class="exam-verdict '+(p.passed?'admis':'recale')+'">'+esc(p.pseudo)+' : '+(p.passed?'✅ ADMIS':'❌ RECALÉ')+'</div>').join('');examEl.classList.remove('hidden');}
  const btnR=document.getElementById('btn-rematch');
  if(S.pseudo===data.hostPseudo)btnR.classList.remove('hidden');else btnR.classList.add('hidden');
}

function toggleReplay(){const rc=document.getElementById('replay-content');rc.classList.toggle('hidden');if(!rc.classList.contains('hidden')&&S.replayData){rc.innerHTML=S.replayData.slice(0,10).map((q,i)=>'<div class="replay-item '+(q.playerAnswers.every(p=>p.isCorrect)?'correct-q':'wrong-q')+'"><div class="replay-q">'+(i+1)+'. '+esc(q.question)+'</div>'+q.playerAnswers.map(p=>'<div class="replay-player"><span>'+esc(p.pseudo)+'</span><span>'+(p.isCorrect?'✅':'❌')+' '+esc(p.timeTaken?.toFixed(0)||'?')+'s</span></div>').join('')+'</div>').join('');}}

// ── Solo mode ──
function showSoloScreen(){go('screen-solo');document.getElementById('solo-category-picker').classList.add('hidden');}
function selectSoloCat(cat,el){document.querySelectorAll('#solo-category-picker .pill').forEach(p=>p.classList.remove('active'));el.classList.add('active');S.soloCategory=cat;}

async function startSolo(mode){
  if(!S.pseudo){promptGuest();if(!S.pseudo)return;}
  S.soloMode=mode;S.soloAnswers=[];S.soloIdx=0;S.soloCorrect=0;S.soloWrong=0;S.soloStreak=0;S.soloMaxStreak=0;
  document.getElementById('solo-category-picker').classList.add('hidden');
  let questions=[];
  const count=mode==='micro'?5:mode==='examen_blanc'?40:10;
  try{
    const res=await apiFetch('/api/training/session?count='+count+'&mode='+mode+'&category='+S.soloCategory);
    const d=await res.json();questions=d.fullQuestions||[];
    if(d.weakCategories?.length&&mode==='training')toast('Session ciblée : '+d.weakCategories.map(c=>catName(c)).join(', '),3000);
  }catch(e){console.error(e);}
  if(!questions.length){toast('Impossible de charger les questions, réessaie !');return;}
  S.soloQs=questions;
  document.getElementById('solo-mode-badge').textContent=modeName(mode);
  go('screen-solo-game');renderSoloQ();
}

function renderSoloQ(){
  const q=S.soloQs[S.soloIdx];if(!q){endSolo();return;}
  const total=S.soloQs.length,tl=S.soloMode==='micro'?15:30;
  document.getElementById('sq-counter').textContent=(S.soloIdx+1)+'/'+total;
  document.getElementById('sq-category').textContent=catName(q.category);
  document.getElementById('sq-text').textContent=q.question;
  document.getElementById('solo-progress').style.width=(S.soloIdx/total*100)+'%';
  document.getElementById('sq-correct').textContent='✅ '+S.soloCorrect;
  document.getElementById('sq-wrong').textContent='❌ '+S.soloWrong;
  document.getElementById('sq-streak').textContent=S.soloStreak>=3?'🔥'+S.soloStreak:'';
  document.getElementById('sq-trap-indicator').classList.toggle('hidden',!q.is_trap);
  const sb=document.getElementById('sq-situation-box');
  if(q.situation){sb.textContent='📍 '+q.situation;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  const iw=document.getElementById('sq-image-wrap');
  if(q.image_url){
    iw.innerHTML='';
    const img=document.createElement('img');
    img.alt=''; img.style.cssText='max-width:100%;max-height:220px;object-fit:contain;border-radius:8px';
    img.src=q.image_url;
    iw.appendChild(img); iw.classList.remove('hidden');
  }else{iw.innerHTML='';iw.classList.add('hidden');}
  const cont=document.getElementById('sq-answers');cont.innerHTML='';
  q.answers.forEach(a=>{const btn=document.createElement('button');btn.className='answer-btn';btn.dataset.id=a.id;btn.textContent=a.id.toUpperCase()+') '+a.text;if(q.correct.length>1){btn.addEventListener('click',()=>btn.classList.toggle('selected'));}else{btn.addEventListener('click',()=>submitSoloAnswer([a.id]));}cont.appendChild(btn);});
  let cb=document.getElementById('solo-confirm-btn');
  if(q.correct.length>1){if(!cb){cb=document.createElement('button');cb.id='solo-confirm-btn';cb.className='btn btn-primary confirm-btn';cb.textContent='Valider ✅';cb.addEventListener('click',()=>{const sel=[...cont.querySelectorAll('.answer-btn.selected')].map(b=>b.dataset.id);if(sel.length)submitSoloAnswer(sel);});}cont.after(cb);}else cb?.remove();
  document.getElementById('sq-feedback').classList.add('hidden');document.getElementById('sq-coach').classList.add('hidden');
  startSoloTimer(tl);
}

function submitSoloAnswer(answers){
  clearInterval(S.soloTimer);const q=S.soloQs[S.soloIdx];
  const ok=[...answers].sort().join(',')===[ ...q.correct].sort().join(',');
  S.soloAnswers.push({questionIndex:S.soloIdx,answers,isCorrect:ok,timeTaken:(S.soloMode==='micro'?15:30)-S.soloSecs});
  document.querySelectorAll('#sq-answers .answer-btn').forEach(b=>{b.disabled=true;if(q.correct.includes(b.dataset.id))b.classList.add('correct');else if(answers.includes(b.dataset.id))b.classList.add('wrong');});
  document.getElementById('solo-confirm-btn')?.setAttribute('disabled','true');
  if(ok){S.soloCorrect++;S.soloStreak++;S.soloMaxStreak=Math.max(S.soloMaxStreak,S.soloStreak);sfx.correct();}else{S.soloWrong++;S.soloStreak=0;sfx.wrong();}
  const fb=document.getElementById('sq-feedback');
  let html='';
  if(ok)html='<strong>✅ Bonne réponse !</strong>'+(S.soloStreak>=3?' <span class="streak-fire">🔥 '+S.soloStreak+'</span>':'')+'<br>';
  else html='<strong>❌ Mauvaise réponse</strong>'+(q.is_trap&&q.trap_message?'<br><em>😏 '+esc(q.trap_message)+'</em>':'')+'<br>';
  if(q.explanation&&S.soloMode!=='blitz')html+='<span style="color:var(--text2);font-size:.85rem">💡 '+esc(q.explanation)+'</span>';
  if(q.is_trap)html+='<br><span style="color:var(--yellow);font-size:.78rem">📊 '+Math.floor(Math.random()*40+40)+'% se trompent ici</span>';
  fb.className='answer-feedback '+(ok?'correct-fb':'wrong-fb');fb.innerHTML=html;fb.classList.remove('hidden');
  if(!ok){const c=document.getElementById('sq-coach');c.textContent=coachTip(q.category);c.classList.remove('hidden');}
  document.getElementById('sq-correct').textContent='✅ '+S.soloCorrect;
  document.getElementById('sq-wrong').textContent='❌ '+S.soloWrong;
  document.getElementById('sq-streak').textContent=S.soloStreak>=3?'🔥'+S.soloStreak:'';
  document.getElementById('screen-solo-game').classList.add(ok?'flash-correct':'flash-wrong');
  setTimeout(()=>document.getElementById('screen-solo-game').classList.remove('flash-correct','flash-wrong'),600);
  setTimeout(()=>{S.soloIdx++;renderSoloQ();},S.soloMode==='micro'?1200:S.soloMode==='blitz'?1000:3000);
}

function startSoloTimer(secs){clearInterval(S.soloTimer);S.soloSecs=secs;const arc=document.getElementById('solo-timer-arc'),maxD=163.36;function tick(){document.getElementById('solo-timer-text').textContent=S.soloSecs;arc.style.strokeDashoffset=maxD*(1-S.soloSecs/secs);arc.style.stroke=S.soloSecs<=5?'#f87171':S.soloSecs<=10?'#fbbf24':'#4ade80';if(S.soloSecs>0)S.soloSecs--;else{clearInterval(S.soloTimer);soloTimeout();}}tick();S.soloTimer=setInterval(tick,1000);}

function soloTimeout(){const q=S.soloQs[S.soloIdx];S.soloAnswers.push({questionIndex:S.soloIdx,answers:[],isCorrect:false,timeTaken:30,timeout:true});S.soloWrong++;S.soloStreak=0;sfx.wrong();document.querySelectorAll('#sq-answers .answer-btn').forEach(b=>{b.disabled=true;if(q.correct.includes(b.dataset.id))b.classList.add('correct');});const fb=document.getElementById('sq-feedback');fb.className='answer-feedback wrong-fb';fb.innerHTML='<strong>⏰ Temps écoulé !</strong>'+(q.explanation?'<br><span style="color:var(--text2);font-size:.85rem">💡 '+esc(q.explanation)+'</span>':'');fb.classList.remove('hidden');document.getElementById('sq-correct').textContent='✅ '+S.soloCorrect;document.getElementById('sq-wrong').textContent='❌ '+S.soloWrong;document.getElementById('sq-streak').textContent='';setTimeout(()=>{S.soloIdx++;renderSoloQ();},2000);}

async function endSolo(){
  clearInterval(S.soloTimer);
  const total=S.soloQs.length,pct=Math.round(S.soloCorrect/total*100);
  go('screen-solo-results');
  document.getElementById('solo-result-banner').textContent=pct>=90?'🌟 Excellent !':pct>=70?'👍 Bien joué !':pct>=50?'📚 À retravailler...':'💪 Continue !';
  if(pct===100)sfx.win();
  document.getElementById('solo-score-display').innerHTML='<div class="big-num">'+S.soloCorrect+'/'+total+'</div><div class="big-label">'+pct+'% · streak max 🔥'+S.soloMaxStreak+'</div>';
  const vd=document.getElementById('exam-verdict');
  if(S.soloMode==='examen_blanc'){vd.className='exam-verdict '+(pct>=87?'admis':'recale');vd.textContent=pct>=87?'✅ ADMIS — '+pct+'% (seuil 87%)':'❌ RECALÉ — '+pct+'% (seuil 87%)';vd.classList.remove('hidden');}else vd.classList.add('hidden');
  const catErrors={};S.soloAnswers.filter(a=>!a.isCorrect).forEach(a=>{const cat=S.soloQs[a.questionIndex]?.category;if(cat)catErrors[cat]=(catErrors[cat]||0)+1;});
  const catEl=document.getElementById('solo-category-breakdown');
  catEl.innerHTML=Object.keys(catErrors).length?'<div class="analysis-title">📊 Erreurs par thème</div>'+Object.entries(catErrors).sort((a,b)=>b[1]-a[1]).map(([cat,n])=>'<div class="category-error"><span>'+catName(cat)+'</span><span style="color:var(--red)">'+n+' erreur'+(n>1?'s':'')+'</span></div>').join(''):'<div style="text-align:center;color:var(--green);padding:.75rem">🌟 Aucune erreur !</div>';
  const weakCat=Object.keys(catErrors)[0];
  const advEl=document.getElementById('solo-coach-advice');
  if(weakCat&&COACH[weakCat]){advEl.innerHTML='<div class="coach-advice-title">🧑‍🏫 Conseils sur '+catName(weakCat)+'</div>'+COACH[weakCat].map(t=>'<div class="coach-advice-tip">'+esc(t)+'</div>').join('');}else advEl.style.display='none';
  const wrongs=S.soloAnswers.filter(a=>!a.isCorrect).slice(0,5);
  const replayEl=document.getElementById('solo-replay');
  if(wrongs.length){replayEl.innerHTML='<div class="analysis-title">📹 Questions manquées</div>'+wrongs.map(a=>{const q=S.soloQs[a.questionIndex];return '<div class="replay-item wrong-q"><div class="replay-q">'+esc(q.question)+'</div><div style="color:var(--green);font-size:.8rem">✅ '+esc(q.correct.join(', '))+' — '+esc((q.explanation||'').slice(0,80))+'...</div></div>';}).join('');}else replayEl.innerHTML='';
  if(S.isAuth){try{await apiFetch('/api/training/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:S.soloAnswers.map(a=>a.answers),questions:S.soloQs,mode:S.soloMode})});}catch{}}
}

// ── Leaderboard ──
async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  el.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const res = await Promise.race([
      apiFetch('/api/leaderboard'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
    ]);
    if (!res.ok) throw new Error('Erreur ' + res.status);
    const data = await res.json();
    if (!data || !data.length) {
      el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text2)">Aucun joueur pour le moment 🤷<br><small style="color:var(--text3)">Crée un compte pour apparaître ici !</small></div>';
      return;
    }
    el.innerHTML = '';
    data.forEach((p, i) => {
      const re = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      const flag = countryFlag(p.country);
      const avInner = (p.avatar && p.avatar.startsWith('data:image/'))
        ? '<img src="'+p.avatar+'" alt="">'
        : '<span style="font-weight:900;color:var(--accent2);font-size:.9rem">'+ esc((p.pseudo[0]||'?').toUpperCase()) +'</span>';
      const isMe = p.pseudo === S.pseudo;
      const winRate = p.total_games > 0 ? Math.round((p.wins||0)/p.total_games*100) : 0;
      const div = document.createElement('div');
      div.className = 'lb-item' + (isMe ? ' me-lb' : '');
      div.innerHTML =
        '<div style="font-size:1.2rem;font-weight:700;width:2rem;text-align:center;flex-shrink:0">'+re+'</div>'+
        '<div class="lb-avatar">'+avInner+'</div>'+
        '<div class="lb-info">'+
          '<div class="lb-name-row"><span class="lb-pseudo">'+esc(p.pseudo)+'</span>'+(flag?'<span class="lb-flag">'+flag+'</span>':'')+(isMe?'<span style="font-size:.6rem;background:var(--accent);color:#fff;padding:.1rem .35rem;border-radius:5px">toi</span>':'')+'</div>'+
          '<div class="lb-sublabel">'+esc(p.levelInfo?.name||'')+'</div>'+
        '</div>'+
        '<div class="lb-right">'+
          '<div class="lb-elo-val">'+esc(p.elo)+'</div>'+
          '<div class="lb-record">'+esc(p.wins||0)+'V · '+esc(p.losses||0)+'D</div>'+
        '</div>';
      const catStats = p.category_stats || {};
      const catNamesMap = {priorites:'Priorités',panneaux:'Panneaux',vitesse:'Vitesses',alcool:'Alcool',regles:'Règles',securite:'Sécurité'};
      const bestCat = Object.entries(catStats).filter(([,s])=>s.sessions>0).sort((a,b)=>(a[1].errors/a[1].sessions)-(b[1].errors/b[1].sessions))[0];
      div.addEventListener('mouseenter', e => showPlayerTooltip(e, { pseudo:p.pseudo, elo:p.elo, winRate, wins:p.wins||0, losses:p.losses||0, total_games:p.total_games||0, bestCat: bestCat ? catNamesMap[bestCat[0]]||bestCat[0] : null, flag }));
      div.addEventListener('mouseleave', hidePlayerTooltip);
      div.addEventListener('mousemove', movePlayerTooltip);
      el.appendChild(div);
    });
    setupTooltip();
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem"><p style="color:var(--red);margin-bottom:1rem">'+(e.message==='timeout'?'Délai dépassé':'Erreur de connexion')+'</p><button class="btn btn-ghost" onclick="loadLeaderboard()">Réessayer</button></div>';
  }
}

// ── Tooltip ──
let _tooltipEl = null;
function setupTooltip() { _tooltipEl = document.getElementById('player-tooltip'); }
function showPlayerTooltip(e, data) {
  if (!_tooltipEl) _tooltipEl = document.getElementById('player-tooltip');
  if (!_tooltipEl) return;
  const wr = data.winRate;
  const wrColor = wr >= 60 ? 'good' : wr >= 40 ? 'mid' : 'bad';
  _tooltipEl.innerHTML =
    '<div style="font-weight:700;margin-bottom:.5rem">'+(data.flag||'')+' '+esc(data.pseudo)+'</div>'+
    '<div class="tooltip-row"><span class="tooltip-label">Elo</span><span class="tooltip-val">'+esc(data.elo)+'</span></div>'+
    '<div class="tooltip-row"><span class="tooltip-label">Win rate</span><span class="tooltip-val '+wrColor+'">'+wr+'%</span></div>'+
    '<div class="tooltip-row"><span class="tooltip-label">Parties</span><span class="tooltip-val">'+esc(data.total_games)+'</span></div>'+
    (data.bestCat ? '<div class="tooltip-row"><span class="tooltip-label">Meilleur thème</span><span class="tooltip-val good">'+esc(data.bestCat)+'</span></div>' : '')+
    '<div class="tooltip-row"><span class="tooltip-label">Record</span><span class="tooltip-val">'+esc(data.wins)+'V / '+esc(data.losses)+'D</span></div>';
  _tooltipEl.classList.remove('hidden');
  moveTooltip(e);
}
function movePlayerTooltip(e) { moveTooltip(e); }
function moveTooltip(e) {
  if (!_tooltipEl || _tooltipEl.classList.contains('hidden')) return;
  let x = e.clientX + 14, y = e.clientY - 10;
  const w = _tooltipEl.offsetWidth || 180;
  if (x + w > window.innerWidth - 10) x = e.clientX - w - 10;
  _tooltipEl.style.left = x + 'px';
  _tooltipEl.style.top = y + 'px';
}
function hidePlayerTooltip() { _tooltipEl?.classList.add('hidden'); }

// ── Session time ──
let _ss = Date.now();
setInterval(async()=>{if(!S.isAuth)return;const s=Math.round((Date.now()-_ss)/1000);_ss=Date.now();if(s<5)return;try{await apiFetch('/api/profile/session-time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:s})});}catch{}},30000);

// ── Socket events ──
socket.on('game_created',({roomCode,options,isHost})=>{S.roomCode=roomCode;S.isHost=isHost;S.gameOptions=options;go('screen-waiting');document.getElementById('display-room-code').textContent=roomCode;renderOptsDisplay(options);renderWaiting([{pseudo:S.pseudo,ready:false,avatar:S.avatar}],options.maxPlayers);});
socket.on('game_joined',({roomCode,players,options,isHost})=>{S.roomCode=roomCode;S.isHost=isHost;S.gameOptions=options;go('screen-waiting');document.getElementById('display-room-code').textContent=roomCode;renderOptsDisplay(options);renderWaiting(players,options.maxPlayers);});
socket.on('player_list_update',({players,maxPlayers})=>renderWaiting(players,maxPlayers));
socket.on('game_start',({players,options})=>{sfx.start();S.gameMode=options.mode;S.gameOptions=options;S.allPlayers=players.map(p=>({...p,score:0,streak:0,answered:false,_lastCorrect:undefined}));S.powerups={fifty50:1,timeBonus:1,stress:1};S.gamePlaying=true;go('screen-game');renderHUD();});
socket.on('new_question',data=>{
  S.allPlayers.forEach(p=>{p.answered=false;p._lastCorrect=undefined;});
  document.getElementById('answers-revealed-panel')?.remove();
  renderDuelQuestion(data);
});
socket.on('scores_update',({players})=>{
  S.allPlayers=players.map(p=>({...p,_lastCorrect:S.allPlayers.find(x=>x.pseudo===p.pseudo)?._lastCorrect}));
  renderHUD();
});
socket.on('answer_result',data=>{const me=S.allPlayers.find(p=>p.pseudo===S.pseudo);if(me){me.score=data.score;me.streak=data.streak;me.answered=true;me._lastCorrect=data.isCorrect;}showDuelResult(data);renderHUD();});
socket.on('answers_revealed',({correctAnswers, playerAnswers})=>{
  const existing = document.getElementById('answers-revealed-panel');
  if (existing) existing.remove();
  const fb = document.getElementById('answer-feedback');
  if (!fb) return;
  const panel = document.createElement('div');
  panel.id = 'answers-revealed-panel';
  panel.className = 'answers-revealed';
  const qData = S.currentQ;
  panel.innerHTML = '<div class="ar-title">📊 Réponses de tout le monde</div>' +
    playerAnswers.map(p => {
      const avSrc = p.avatar && p.avatar.startsWith('data:image/');
      const avContent = avSrc ? '<img src="'+p.avatar+'" alt="">' : '<span>'+esc((p.pseudo[0]||'?').toUpperCase())+'</span>';
      const flag = countryFlag(p.country);
      const answerTexts = (p.answers || []).map(id => {
        const ans = qData?.answers?.find(a => a.id === id);
        return ans ? id.toUpperCase()+') '+ans.text : id.toUpperCase();
      });
      const isNone = !p.answers || p.answers.length === 0;
      const cls = isNone ? 'none' : (p.isCorrect ? 'correct' : 'wrong');
      const label = isNone ? '⏰ Pas répondu' : (p.isCorrect ? '✅ ' : '❌ ') + answerTexts.join(', ');
      return '<div class="ar-player"><div class="ar-avatar">'+avContent+'</div><div class="ar-pseudo">'+(flag?flag+' ':'')+esc(p.pseudo)+'</div><div class="ar-answer '+cls+'">'+esc(label)+'</div></div>';
    }).join('');
  fb.after(panel);
  S.allPlayers = S.allPlayers.map(p => {
    const found = playerAnswers.find(x => x.pseudo === p.pseudo);
    return found ? {...p, _lastCorrect: found.isCorrect} : p;
  });
  renderHUD();
});

socket.on('powerup_result',({type,removed,bonusSeconds})=>{if(type==='fifty50'&&removed){removed.forEach(id=>document.querySelector('.answer-btn[data-id="'+id+'"]')?.classList.add('removed'));toast('⚡ 50/50 !');}else if(type==='timeBonus'&&bonusSeconds){S.timerSecs+=bonusSeconds;toast('⏱️ +'+bonusSeconds+'s !');}else if(type==='stress')toast('😱 Stress envoyé !');});
socket.on('powerup_applied',({type,penaltySeconds,from})=>{if(type==='stress'){S.timerSecs=Math.max(3,S.timerSecs-penaltySeconds);toast('😱 '+esc(from)+' t\'a stressé ! -'+penaltySeconds+'s',3000);}});
socket.on('game_end',data=>{
  const myR=data.results?.find(r=>r.pseudo===S.pseudo);
  if(myR?.forfeited){
    if(myR.eloChange){S.elo+=myR.eloChange;localStorage.setItem('elo',String(S.elo));}
    S.gamePlaying=false; S.roomCode=null;
    return;
  }
  showDuelResults(data);
});
socket.on('player_disconnected',({pseudo})=>toast('💔 '+esc(pseudo)+' a quitté...',3000));
socket.on('rematch_started',({roomCode,options,players})=>{S.roomCode=roomCode;S.isHost=players[0]?.pseudo===S.pseudo;S.gameOptions=options;go('screen-waiting');document.getElementById('display-room-code').textContent=roomCode;renderOptsDisplay(options);renderWaiting(players,options.maxPlayers);toast('🔄 Revanche ! Cliquez sur Prêt !');});
socket.on('queue_joined',({position,total,eloRange})=>{
  document.getElementById('queue-position').textContent='#'+position+(total>1?' / '+total+' joueurs':' — seul dans la file');
  document.getElementById('queue-elo-range').textContent='Fourchette Elo : ±'+eloRange;
});
socket.on('queue_update',({position,total,eloRange})=>{
  document.getElementById('queue-position').textContent='#'+position+' / '+total+' joueur'+(total>1?'s':'');
  document.getElementById('queue-elo-range').textContent='Fourchette Elo : ±'+eloRange;
});
socket.on('queue_matched',({roomCode,isHost,opponent,totalQuestions})=>{
  clearInterval(S.queueTimer);
  S.roomCode=roomCode; S.isHost=isHost;
  S.gameOptions={maxPlayers:2,questionCount:totalQuestions,timeLimit:30,category:'all',mode:'normal'};
  S.gameMode='normal';
  const oppAv=document.getElementById('queue-opp-avatar');
  oppAv.innerHTML=avatarHtml(opponent.avatar);
  oppAv.className='queue-avatar queue-avatar-found';
  document.getElementById('queue-opp-pseudo').textContent=opponent.pseudo;
  document.getElementById('queue-opp-pseudo').style.color='';
  document.getElementById('queue-opp-elo').textContent=opponent.elo+' Elo';
  document.getElementById('queue-opp-elo').style.color='';
  const oppFlagEl=document.getElementById('queue-opp-flag');
  if(oppFlagEl) oppFlagEl.textContent=countryFlag(opponent.country)||'';
  document.getElementById('queue-searching-row').classList.add('hidden');
  document.getElementById('queue-elo-range').classList.add('hidden');
  document.getElementById('btn-leave-queue').classList.add('hidden');
  document.getElementById('queue-matched-extra').classList.remove('hidden');
  const diff=opponent.elo-S.elo;
  const diffEl=document.getElementById('queue-elo-diff');
  if(diff>50)diffEl.textContent='⚠️ Adversaire plus fort (+'+diff+' Elo) — bonne chance 💪';
  else if(diff<-50)diffEl.textContent='🎯 Tu es le favori ('+diff+' Elo) — reste concentré !';
  else diffEl.textContent='⚖️ Niveau équilibré — que le meilleur gagne !';
  const eloWin = Math.round(32*(1-1/(1+Math.pow(10,(opponent.elo-S.elo)/400))));
  const predEl = document.getElementById('queue-elo-prediction');
  if(predEl) predEl.innerHTML='<div class="elo-pred-item"><span class="elo-pred-label">Victoire</span><span class="elo-pred-val pos">+'+eloWin+' Elo</span></div><div class="elo-pred-item"><span class="elo-pred-label">Défaite</span><span class="elo-pred-val neg">-'+eloWin+' Elo</span></div><div class="elo-pred-item"><span class="elo-pred-label">Adversaire</span><span class="elo-pred-val">'+opponent.elo+' Elo</span></div>';
  sfx.start();
  let count=3;
  document.getElementById('queue-countdown').textContent=count;
  S.queueCountdownInterval=setInterval(()=>{
    count--;
    if(count>0)document.getElementById('queue-countdown').textContent=count;
    else clearInterval(S.queueCountdownInterval);
  },1000);
});
socket.on('queue_left',()=>{clearInterval(S.queueTimer);clearInterval(S.queueCountdownInterval);document.getElementById('queue-elo-range').classList.remove('hidden');});
socket.on('chat_message',({pseudo,message})=>{
  const messages=document.getElementById('chat-messages');
  if(!messages)return;
  const panel=document.getElementById('chat-panel');
  const isMe=pseudo===S.pseudo;
  const div=document.createElement('div');
  div.className='chat-msg '+(isMe?'me':'other');
  div.innerHTML=(!isMe?'<span class="chat-sender">'+esc(pseudo)+'</span>':'')+'<span class="chat-text">'+esc(message)+'</span>';
  messages.appendChild(div);
  messages.scrollTop=messages.scrollHeight;
  if(panel?.classList.contains('hidden')&&!isMe){
    const badge=document.getElementById('chat-badge');
    if(badge){badge.classList.remove('hidden');badge.textContent=parseInt(badge.textContent||'0')+1;}
  }
});
socket.on('error',msg=>{err('play-err',msg);err('join-err',msg);toast('❌ '+msg,3000);});

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Restauration session cookie
  apiFetch('/api/profile')
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d) {
        S.isAuth=true; S.pseudo=d.pseudo; S.elo=d.elo;
        if (d.avatar) S.avatar=d.avatar;
        if (d.country !== undefined) { S.country=d.country; if(d.country) localStorage.setItem('country',d.country); else localStorage.removeItem('country'); }
        localStorage.setItem('pseudo', d.pseudo);
        localStorage.setItem('elo', String(d.elo));
        if (d.avatar) localStorage.setItem('avatar', d.avatar);
        updateHomeUI();
      }
    }).catch(() => {});

  // ── Navigation ──
  document.getElementById('auth-back').addEventListener('click', () => go('screen-home'));
  document.getElementById('solo-back').addEventListener('click', () => go('screen-home'));
  document.getElementById('play-back').addEventListener('click', () => go('screen-home'));
  document.getElementById('waiting-back').addEventListener('click', leaveWaiting);
  document.getElementById('profile-back').addEventListener('click', () => go('screen-home'));
  document.getElementById('lb-back').addEventListener('click', () => go('screen-home'));
  document.getElementById('btn-duel').addEventListener('click', () => go('screen-play'));
  document.getElementById('btn-solo-mode').addEventListener('click', showSoloScreen);
  document.getElementById('home-auth-btn').addEventListener('click', () => { if (S.isAuth) doLogout(); else go('screen-auth'); });
  document.getElementById('guest-link').addEventListener('click', promptGuest);
  document.getElementById('btn-leaderboard-nav').addEventListener('click', () => go('screen-leaderboard'));
  document.getElementById('btn-profile-nav').addEventListener('click', openProfile);

  // ── Auth ──
  document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-register').addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('btn-do-login').addEventListener('click', doLogin);
  document.getElementById('btn-do-register').addEventListener('click', doRegister);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('reg-password').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

  // ── Solo ──
  document.getElementById('btn-solo-libre-toggle').addEventListener('click', () => {
    document.getElementById('solo-category-picker').classList.toggle('hidden');
  });
  document.getElementById('btn-start-libre').addEventListener('click', () => startSolo('libre'));
  document.getElementById('btn-replay-solo').addEventListener('click', () => startSolo(S.soloMode));
  document.getElementById('btn-other-mode').addEventListener('click', showSoloScreen);
  document.getElementById('btn-solo-results-home').addEventListener('click', () => go('screen-home'));
  document.querySelectorAll('[data-solo-mode]').forEach(card => {
    card.addEventListener('click', () => startSolo(card.dataset.soloMode));
  });
  document.querySelectorAll('[data-cat]').forEach(pill => {
    pill.addEventListener('click', () => selectSoloCat(pill.dataset.cat, pill));
  });

  // ── Play / Create / Join ──
  document.getElementById('btn-ranked-queue').addEventListener('click', joinQueue);
  document.getElementById('btn-show-create').addEventListener('click', showCreateForm);
  document.getElementById('btn-show-join').addEventListener('click', showJoinForm);
  document.getElementById('btn-open-create').addEventListener('click', openCreateGame);
  document.getElementById('btn-do-join').addEventListener('click', doJoinGame);
  document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoinGame(); });
  document.getElementById('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  document.querySelectorAll('[data-opt-type]').forEach(pill => {
    pill.addEventListener('click', () => selectOpt(pill.dataset.optType, pill.dataset.optVal, pill));
  });
  document.querySelectorAll('[data-mode]').forEach(card => {
    card.addEventListener('click', () => selectMode(card.dataset.mode, card));
  });

  // ── Waiting room ──
  document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);
  document.getElementById('btn-ready').addEventListener('click', sendReady);
  document.getElementById('btn-force-start').addEventListener('click', forceStart);

  // ── In-game ──
  document.getElementById('solo-game-back').addEventListener('click', () => { if (confirm('Quitter la session ?')) go('screen-home'); });
  document.getElementById('game-back').addEventListener('click', () => { if (confirm('Quitter la partie ?')) go('screen-home'); });
  document.getElementById('pu-fifty50').addEventListener('click', () => usePowerup('fifty50'));
  document.getElementById('pu-timeBonus').addEventListener('click', () => usePowerup('timeBonus'));
  document.getElementById('pu-stress').addEventListener('click', () => usePowerup('stress'));
  document.getElementById('chat-toggle-btn').addEventListener('click', toggleChat);
  document.getElementById('btn-send-chat').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // ── Duel results ──
  document.getElementById('btn-toggle-replay').addEventListener('click', toggleReplay);
  document.getElementById('btn-rematch').addEventListener('click', requestRematch);
  document.getElementById('btn-new-game').addEventListener('click', () => go('screen-play'));
  document.getElementById('btn-duel-results-home').addEventListener('click', () => go('screen-home'));

  // ── Queue ──
  document.getElementById('btn-leave-queue').addEventListener('click', leaveQueue);

  // ── Avatar modal ──
  document.getElementById('avatar-modal').addEventListener('click', closeAvatarModal);
  document.getElementById('avatar-upload').addEventListener('change', uploadAvatar);
  document.getElementById('btn-close-avatar-modal').addEventListener('click', () => document.getElementById('avatar-modal').classList.add('hidden'));

  // ── Country modal ──
  document.getElementById('country-modal').addEventListener('click', e => { if(e.target.id==='country-modal') closeCountryModal(); });
  document.getElementById('btn-close-country-modal').addEventListener('click', closeCountryModal);
  document.querySelectorAll('.country-option').forEach(opt => {
    opt.addEventListener('click', () => selectCountry(opt.dataset.country));
  });

  // ── Pseudo modal ──
  document.getElementById('pseudo-modal').addEventListener('click', e => { if (e.target.id === 'pseudo-modal') closePseudoModal(); });
  document.getElementById('btn-save-pseudo').addEventListener('click', savePseudo);
  document.getElementById('btn-cancel-pseudo').addEventListener('click', closePseudoModal);
  document.getElementById('new-pseudo-input').addEventListener('keydown', e => { if (e.key === 'Enter') savePseudo(); });
});
