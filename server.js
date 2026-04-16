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

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function pickQuestions(options) {
  let pool = [...allQuestions];
  if (options.category && options.category !== 'all') {
    const filtered = pool.filter(q => q.category === options.category);
    if (filtered.length >= 5) pool = filtered;
  }
  return pool.sort(() => Math.random() - 0.5).slice(0, Math.min(options.questionCount, pool.length));
}

function calcEloChange(winnerElo, loserElo) {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  return Math.round(32 * (1 - expected));
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
  if (pseudo.length < 3 || pseudo.length > 20) return res.status(400).json({ error: 'Pseudo : 3-20 caractères' });
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4)' });
  try {
    const exists = await db.getUser(pseudo);
    if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    const hash = await bcrypt.hash(password, 10);
    const result = await db.createUser(pseudo, hash);
    const token = jwt.sign({ id: result.id, pseudo }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, pseudo, elo: 1000, wins: 0, losses: 0, total_games: 0 });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { pseudo, password } = req.body;
  const user = await db.getUser(pseudo);
  if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  const id = user._id?.toString() || user.id;
  const token = jwt.sign({ id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, pseudo: user.pseudo, elo: user.elo, wins: user.wins, losses: user.losses, total_games: user.total_games });
});

app.get('/api/leaderboard', async (req, res) => {
  const players = await db.getLeaderboard(20);
  res.json(players);
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json({ pseudo: user.pseudo, elo: user.elo, wins: user.wins, losses: user.losses, total_games: user.total_games, total_correct: user.total_correct, total_questions: user.total_questions });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  let connectedUser = null;
  if (token) { try { connectedUser = jwt.verify(token, JWT_SECRET); } catch {} }

  socket.on('create_game', ({ pseudo, options }) => {
    if (!pseudo) return socket.emit('error', 'Pseudo requis');
    const gameOptions = {
      maxPlayers: Math.min(options?.maxPlayers || 2, 10),
      questionCount: options?.questionCount || 40,
      timeLimit: options?.timeLimit || 30,
      category: options?.category || 'all',
      mode: options?.mode || 'normal',
    };
    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeGames.has(roomCode));
    const questions = pickQuestions(gameOptions);
    const player = makePlayer(socket.id, pseudo, connectedUser?.id || null);
    const gameState = {
      roomCode, options: gameOptions, questions,
      players: [player], hostPseudo: pseudo,
      currentQuestion: 0, status: 'waiting', questionTimer: null,
    };
    activeGames.set(roomCode, gameState);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    db.createGame(roomCode, pseudo, connectedUser?.id || null).catch(() => {});
    socket.emit('game_created', { roomCode, options: gameOptions, totalQuestions: questions.length, isHost: true });
  });

  socket.on('join_game', ({ roomCode, pseudo }) => {
    const code = roomCode?.toUpperCase();
    const game = activeGames.get(code);
    if (!game) return socket.emit('error', 'Partie introuvable. Vérifie le code.');
    if (game.status !== 'waiting') return socket.emit('error', 'Cette partie a déjà commencé.');
    if (game.players.length >= game.options.maxPlayers) return socket.emit('error', `Partie complète (${game.options.maxPlayers} joueurs max).`);
    if (game.players.find(p => p.pseudo === pseudo)) return socket.emit('error', 'Ce pseudo est déjà utilisé dans cette partie !');
    const player = makePlayer(socket.id, pseudo, connectedUser?.id || null);
    game.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.emit('game_joined', { roomCode: code, players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })), options: game.options, totalQuestions: game.questions.length, isHost: false });
    io.to(code).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })), maxPlayers: game.options.maxPlayers });
  });

  socket.on('player_ready', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) player.ready = true;
    io.to(game.roomCode).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })), maxPlayers: game.options.maxPlayers });
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
    if (isCorrect) { player.score++; player.streak++; } else { player.streak = 0; }
    player.answers.push({ questionId: q.id, isCorrect, timeTaken: timeTaken || game.options.timeLimit });

    const showFeedback = game.options.mode !== 'examen';
    socket.emit('answer_result', {
      isCorrect: showFeedback ? isCorrect : null,
      correctAnswers: showFeedback ? q.correct : [],
      explanation: showFeedback ? q.explanation : '',
      isTrap: q.is_trap, trapMessage: q.trap_message,
      streak: player.streak, score: player.score, hidden: !showFeedback,
    });
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })) });
    if (game.players.every(p => p.answered)) {
      clearTimeout(game.questionTimer);
      setTimeout(() => nextQuestion(game), game.options.mode === 'blitz' ? 1000 : 3000);
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

  // ── REMATCH ──
  socket.on('request_rematch', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'finished') return;
    const me = game.players.find(p => p.socketId === socket.id);
    if (!me || me.pseudo !== game.hostPseudo) return;

    // Create new game with same options and same players
    let newCode;
    do { newCode = generateRoomCode(); } while (activeGames.has(newCode));
    const questions = pickQuestions(game.options);
    const newGame = {
      roomCode: newCode, options: game.options, questions,
      players: game.players.map(p => makePlayer(p.socketId, p.pseudo, p.userId)),
      hostPseudo: game.hostPseudo,
      currentQuestion: 0, status: 'waiting', questionTimer: null,
    };
    activeGames.set(newCode, newGame);

    // Move all sockets to new room
    game.players.forEach(p => {
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.leave(game.roomCode);
        sock.join(newCode);
        sock.roomCode = newCode;
      }
    });

    io.to(newCode).emit('rematch_started', { roomCode: newCode, options: game.options, players: newGame.players.map(p => ({ pseudo: p.pseudo, ready: false })), totalQuestions: questions.length });
    activeGames.delete(game.roomCode);
    db.createGame(newCode, newGame.hostPseudo, null).catch(() => {});
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
      io.to(game.roomCode).emit('player_list_update', { players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })), maxPlayers: game.options.maxPlayers });
      if (game.players.length === 0) activeGames.delete(game.roomCode);
    }
  });
});

