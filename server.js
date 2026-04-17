const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const db = require('./db');
const allQuestions = require('./data/questions.json');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'codeRoute_secret_2024_change_me';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeGames = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function pickQuestions(options) {
  let pool = [...allQuestions];
  if (options.mode === 'piege') pool = pool.filter(q => q.is_trap);
  else if (options.mode === 'micro') pool = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  else if (options.category && options.category !== 'all') {
    const filtered = pool.filter(q => q.category === options.category);
    if (filtered.length >= 5) pool = filtered;
  }
  if (options.weakCategories?.length) {
    // Prioritize weak categories
    const weak = pool.filter(q => options.weakCategories.includes(q.category));
    const other = pool.filter(q => !options.weakCategories.includes(q.category));
    pool = [...weak.sort(() => Math.random() - 0.5), ...other.sort(() => Math.random() - 0.5)];
  } else {
    pool = pool.sort(() => Math.random() - 0.5);
  }
  return pool.slice(0, Math.min(options.questionCount || 40, pool.length));
}

function calcEloChange(winnerElo, loserElo) {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  return Math.round(32 * (1 - expected));
}

function getLevel(elo) {
  if (elo >= 1400) return { level: 6, name: '🏆 Maître de la Route', next: null };
  if (elo >= 1250) return { level: 5, name: '⚡ Expert', next: 1400 };
  if (elo >= 1150) return { level: 4, name: '🎯 Confirmé', next: 1250 };
  if (elo >= 1080) return { level: 3, name: '🚗 Conducteur', next: 1150 };
  if (elo >= 1020) return { level: 2, name: '📚 Élève sérieux', next: 1080 };
  return { level: 1, name: '🔰 Apprenti', next: 1020 };
}

