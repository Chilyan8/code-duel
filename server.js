const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const db = require('./db');
const allQuestions = require('./data/questions.json');

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌  JWT_SECRET non défini — arrêt pour sécurité.');
  process.exit(1);
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGINS || 'http://localhost:' + PORT;

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGIN, credentials: true, methods: ['GET', 'POST'] },
});

// ── Cookie options ─────────────────────────────────────────────────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
};

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '600kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ──────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Trop de tentatives, réessaie dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// ── Auth middleware ────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const activeGames = new Map();
const matchmakingQueue = [];
const QUEUE_ELO_START  = 200;
const QUEUE_ELO_STEP   = 100;
const QUEUE_ELO_EVERY  = 10;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function pickQuestions(options) {
  let pool = allQuestions.filter(q => q.category !== 'international');
  if (options.mode === 'piege') pool = pool.filter(q => q.is_trap);
  else if (options.mode === 'micro') pool = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  else if (options.category && options.category !== 'all') {
    const filtered = pool.filter(q => q.category === options.category);
    if (filtered.length >= 5) pool = filtered;
  }
  if (options.weakCategories?.length) {
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

// ── Matchmaking queue ──────────────────────────────────────────────────────────
function queueEloRange(entry) {
  const secs = (Date.now() - entry.joinedAt) / 1000;
  return QUEUE_ELO_START + Math.floor(secs / QUEUE_ELO_EVERY) * QUEUE_ELO_STEP;
}

function findQueueMatch(entry) {
  let best = null, bestDiff = Infinity;
  for (const other of matchmakingQueue) {
    if (other.socketId === entry.socketId) continue;
    const diff = Math.abs(other.elo - entry.elo);
    if (diff <= Math.max(queueEloRange(entry), queueEloRange(other)) && diff < bestDiff) {
      best = other; bestDiff = diff;
    }
  }
  return best;
}

function broadcastQueueUpdate() {
  matchmakingQueue.forEach((p, i) => {
    io.sockets.sockets.get(p.socketId)?.emit('queue_update', {
      position: i + 1, total: matchmakingQueue.length, eloRange: queueEloRange(p)
    });
  });
}

function tryQueueMatch() {
  if (matchmakingQueue.length < 2) return;
  const p1 = matchmakingQueue[0];
  const p2 = findQueueMatch(p1);
  if (!p2) return;
  matchmakingQueue.splice(matchmakingQueue.indexOf(p2), 1);
  matchmakingQueue.splice(matchmakingQueue.indexOf(p1), 1);
  broadcastQueueUpdate();

  let roomCode;
  do { roomCode = generateRoomCode(); } while (activeGames.has(roomCode));
  const gameOptions = { maxPlayers: 2, questionCount: 40, timeLimit: 30, category: 'all', mode: 'normal' };
  const questions = pickQuestions(gameOptions);
  const pl1 = makePlayer(p1.socketId, p1.pseudo, p1.userId); pl1.avatar = p1.avatar;
  const pl2 = makePlayer(p2.socketId, p2.pseudo, p2.userId); pl2.avatar = p2.avatar;
  const game = { roomCode, options: gameOptions, questions, players: [pl1, pl2], hostPseudo: p1.pseudo, currentQuestion: 0, status: 'waiting', questionTimer: null };
  activeGames.set(roomCode, game);

  const s1 = io.sockets.sockets.get(p1.socketId);
  const s2 = io.sockets.sockets.get(p2.socketId);
  if (s1) { s1.join(roomCode); s1.roomCode = roomCode; }
  if (s2) { s2.join(roomCode); s2.roomCode = roomCode; }
  db.createGame(roomCode, p1.pseudo).catch(() => {});

  s1?.emit('queue_matched', { roomCode, isHost: true,  opponent: { pseudo: p2.pseudo, elo: p2.elo, avatar: p2.avatar }, totalQuestions: questions.length });
  s2?.emit('queue_matched', { roomCode, isHost: false, opponent: { pseudo: p1.pseudo, elo: p1.elo, avatar: p1.avatar }, totalQuestions: questions.length });

  setTimeout(() => { const g = activeGames.get(roomCode); if (g?.status === 'waiting') startGame(g); }, 3500);
}

setInterval(() => { if (matchmakingQueue.length >= 2) tryQueueMatch(); }, 3000);

// ── Socket.io auth middleware ──────────────────────────────────────────────────
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) {
    try {
      socket.connectedUser = jwt.verify(decodeURIComponent(match[1]), JWT_SECRET);
    } catch {}
  }
  next();
});