function makePlayer(socketId, pseudo, userId) {
  return { socketId, pseudo, userId: userId || null, score: 0, streak: 0, answers: [], powerups: { fifty50: 1, timeBonus: 1, stress: 1 }, ready: false, answered: false };
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
      p.answers.push({ questionId: q.id, isCorrect: false, timeTaken: game.options.timeLimit });
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) sock.emit('answer_result', { isCorrect: game.options.mode !== 'examen' ? false : null, correctAnswers: q.correct, explanation: q.explanation, isTrap: q.is_trap, trapMessage: q.trap_message, streak: 0, score: p.score, timeout: true, hidden: game.options.mode === 'examen' });
    });
    io.to(game.roomCode).emit('scores_update', { players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })) });
    setTimeout(() => nextQuestion(game), game.options.mode === 'blitz' ? 800 : 2500);
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

  // Elo (1v1 uniquement)
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
      } catch (e) { console.error('Elo update error:', e.message); }
    }
  } else {
    for (const p of game.players) {
      if (p.userId) {
        const isWinner = p.pseudo === winner;
        try { await db.updateUser(p.userId, { [isWinner ? 'wins' : 'losses']: 1, total_games: 1 }); } catch {}
      }
    }
  }

  // Total correct/questions
  for (const p of game.players) {
    if (p.userId) {
      try { await db.updateUser(p.userId, { total_correct: p.score, total_questions: game.questions.length }); } catch {}
    }
  }

  const results = ranked.map((p, i) => {
    const wrongQ = p.answers.map((a, idx) => ({ ...a, question: game.questions[idx] })).filter(a => !a.isCorrect);
    const catErrors = {};
    wrongQ.forEach(({ question }) => { if (question) catErrors[question.category] = (catErrors[question.category] || 0) + 1; });
    const answersDetail = game.options.mode === 'examen' ? p.answers.map((a, idx) => ({ ...a, correctAnswers: game.questions[idx]?.correct, explanation: game.questions[idx]?.explanation })) : null;
    return { rank: i + 1, pseudo: p.pseudo, score: p.score, total: game.questions.length, percentage: Math.round((p.score / game.questions.length) * 100), categoryErrors: catErrors, eloChange: eloChanges[p.pseudo] || 0, answersDetail };
  });

  db.updateGame(game.roomCode, { status: 'finished', winner_pseudo: winner, player1_score: ranked[0]?.score || 0, player2_score: ranked[1]?.score || 0, finished_at: new Date() }).catch(() => {});
  io.to(game.roomCode).emit('game_end', { winner, isDraw: !winner, results, mode: game.options.mode, isHost: game.hostPseudo });
  setTimeout(() => activeGames.delete(game.roomCode), 120000);
}

// ── Start ──────────────────────────────────────────────────────────────────────
db.init().then(() => {
  httpServer.listen(PORT, () => console.log(`🚗 Code Duel v2 — port ${PORT} | MongoDB: ${process.env.MONGODB_URI ? '✅' : '❌ (JSON local)'}`));
});