function checkBadges(user, gameResult) {
  const badges = [];
  if (gameResult.score === gameResult.total && gameResult.total >= 10) badges.push('🎯 Sans faute');
  if (gameResult.maxStreak >= 5) badges.push('🔥 En feu');
  if ((user.wins || 0) >= 10) badges.push('👑 Champion');
  if ((user.total_games || 0) >= 50) badges.push('🏎️ Vétéran');
  if (gameResult.mode === 'piege' && gameResult.percentage >= 80) badges.push('😈 Piège-proof');
  if (gameResult.mode === 'examen_blanc' && gameResult.percentage >= 87) badges.push('📋 Reçu au code');
  if (gameResult.allCorrectInCategory) badges.push(`🌟 Expert ${gameResult.allCorrectInCategory}`);
  return badges.filter(b => !((user.badges || []).includes(b)));
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { pseudo, password } = req.body;
    if (!pseudo || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    if (pseudo.length < 3 || pseudo.length > 20) return res.status(400).json({ error: 'Pseudo : 3-20 caractères' });
    if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4)' });
    const exists = await db.getUser(pseudo);
    if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    const hash = await bcrypt.hash(password, 10);
    const result = await db.createUser(pseudo, hash);
    const token = jwt.sign({ id: result.id, pseudo }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, pseudo, elo: 1000, wins: 0, losses: 0, total_games: 0, level: getLevel(1000) });
  } catch (e) { console.error('register error:', e); res.status(500).json({ error: 'Erreur serveur: ' + e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { pseudo, password } = req.body;
    const user = await db.getUser(pseudo);
    if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    const id = user._id?.toString() || user.id;
    const token = jwt.sign({ id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, pseudo: user.pseudo, elo: user.elo, wins: user.wins, losses: user.losses, total_games: user.total_games, level: getLevel(user.elo), badges: user.badges || [], category_stats: user.category_stats || {} });
  } catch (e) { console.error('login error:', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/leaderboard', async (req, res) => {
  const players = await db.getLeaderboard(20);
  res.json(players.map(p => ({ ...p, levelInfo: getLevel(p.elo) })));
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json({ pseudo: user.pseudo, elo: user.elo, wins: user.wins || 0, losses: user.losses || 0, total_games: user.total_games || 0, total_correct: user.total_correct || 0, total_questions: user.total_questions || 0, category_stats: user.category_stats || {}, badges: user.badges || [], level: getLevel(user.elo) });
});

// ── Training session (solo) ───────────────────────────────────────────────────
app.get('/api/training/session', async (req, res) => {
  // Works with or without auth
  let user = null;
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { const decoded = jwt.verify(token, JWT_SECRET); user = await db.getUserById(decoded.id); } catch {}
  }
  const catStats = user?.category_stats || {};
  // Find weakest categories
  const weakCategories = Object.entries(catStats)
    .filter(([, s]) => s.sessions > 0)
    .sort((a, b) => (b[1].errors / b[1].sessions) - (a[1].errors / a[1].sessions))
    .slice(0, 2)
    .map(([cat]) => cat);

  const mode = req.query.mode || 'training';
  const count = parseInt(req.query.count || '10');
  const questions = pickQuestions({ questionCount: count, weakCategories, mode, category: req.query.category || 'all' });
  res.json({ questions: questions.map(q => ({ ...q, correct: undefined, explanation: undefined })), weakCategories, totalQuestions: questions.length, fullQuestions: questions });
});

app.post('/api/training/complete', authMiddleware, async (req, res) => {
  try {
    const { answers, questions, mode } = req.body;
    // Calculate results
    let correct = 0, maxStreak = 0, currentStreak = 0;
    const categoryErrors = {};
    const detailedResults = [];

    questions.forEach((q, i) => {
      const submitted = [...(answers[i] || [])].sort().join(',');
      const isCorrect = submitted === [...q.correct].sort().join(',');
      if (isCorrect) { correct++; currentStreak++; maxStreak = Math.max(maxStreak, currentStreak); }
      else { currentStreak = 0; categoryErrors[q.category] = (categoryErrors[q.category] || 0) + 1; }
      detailedResults.push({ question: q.question, isCorrect, correctAnswers: q.correct, explanation: q.explanation, category: q.category, userAnswers: answers[i] || [] });
    });

    const percentage = Math.round((correct / questions.length) * 100);
    const user = await db.getUserById(req.user.id);

    // Update stats
    await db.updateUser(req.user.id, { total_correct: correct, total_questions: questions.length });
    await db.updateCategoryStats(req.user.id, categoryErrors);

    // Check badges
    const newBadges = checkBadges(user || {}, { score: correct, total: questions.length, percentage, maxStreak, mode, allCorrectInCategory: null });
    for (const badge of newBadges) await db.addBadge(req.user.id, badge);

    // Update level
    const updatedUser = await db.getUserById(req.user.id);
    const level = getLevel(updatedUser?.elo || 1000);

    res.json({ correct, total: questions.length, percentage, categoryErrors, maxStreak, detailedResults, newBadges, level,
      passed: mode === 'examen_blanc' ? percentage >= 87 : null });
  } catch (e) { console.error('training complete error:', e); res.status(500).json({ error: e.message }); }
});


// ── Profile photo ─────────────────────────────────────────────────────────────
app.post('/api/profile/photo', authMiddleware, async (req, res) => {
  try {
    const { photo } = req.body; // base64 data URL
    if (!photo) return res.status(400).json({ error: 'Photo manquante' });
    if (photo.length > 500000) return res.status(400).json({ error: 'Image trop grande (max 500kb)' });
    await db.updateUser(req.user.id, {}, { avatar: photo });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile/session-time', authMiddleware, async (req, res) => {
  try {
    const { seconds } = req.body;
    if (seconds > 0 && seconds < 86400) await db.updateUser(req.user.id, { total_seconds: Math.round(seconds) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  let connectedUser = null;
  if (token) { try { connectedUser = jwt.verify(token, JWT_SECRET); } catch {} }

  socket.on('create_game', ({ pseudo, options, avatar }) => {
    if (!pseudo) return socket.emit('error', 'Pseudo requis');
    const gameOptions = {
      maxPlayers: Math.min(options?.maxPlayers || 2, 10),
      questionCount: options?.mode === 'micro' ? 5 : options?.mode === 'examen_blanc' ? 40 : (options?.questionCount || 40),
      timeLimit: options?.mode === 'micro' ? 15 : options?.mode === 'blitz' ? 20 : (options?.timeLimit || 30),
      category: options?.category || 'all',
      mode: options?.mode || 'normal',
    };
    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeGames.has(roomCode));
    const questions = pickQuestions(gameOptions);
    const player = makePlayer(socket.id, pseudo, connectedUser?.id || null);
    if (avatar) player.avatar = avatar;
    const gameState = { roomCode, options: gameOptions, questions, players: [player], hostPseudo: pseudo, currentQuestion: 0, status: 'waiting', questionTimer: null };
    activeGames.set(roomCode, gameState);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    db.createGame(roomCode, pseudo).catch(() => {});
    socket.emit('game_created', { roomCode, options: gameOptions, totalQuestions: questions.length, isHost: true, avatar: player.avatar });
  });

  socket.on('join_game', ({ roomCode, pseudo, avatar }) => {
    const code = roomCode?.toUpperCase();
    const game = activeGames.get(code);
    if (!game) return socket.emit('error', 'Partie introuvable. Vérifie le code.');
    if (game.status !== 'waiting') return socket.emit('error', 'Cette partie a déjà commencé.');
    if (game.players.length >= game.options.maxPlayers) return socket.emit('error', `Partie complète (${game.options.maxPlayers} joueurs max).`);
    if (game.players.find(p => p.pseudo === pseudo)) return socket.emit('error', 'Ce pseudo est déjà utilisé dans cette partie !');
    const player = makePlayer(socket.id, pseudo, connectedUser?.id || null);
    if (avatar) player.avatar = avatar;
    game.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.emit('game_joined', { roomCode: code, players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })), options: game.options, totalQuestions: game.questions.length, isHost: false });
    io.to(code).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready, avatar: p.avatar })), maxPlayers: game.options.maxPlayers });
  });

  socket.on('player_ready', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) player.ready = true;
    io.to(game.roomCode).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready, avatar: p.avatar })), maxPlayers: game.options.maxPlayers });
    if (game.players.length >= 2 && game.players.every(p => p.ready)) startGame(game);
  });

  socket.on('force_start', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'waiting') return;
    const me = game.players.find(p => p.socketId === socket.id);
    if (!me || me.pseudo !== game.hostPseudo) return;
    if (game.players.length < 2) return socket.emit('error', 'Il faut au moins 2 joueurs !');
    startGame(game);
  });

  socket.on('submit_answer', ({ answers, timeTaken }) => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || player.answered) return;
    player.answered = true;
    const q = game.questions[game.currentQuestion];
    const isCorrect = [...(answers || [])].sort().join(',') === [...q.correct].sort().join(',');
    if (isCorrect) { player.score++; player.streak++; player.maxStreak = Math.max(player.maxStreak || 0, player.streak); }
    else { player.streak = 0; }
    player.answers.push({ questionId: q.id, isCorrect, timeTaken: timeTaken || game.options.timeLimit, answers, category: q.category });

    const showFeedback = !['examen_blanc', 'blitz'].includes(game.options.mode);
    socket.emit('answer_result', {
      isCorrect: showFeedback ? isCorrect : null,
      correctAnswers: showFeedback ? q.correct : [],
      explanation: showFeedback ? q.explanation : '',
      isTrap: q.is_trap, trapMessage: q.trap_message,
      streak: player.streak, score: player.score, hidden: !showFeedback,
      trapStats: q.is_trap ? `${Math.floor(Math.random() * 40 + 40)}% des joueurs se trompent ici` : null,
    });
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })) });
    if (game.players.every(p => p.answered)) {
      clearTimeout(game.questionTimer);
      const delay = game.options.mode === 'blitz' ? 1000 : game.options.mode === 'micro' ? 1500 : 3000;
      setTimeout(() => nextQuestion(game), delay);
    }
  });

  socket.on('use_powerup', ({ type }) => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || !player.powerups[type]) return;
    player.powerups[type]--;
    const q = game.questions[game.currentQuestion];
    if (type === 'fifty50') {
      const wrong = q.answers.filter(a => !q.correct.includes(a.id)).sort(() => Math.random() - 0.5).slice(0, 2);
      socket.emit('powerup_result', { type, removed: wrong.map(a => a.id) });
    } else if (type === 'timeBonus') {
      socket.emit('powerup_result', { type, bonusSeconds: 15 });
    } else if (type === 'stress') {
      game.players.filter(p => p.socketId !== socket.id).forEach(op => {
        io.sockets.sockets.get(op.socketId)?.emit('powerup_applied', { type: 'stress', penaltySeconds: 10, from: player.pseudo });
      });
      socket.emit('powerup_result', { type });
    }
  });

  socket.on('request_rematch', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'finished') return;
    const me = game.players.find(p => p.socketId === socket.id);
    if (!me || me.pseudo !== game.hostPseudo) return;
    let newCode;
    do { newCode = generateRoomCode(); } while (activeGames.has(newCode));
    const questions = pickQuestions(game.options);
    const newGame = { roomCode: newCode, options: game.options, questions, players: game.players.map(p => makePlayer(p.socketId, p.pseudo, p.userId)), hostPseudo: game.hostPseudo, currentQuestion: 0, status: 'waiting', questionTimer: null };
    activeGames.set(newCode, newGame);
    game.players.forEach(p => {
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) { sock.leave(game.roomCode); sock.join(newCode); sock.roomCode = newCode; }
    });
    io.to(newCode).emit('rematch_started', { roomCode: newCode, options: game.options, players: newGame.players.map(p => ({ pseudo: p.pseudo, ready: false })), totalQuestions: questions.length });
    activeGames.delete(game.roomCode);
    db.createGame(newCode, newGame.hostPseudo).catch(() => {});
  });

  socket.on('disconnect', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (game.status === 'playing') {
      game.players = game.players.filter(p => p.socketId !== socket.id);
      io.to(game.roomCode).emit('player_disconnected', { pseudo: player.pseudo });
      if (game.players.length < 2) { clearTimeout(game.questionTimer); setTimeout(() => endGame(game), 1500); }
    } else {
      game.players = game.players.filter(p => p.socketId !== socket.id);
      io.to(game.roomCode).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready, avatar: p.avatar })), maxPlayers: game.options.maxPlayers });
      if (game.players.length === 0) activeGames.delete(game.roomCode);
    }
  });
});

