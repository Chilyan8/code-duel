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
const JWT_SECRET = process.env.JWT_SECRET || 'codeRoute_secret_2024_!@#$';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Active games (in memory) ──────────────────────────────────────────────────
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
    pool = pool.filter(q => q.category === options.category);
    if (pool.length < options.questionCount) pool = [...allQuestions]; // fallback
  }
  return pool.sort(() => Math.random() - 0.5).slice(0, Math.min(options.questionCount, pool.length));
}

function calcEloChange(winnerElo, loserElo) {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  return Math.round(32 * (1 - expected));
}

// ── Auth middleware ───────────────────────────────────────────────────────────
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
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court' });
  const exists = db.prepare('SELECT id FROM users WHERE pseudo = ?').get(pseudo);
  if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (pseudo, password_hash) VALUES (?, ?)').run(pseudo, hash);
  const token = jwt.sign({ id: result.lastInsertRowid, pseudo }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, pseudo, elo: 1000 });
});

app.post('/api/auth/login', async (req, res) => {
  const { pseudo, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE pseudo = ?').get(pseudo);
  if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  const token = jwt.sign({ id: user.id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, pseudo: user.pseudo, elo: user.elo, wins: user.wins, losses: user.losses, total_games: user.total_games });
});

app.get('/api/leaderboard', (req, res) => {
  const players = db.prepare('SELECT pseudo, elo, wins, losses, total_games FROM users ORDER BY elo DESC LIMIT 20').all();
  res.json(players);
});

app.get('/api/profile', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT pseudo, elo, wins, losses, total_games, total_correct, total_questions FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json(user);
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  let connectedUser = null;
  if (token) { try { connectedUser = jwt.verify(token, JWT_SECRET); } catch {} }

  // ── CREATE GAME ──
  socket.on('create_game', ({ pseudo, options }) => {
    if (!pseudo) return socket.emit('error', 'Pseudo requis');

    const gameOptions = {
      maxPlayers: options?.maxPlayers || 2,        // 2, 3, 4
      questionCount: options?.questionCount || 40, // 10, 20, 40
      timeLimit: options?.timeLimit || 30,          // 15, 30, 45
      category: options?.category || 'all',         // all, panneaux, priorites...
      mode: options?.mode || 'normal',              // normal, blitz, examen, tournoi
    };

    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeGames.has(roomCode));

    const questions = pickQuestions(gameOptions);
    const player = {
      socketId: socket.id, pseudo,
      userId: connectedUser?.id || null,
      score: 0, streak: 0,
      answers: [],
      powerups: { fifty50: 1, timeBonus: 1, stress: 1 },
      ready: false, answered: false,
    };

    const gameState = {
      roomCode, options: gameOptions, questions,
      players: [player],
      hostPseudo: pseudo,
      currentQuestion: 0,
      status: 'waiting',
      questionTimer: null,
      questionStartTime: null,
    };

    activeGames.set(roomCode, gameState);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    db.prepare('INSERT INTO games (room_code, player1_pseudo, player1_id) VALUES (?, ?, ?)').run(roomCode, pseudo, connectedUser?.id || null);

    socket.emit('game_created', {
      roomCode,
      options: gameOptions,
      totalQuestions: questions.length,
      isHost: true,
    });
  });

  // ── JOIN GAME ──
  socket.on('join_game', ({ roomCode, pseudo }) => {
    const game = activeGames.get(roomCode?.toUpperCase());
    if (!game) return socket.emit('error', 'Partie introuvable. Vérifie le code.');
    if (game.status !== 'waiting') return socket.emit('error', 'Cette partie a déjà commencé.');
    if (game.players.length >= game.options.maxPlayers) return socket.emit('error', `Cette partie est complète (${game.options.maxPlayers} joueurs max).`);
    if (game.players.find(p => p.pseudo === pseudo)) return socket.emit('error', 'Ce pseudo est déjà dans la partie !');

    const player = {
      socketId: socket.id, pseudo,
      userId: connectedUser?.id || null,
      score: 0, streak: 0,
      answers: [],
      powerups: { fifty50: 1, timeBonus: 1, stress: 1 },
      ready: false, answered: false,
    };

    game.players.push(player);
    socket.join(roomCode.toUpperCase());
    socket.roomCode = roomCode.toUpperCase();

    socket.emit('game_joined', {
      roomCode: roomCode.toUpperCase(),
      players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })),
      options: game.options,
      totalQuestions: game.questions.length,
      isHost: false,
    });

    io.to(roomCode.toUpperCase()).emit('player_list_update', {
      players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })),
      maxPlayers: game.options.maxPlayers,
    });
  });

  // ── PLAYER READY ──
  socket.on('player_ready', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) player.ready = true;

    io.to(game.roomCode).emit('player_list_update', {
      players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })),
      maxPlayers: game.options.maxPlayers,
    });

    const allReady = game.players.length >= 2 && game.players.every(p => p.ready);
    if (allReady) {
      game.status = 'playing';
      db.prepare("UPDATE games SET status = 'playing' WHERE room_code = ?").run(game.roomCode);
      io.to(game.roomCode).emit('game_start', {
        totalQuestions: game.questions.length,
        players: game.players.map(p => ({ pseudo: p.pseudo, score: 0 })),
        options: game.options,
      });
      sendQuestion(game);
    }
  });

  // ── START GAME (host can force start with 2+ players) ──
  socket.on('force_start', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.hostPseudo !== game.players.find(p => p.socketId === socket.id)?.pseudo) return;
    if (game.players.length < 2) return socket.emit('error', 'Il faut au moins 2 joueurs !');
    if (game.status !== 'waiting') return;

    game.status = 'playing';
    game.players.forEach(p => p.ready = true);
    db.prepare("UPDATE games SET status = 'playing' WHERE room_code = ?").run(game.roomCode);
    io.to(game.roomCode).emit('game_start', {
      totalQuestions: game.questions.length,
      players: game.players.map(p => ({ pseudo: p.pseudo, score: 0 })),
      options: game.options,
    });
    sendQuestion(game);
  });

  // ── SUBMIT ANSWER ──
  socket.on('submit_answer', ({ answers, timeTaken }) => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || player.answered) return;
    player.answered = true;

    const q = game.questions[game.currentQuestion];
    const submitted = [...(answers || [])].sort().join(',');
    const correct = [...q.correct].sort().join(',');
    const isCorrect = submitted === correct;

    if (isCorrect) { player.score++; player.streak++; }
    else { player.streak = 0; }
    player.answers.push({ questionId: q.id, isCorrect, timeTaken: timeTaken || game.options.timeLimit });

    // In "examen" mode, no feedback during game
    const showFeedback = game.options.mode !== 'examen';
    socket.emit('answer_result', {
      isCorrect: showFeedback ? isCorrect : null,
      correctAnswers: showFeedback ? q.correct : [],
      explanation: showFeedback ? q.explanation : '',
      isTrap: showFeedback ? q.is_trap : false,
      trapMessage: showFeedback ? q.trap_message : null,
      streak: player.streak,
      score: player.score,
      hidden: !showFeedback,
    });

    // Broadcast scores to all
    io.to(game.roomCode).emit('scores_update', {
      players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })),
    });

    // If all answered, next question
    if (game.players.every(p => p.answered)) {
      if (game.questionTimer) clearTimeout(game.questionTimer);
      // In blitz mode, no delay between questions
      setTimeout(() => nextQuestion(game), game.options.mode === 'blitz' ? 1000 : 3000);
    }
  });

  // ── POWER-UP ──
  socket.on('use_powerup', ({ type }) => {
    const game = activeGames.get(socket.roomCode);
    if (!game || game.status !== 'playing') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || !player.powerups[type] || player.powerups[type] < 1) return;
    player.powerups[type]--;
    const q = game.questions[game.currentQuestion];

    if (type === 'fifty50') {
      const wrong = q.answers.filter(a => !q.correct.includes(a.id));
      const remove = wrong.sort(() => Math.random() - 0.5).slice(0, Math.min(2, wrong.length - 1));
      socket.emit('powerup_result', { type, removed: remove.map(a => a.id) });
    } else if (type === 'timeBonus') {
      socket.emit('powerup_result', { type, bonusSeconds: 15 });
    } else if (type === 'stress') {
      // Stress all opponents
      game.players.filter(p => p.socketId !== socket.id).forEach(op => {
        const opSock = io.sockets.sockets.get(op.socketId);
        if (opSock) opSock.emit('powerup_applied', { type: 'stress', penaltySeconds: 10, from: player.pseudo });
      });
      socket.emit('powerup_result', { type });
    }
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const game = activeGames.get(socket.roomCode);
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (game.status === 'playing') {
      io.to(game.roomCode).emit('player_disconnected', { pseudo: player.pseudo });
      // Remove player, if only 1 left end game
      game.players = game.players.filter(p => p.socketId !== socket.id);
      if (game.players.length < 2) {
        if (game.questionTimer) clearTimeout(game.questionTimer);
        setTimeout(() => endGame(game), 1500);
      }
    } else {
      game.players = game.players.filter(p => p.socketId !== socket.id);
      io.to(game.roomCode).emit('player_list_update', {
        players: game.players.map(p => ({ pseudo: p.pseudo, ready: p.ready })),
        maxPlayers: game.options.maxPlayers,
      });
      if (game.players.length === 0) activeGames.delete(game.roomCode);
    }
  });
});