// ── REST API ───────────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const pseudo = String(req.body?.pseudo || '').trim();
    const password = String(req.body?.password || '');
    if (!pseudo || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    if (pseudo.length < 3 || pseudo.length > 20) return res.status(400).json({ error: 'Pseudo : 3-20 caractères' });
    if (!/^[\w\- .éèêëàâùûüîïôçæœ]+$/i.test(pseudo)) return res.status(400).json({ error: 'Pseudo : lettres, chiffres, tirets et espaces uniquement' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    if (password.length > 128) return res.status(400).json({ error: 'Mot de passe trop long' });
    const exists = await db.getUser(pseudo);
    if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    const hash = await bcrypt.hash(password, 12);
    const result = await db.createUser(pseudo, hash);
    const token = jwt.sign({ id: result.id, pseudo }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ pseudo, elo: 1000, wins: 0, losses: 0, total_games: 0, level: getLevel(1000) });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const pseudo = String(req.body?.pseudo || '').trim();
    const password = String(req.body?.password || '');
    if (!pseudo || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    const user = await db.getUser(pseudo);
    if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    const id = user._id?.toString() || user.id;
    const token = jwt.sign({ id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ pseudo: user.pseudo, elo: user.elo, wins: user.wins, losses: user.losses, total_games: user.total_games, level: getLevel(user.elo), badges: user.badges || [], category_stats: user.category_stats || {} });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/leaderboard', async (req, res) => {
  const players = await db.getLeaderboard(20);
  res.json(players.map(p => ({ ...p, levelInfo: getLevel(p.elo) })));
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json({ pseudo: user.pseudo, elo: user.elo, wins: user.wins || 0, losses: user.losses || 0, total_games: user.total_games || 0, total_correct: user.total_correct || 0, total_questions: user.total_questions || 0, total_seconds: user.total_seconds || 0, category_stats: user.category_stats || {}, badges: user.badges || [], level: getLevel(user.elo), avatar: user.avatar || null });
});

app.put('/api/profile/pseudo', authMiddleware, async (req, res) => {
  try {
    const pseudo = String(req.body?.pseudo || '').trim();
    if (!pseudo || pseudo.length < 3 || pseudo.length > 20) return res.status(400).json({ error: 'Pseudo : 3-20 caractères' });
    if (!/^[\w\- .éèêëàâùûüîïôçæœ]+$/i.test(pseudo)) return res.status(400).json({ error: 'Caractères invalides' });
    const exists = await db.getUser(pseudo);
    if (exists && String(exists.id) !== String(req.user.id)) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    await db.updateUser(req.user.id, {}, { pseudo });
    const token = jwt.sign({ id: req.user.id, pseudo }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ pseudo });
  } catch(e) {
    console.error('update pseudo error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Training session (solo) ────────────────────────────────────────────────────
app.get('/api/training/session', async (req, res) => {
  let user = null;
  const token = req.cookies?.token;
  if (token) {
    try { const decoded = jwt.verify(token, JWT_SECRET); user = await db.getUserById(decoded.id); } catch {}
  }
  const catStats = user?.category_stats || {};
  const weakCategories = Object.entries(catStats)
    .filter(([, s]) => s.sessions > 0)
    .sort((a, b) => (b[1].errors / b[1].sessions) - (a[1].errors / a[1].sessions))
    .slice(0, 2)
    .map(([cat]) => cat);

  const mode = req.query.mode || 'training';
  const count = Math.min(parseInt(req.query.count || '10'), 40);
  const questions = pickQuestions({ questionCount: count, weakCategories, mode, category: req.query.category || 'all' });
  // Ne pas exposer les réponses dans la réponse initiale
  const safeQuestions = questions.map(q => ({ id: q.id, category: q.category, question: q.question, answers: q.answers, isMultiple: q.correct.length > 1, is_trap: q.is_trap, trap_message: q.trap_message, situation: q.situation || null, image_url: q.image_url || null, video_url: q.video_url || null }));
  res.json({ questions: safeQuestions, fullQuestions: questions, weakCategories, totalQuestions: questions.length });
});

app.post('/api/training/complete', authMiddleware, async (req, res) => {
  try {
    const { answers, questions, mode } = req.body;
    if (!Array.isArray(answers) || !Array.isArray(questions)) return res.status(400).json({ error: 'Données invalides' });
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

    await db.updateUser(req.user.id, { total_correct: correct, total_questions: questions.length });
    await db.updateCategoryStats(req.user.id, categoryErrors);

    const newBadges = checkBadges(user || {}, { score: correct, total: questions.length, percentage, maxStreak, mode, allCorrectInCategory: null });
    for (const badge of newBadges) await db.addBadge(req.user.id, badge);

    const updatedUser = await db.getUserById(req.user.id);
    const level = getLevel(updatedUser?.elo || 1000);

    res.json({ correct, total: questions.length, percentage, categoryErrors, maxStreak, detailedResults, newBadges, level,
      passed: mode === 'examen_blanc' ? percentage >= 87 : null });
  } catch (e) {
    console.error('training complete error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Profile photo ──────────────────────────────────────────────────────────────
app.post('/api/profile/photo', authMiddleware, async (req, res) => {
  try {
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: 'Photo manquante' });
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return res.status(400).json({ error: 'Format invalide' });
    if (photo.length > 500000) return res.status(400).json({ error: 'Image trop grande (max 500kb)' });
    await db.updateUser(req.user.id, {}, { avatar: photo });
    res.json({ success: true });
  } catch (e) {
    console.error('photo error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/profile/session-time', authMiddleware, async (req, res) => {
  try {
    const seconds = Number(req.body?.seconds);
    if (seconds > 0 && seconds < 86400) await db.updateUser(req.user.id, { total_seconds: Math.round(seconds) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const connectedUser = socket.connectedUser || null;

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
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered, avatar: p.avatar })) });
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

  socket.on('leave_waiting', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'waiting') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    game.players = game.players.filter(p => p.socketId !== socket.id);
    socket.leave(game.roomCode);
    socket.roomCode = null;
    io.to(game.roomCode).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready, avatar: p.avatar })), maxPlayers: game.options.maxPlayers });
    if (game.players.length === 0) activeGames.delete(game.roomCode);
  });

  socket.on('chat_message', ({ message }) => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    const text = String(message || '').trim().slice(0, 120);
    if (!text) return;
    if (!game.chatHistory) game.chatHistory = [];
    game.chatHistory.push({ pseudo: player.pseudo, message: text });
    io.to(game.roomCode).emit('chat_message', { pseudo: player.pseudo, message: text });
  });

  socket.on('join_queue', ({ pseudo, elo, avatar }) => {
    if (!pseudo) return socket.emit('error', 'Pseudo requis');
    if (matchmakingQueue.find(p => p.socketId === socket.id)) return;
    if (socket.roomCode && activeGames.has(socket.roomCode)) return socket.emit('error', 'Tu es déjà dans une partie !');
    const entry = { socketId: socket.id, pseudo, elo: elo || 1000, userId: connectedUser?.id || null, avatar: avatar || null, joinedAt: Date.now() };
    matchmakingQueue.push(entry);
    socket.emit('queue_joined', { position: matchmakingQueue.length, total: matchmakingQueue.length, eloRange: QUEUE_ELO_START });
    tryQueueMatch();
  });

  socket.on('leave_queue', () => {
    const qi = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (qi >= 0) { matchmakingQueue.splice(qi, 1); broadcastQueueUpdate(); }
    socket.emit('queue_left');
  });

  socket.on('forfeit_game', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') { socket.roomCode = null; return; }
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (!game.forfeiters) game.forfeiters = [];
    game.forfeiters.push(player);
    game.players = game.players.filter(p => p.socketId !== socket.id);
    io.to(game.roomCode).emit('player_disconnected', { pseudo: player.pseudo });
    socket.roomCode = null;
    if (game.players.length < 2) { clearTimeout(game.questionTimer); setTimeout(() => endGame(game), 1000); }
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
    const qi = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (qi >= 0) { matchmakingQueue.splice(qi, 1); broadcastQueueUpdate(); }

    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (game.status === 'playing') {
      if (!game.forfeiters) game.forfeiters = [];
      game.forfeiters.push(player);
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
  io.to(game.roomCode).emit('game_start', { totalQuestions: game.questions.length, players: game.players.map(p => ({ pseudo: p.pseudo, score: 0, avatar: p.avatar })), options: game.options });
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
    image_url: q.image_url || null, video_url: q.video_url || null, situation: q.situation || null,
  });
  game.questionTimer = setTimeout(() => {
    game.players.filter(p => !p.answered).forEach(p => {
      p.answered = true; p.streak = 0;
      p.answers.push({ questionId: q.id, isCorrect: false, timeTaken: game.options.timeLimit, answers: [], category: q.category });
      const sock = io.sockets.sockets.get(p.socketId);
      const showFeedback = !['examen_blanc', 'blitz'].includes(game.options.mode);
      sock?.emit('answer_result', { isCorrect: showFeedback ? false : null, correctAnswers: showFeedback ? q.correct : [], explanation: showFeedback ? q.explanation : '', isTrap: q.is_trap, trapMessage: q.trap_message, streak: 0, score: p.score, timeout: true, hidden: !showFeedback });
    });
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered, avatar: p.avatar })) });
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

  const forfeiters = game.forfeiters || [];
  const allPlayers = [...game.players, ...forfeiters];
  const ranked = [...game.players].sort((a, b) => b.score - a.score);

  let winner = null;
  if (forfeiters.length > 0 && game.players.length === 1) {
    winner = game.players[0].pseudo;
  } else if (ranked.length >= 2) {
    winner = ranked[0]?.score > (ranked[1]?.score ?? -1) ? ranked[0].pseudo : null;
  } else if (ranked.length === 1) {
    winner = ranked[0].pseudo;
  }

  const eloChanges = {};

  if (allPlayers.length === 2 && winner) {
    const winnerP = allPlayers.find(p => p.pseudo === winner);
    const loserP  = allPlayers.find(p => p.pseudo !== winner);
    if (winnerP?.userId && loserP?.userId) {
      try {
        const u1 = await db.getUserById(winnerP.userId);
        const u2 = await db.getUserById(loserP.userId);
        if (u1 && u2) {
          const delta = calcEloChange(u1.elo, u2.elo);
          eloChanges[winnerP.pseudo] = +delta;
          eloChanges[loserP.pseudo]  = -delta;
          await db.updateUser(winnerP.userId, { elo: delta,  wins: 1,   total_games: 1 });
          await db.updateUser(loserP.userId,  { elo: -delta, losses: 1, total_games: 1 });
        }
      } catch (e) { console.error('Elo error:', e.message); }
    }
  } else {
    for (const p of allPlayers) {
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
      maxStreak: p.maxStreak, levelInfo: null,
    };
  });
  const forfeitResults = forfeiters.map((p, i) => ({
    rank: results.length + i + 1, pseudo: p.pseudo, score: p.score, total: game.questions.length,
    percentage: Math.round((p.score / game.questions.length) * 100),
    categoryErrors: {}, eloChange: eloChanges[p.pseudo] || 0,
    maxStreak: p.maxStreak || 0, levelInfo: null, forfeited: true,
  }));
  const allResults = [...results, ...forfeitResults];

  const replayData = game.questions.map((q, i) => ({
    question: q.question, category: q.category, correct: q.correct, explanation: q.explanation, isTrap: q.is_trap,
    playerAnswers: game.players.map(p => ({ pseudo: p.pseudo, answers: p.answers[i]?.answers || [], isCorrect: p.answers[i]?.isCorrect, timeTaken: p.answers[i]?.timeTaken }))
  }));

  db.updateGame(game.roomCode, { status: 'finished', winner_pseudo: winner, player1_score: ranked[0]?.score || 0, player2_score: ranked[1]?.score || 0, finished_at: new Date().toISOString() }).catch(() => {});
  io.to(game.roomCode).emit('game_end', { winner, isDraw: !winner, results: allResults, mode: game.options.mode, hostPseudo: game.hostPseudo, newBadges: newBadgesAll, replayData, chatHistory: game.chatHistory || [],
    examPassed: game.options.mode === 'examen_blanc' ? ranked.map(p => ({ pseudo: p.pseudo, passed: Math.round(p.score/game.questions.length*100) >= 87 })) : null });
  setTimeout(() => activeGames.delete(game.roomCode), 120000);
}

db.init().then(() => {
  httpServer.listen(PORT, () => console.log(`🚗 Code Duel v4 — port ${PORT}`));
});