function makePlayer(socketId, pseudo, userId) {
  return { socketId, pseudo, userId: userId || null, avatar: null, score: 0, streak: 0, maxStreak: 0, answers: [], powerups: { fifty50: 1, timeBonus: 1, stress: 1 }, ready: false, answered: false };
}

function startGame(game) {
  game.status = 'playing';
  game.players.forEach(p => p.ready = true);
  db.updateGame(game.roomCode, { status: 'playing' }).catch(() => {});
  io.to(game.roomCode).emit('game_start', { totalQuestions: game.questions.length, players: game.players.map(p => ({ pseudo: p.pseudo, score: 0 })), options: game.options });
  sendQuestion(game);
}

function sendQuestion(game) {
  if (game.currentQuestion >= game.questions.length) return endGame(game);
  game.players.forEach(p => p.answered = false);
  const q = game.questions[game.currentQuestion];
  io.to(game.roomCode).emit('new_question', {
    index: game.currentQuestion, total: game.questions.length,
    id: q.id, category: q.category, question: q.question, answers: q.answers,
    isMultiple: q.correct.length > 1, isTrap: q.is_trap,
    timeLimit: game.options.timeLimit, mode: game.options.mode,
    image_url: q.image_url || null, situation: q.situation || null,
  });
  game.questionTimer = setTimeout(() => {
    game.players.filter(p => !p.answered).forEach(p => {
      p.answered = true; p.streak = 0;
      p.answers.push({ questionId: q.id, isCorrect: false, timeTaken: game.options.timeLimit, answers: [], category: q.category });
      const sock = io.sockets.sockets.get(p.socketId);
      const showFeedback = !['examen_blanc', 'blitz'].includes(game.options.mode);
      sock?.emit('answer_result', { isCorrect: showFeedback ? false : null, correctAnswers: showFeedback ? q.correct : [], explanation: showFeedback ? q.explanation : '', isTrap: q.is_trap, trapMessage: q.trap_message, streak: 0, score: p.score, timeout: true, hidden: !showFeedback });
    });
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })) });
    const delay = game.options.mode === 'blitz' ? 800 : game.options.mode === 'micro' ? 1000 : 2500;
    setTimeout(() => nextQuestion(game), delay);
  }, game.options.timeLimit * 1000);
}