// ── Game helpers ──────────────────────────────────────────────────────────────
function sendQuestion(game) {
  if (game.currentQuestion >= game.questions.length) return endGame(game);
  game.players.forEach(p => p.answered = false);
  game.questionStartTime = Date.now();

  const q = game.questions[game.currentQuestion];
  io.to(game.roomCode).emit('new_question', {
    index: game.currentQuestion,
    total: game.questions.length,
    id: q.id,
    category: q.category,
    question: q.question,
    answers: q.answers,
    isMultiple: q.correct.length > 1,
    isTrap: q.is_trap,
    timeLimit: game.options.timeLimit,
    mode: game.options.mode,
  });

  game.questionTimer = setTimeout(() => {
    game.players.filter(p => !p.answered).forEach(p => {
      p.answered = true;
      p.streak = 0;
      p.answers.push({ questionId: q.id, isCorrect: false, timeTaken: game.options.timeLimit });
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.emit('answer_result', {
          isCorrect: game.options.mode !== 'examen' ? false : null,
          correctAnswers: game.options.mode !== 'examen' ? q.correct : [],
          explanation: game.options.mode !== 'examen' ? q.explanation : '',
          isTrap: q.is_trap, trapMessage: q.trap_message,
          streak: 0, score: p.score, timeout: true,
          hidden: game.options.mode === 'examen',
        });
      }
    });
    io.to(game.roomCode).emit('scores_update', {
      players: game.players.map(p => ({ pseudo: p.pseudo, score: p.score, streak: p.streak, answered: p.answered })),
    });
    setTimeout(() => nextQuestion(game), game.options.mode === 'blitz' ? 800 : 2500);
  }, game.options.timeLimit * 1000);
}