function nextQuestion(game) {
  game.currentQuestion++;
  if (game.currentQuestion >= game.questions.length) endGame(game);
  else sendQuestion(game);
}

async function endGame(game) {
  game.status = 'finished';
  clearTimeout(game.questionTimer);
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0]?.score > (ranked[1]?.score || -1) ? ranked[0].pseudo : null;
  const eloChanges = {};

  if (game.players.length === 2 && winner) {
    const [p1, p2] = ranked;
    if (p1.userId && p2.userId) {
      try {
        const u1 = await db.getUserById(p1.userId);
        const u2 = await db.getUserById(p2.userId);
        if (u1 && u2) {
          const delta = calcEloChange(u1.elo, u2.elo);
          eloChanges[p1.pseudo] = +delta;
          eloChanges[p2.pseudo] = -delta;
          await db.updateUser(p1.userId, { elo: delta, wins: 1, total_games: 1 });
          await db.updateUser(p2.userId, { elo: -delta, losses: 1, total_games: 1 });
        }
      } catch (e) { console.error('Elo error:', e.message); }
    }
  } else {
    for (const p of game.players) {
      if (p.userId) {
        try { await db.updateUser(p.userId, { [p.pseudo === winner ? 'wins' : 'losses']: 1, total_games: 1 }); } catch {}
      }
    }
  }

  const newBadgesAll = {};
  for (const p of game.players) {
    if (p.userId) {
      try {
        await db.updateUser(p.userId, { total_correct: p.score, total_questions: game.questions.length });
        const catErrors = {};
        p.answers.filter(a => !a.isCorrect).forEach(a => { catErrors[a.category] = (catErrors[a.category] || 0) + 1; });
        await db.updateCategoryStats(p.userId, catErrors);
        const user = await db.getUserById(p.userId);
        const newBadges = checkBadges(user || {}, { score: p.score, total: game.questions.length, percentage: Math.round(p.score/game.questions.length*100), maxStreak: p.maxStreak, mode: game.options.mode });
        for (const b of newBadges) await db.addBadge(p.userId, b);
        if (newBadges.length) newBadgesAll[p.pseudo] = newBadges;
      } catch {}
    }
  }

  const results = ranked.map((p, i) => {
    const catErrors = {};
    p.answers.filter(a => !a.isCorrect).forEach(a => { catErrors[a.category] = (catErrors[a.category] || 0) + 1; });
    return {
      rank: i + 1, pseudo: p.pseudo, score: p.score, total: game.questions.length,
      percentage: Math.round((p.score / game.questions.length) * 100),
      categoryErrors: catErrors, eloChange: eloChanges[p.pseudo] || 0,
      maxStreak: p.maxStreak,
      levelInfo: null, // will be fetched client side
    };
  });

  // Build replay data
  const replayData = game.questions.map((q, i) => ({
    question: q.question, category: q.category, correct: q.correct, explanation: q.explanation, isTrap: q.is_trap,
    playerAnswers: game.players.map(p => ({ pseudo: p.pseudo, answers: p.answers[i]?.answers || [], isCorrect: p.answers[i]?.isCorrect, timeTaken: p.answers[i]?.timeTaken }))
  }));

  db.updateGame(game.roomCode, { status: 'finished', winner_pseudo: winner, player1_score: ranked[0]?.score || 0, player2_score: ranked[1]?.score || 0, finished_at: new Date().toISOString() }).catch(() => {});
  io.to(game.roomCode).emit('game_end', { winner, isDraw: !winner, results, mode: game.options.mode, hostPseudo: game.hostPseudo, newBadges: newBadgesAll, replayData,
    examPassed: game.options.mode === 'examen_blanc' ? ranked.map(p => ({ pseudo: p.pseudo, passed: Math.round(p.score/game.questions.length*100) >= 87 })) : null });
  setTimeout(() => activeGames.delete(game.roomCode), 120000);
}

db.init().then(() => {
  httpServer.listen(PORT, () => console.log(`🚗 Code Duel v4 — port ${PORT}`));
});

// ── PROFILE PHOTO & STATS ROUTES (add before db.init()) ──────────────────────