function nextQuestion(game) {
  game.currentQuestion++;
  if (game.currentQuestion >= game.questions.length) endGame(game);
  else sendQuestion(game);
}

function endGame(game) {
  game.status = 'finished';
  if (game.questionTimer) clearTimeout(game.questionTimer);

  // Sort by score descending
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0]?.score > (ranked[1]?.score || -1) ? ranked[0].pseudo : null;

  // Elo update (1v1 only)
  let eloChanges = {};
  if (game.players.length === 2 && winner) {
    const [p1, p2] = ranked;
    if (p1.userId && p2.userId) {
      const u1 = db.prepare('SELECT elo FROM users WHERE id = ?').get(p1.userId);
      const u2 = db.prepare('SELECT elo FROM users WHERE id = ?').get(p2.userId);
      if (u1 && u2) {
        const delta = calcEloChange(u1.elo, u2.elo);
        eloChanges[p1.pseudo] = +delta;
        eloChanges[p2.pseudo] = -delta;
        db.prepare('UPDATE users SET elo = elo + ?, wins = wins + 1, total_games = total_games + 1 WHERE id = ?').run(delta, p1.userId);
        db.prepare('UPDATE users SET elo = MAX(100, elo - ?), losses = losses + 1, total_games = total_games + 1 WHERE id = ?').run(delta, p2.userId);
      }
    }
  }

  // Update stats for all registered players
  game.players.forEach(p => {
    if (p.userId) {
      db.prepare('UPDATE users SET total_correct = total_correct + ?, total_questions = total_questions + ? WHERE id = ?').run(p.score, game.questions.length, p.userId);
    }
  });

  // Build per-player results
  const results = ranked.map((p, i) => {
    const wrongQuestions = p.answers.map((a, idx) => ({ ...a, question: game.questions[idx] })).filter(a => !a.isCorrect);
    const categoryErrors = {};
    wrongQuestions.forEach(({ question }) => {
      if (question) categoryErrors[question.category] = (categoryErrors[question.category] || 0) + 1;
    });
    // In examen mode, reveal correct answers now
    const answersWithCorrect = game.options.mode === 'examen' ? p.answers.map((a, idx) => ({
      ...a,
      correctAnswers: game.questions[idx]?.correct,
      explanation: game.questions[idx]?.explanation,
    })) : null;
    return {
      rank: i + 1,
      pseudo: p.pseudo,
      score: p.score,
      total: game.questions.length,
      percentage: Math.round((p.score / game.questions.length) * 100),
      categoryErrors,
      eloChange: eloChanges[p.pseudo] || 0,
      answersWithCorrect,
    };
  });

  db.prepare("UPDATE games SET status = 'finished', player1_score = ?, player2_score = ?, winner_pseudo = ?, finished_at = datetime('now') WHERE room_code = ?")
    .run(ranked[0]?.score || 0, ranked[1]?.score || 0, winner, game.roomCode);

  io.to(game.roomCode).emit('game_end', { winner, isDraw: !winner, results, mode: game.options.mode });
  setTimeout(() => activeGames.delete(game.roomCode), 60000);
}

httpServer.listen(PORT, () => console.log(`🚗 Code Duel — port ${PORT}`));
