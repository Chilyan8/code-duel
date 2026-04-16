/**
 * Simple JSON file database — fonctionne partout sans compilation native.
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');

let store = { users: [], games: [], _nextUserId: 1, _nextGameId: 1 };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    else save();
  } catch { save(); }
}
function save() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (e) { console.error('DB save error:', e.message); }
}
load();
setInterval(save, 10000);

function getUser(pseudo) { return store.users.find(u => u.pseudo === pseudo) || null; }
function getUserById(id) { return store.users.find(u => u.id === id) || null; }
function createUser(pseudo, hash) {
  const id = store._nextUserId++;
  const user = { id, pseudo, password_hash: hash, elo: 1000, wins: 0, losses: 0, total_games: 0, total_correct: 0, total_questions: 0, created_at: new Date().toISOString() };
  store.users.push(user); save(); return { lastInsertRowid: id };
}
function updateUser(id, fields) {
  const u = getUserById(id); if (u) { Object.assign(u, fields); save(); }
}
function getGameByRoom(code) { return store.games.find(g => g.room_code === code) || null; }
function createGame(code, p1pseudo, p1id) {
  const id = store._nextGameId++;
  store.games.push({ id, room_code: code, player1_pseudo: p1pseudo, player1_id: p1id, player2_pseudo: null, player2_id: null, player1_score: 0, player2_score: 0, status: 'waiting', winner_pseudo: null, elo_change: 0, created_at: new Date().toISOString(), finished_at: null });
  save(); return { lastInsertRowid: id };
}
function updateGame(code, fields) {
  const g = getGameByRoom(code); if (g) { Object.assign(g, fields); save(); }
}
function getRecentGames(pseudo, limit = 5) {
  return store.games.filter(g => (g.player1_pseudo === pseudo || g.player2_pseudo === pseudo) && g.status === 'finished').sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at)).slice(0, limit);
}
function getLeaderboard(limit = 20) {
  return [...store.users].sort((a, b) => b.elo - a.elo).slice(0, limit).map(u => ({ pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses, total_games: u.total_games }));
}

// Simplified prepare API
const db = {
  prepare: (sql) => ({
    get: (...p) => {
      if (sql.includes('WHERE pseudo =')) return getUser(p[0]);
      if (sql.includes('WHERE id =') && sql.includes('users')) return getUserById(p[0]);
      if (sql.includes('room_code =') && sql.includes('games')) return getGameByRoom(p[0]);
      return null;
    },
    all: (...p) => {
      if (sql.includes('ORDER BY elo')) return getLeaderboard(parseInt(sql.match(/LIMIT (\d+)/)?.[1] || 20));
      if (sql.includes('finished')) return getRecentGames(p[0]);
      return [];
    },
    run: (...p) => {
      if (/INSERT INTO users/.test(sql)) return createUser(p[0], p[1]);
      if (/INSERT INTO games/.test(sql)) return createGame(p[0], p[1], p[2]);
      if (/UPDATE games SET player2_pseudo/.test(sql)) { updateGame(p[2], { player2_pseudo: p[0], player2_id: p[1] }); return {}; }
      if (/status = 'playing'/.test(sql)) { updateGame(p[0], { status: 'playing' }); return {}; }
      if (/status = 'finished'/.test(sql)) { updateGame(p[4], { status: 'finished', player1_score: p[0], player2_score: p[1], winner_pseudo: p[2], elo_change: p[3], finished_at: new Date().toISOString() }); return {}; }
      if (/elo = elo \+.*wins = wins/.test(sql)) { const u = getUserById(p[1]); if (u) updateUser(p[1], { elo: u.elo + p[0], wins: u.wins + 1, total_games: u.total_games + 1 }); return {}; }
      if (/elo = MAX.*losses = losses/.test(sql)) { const u = getUserById(p[1]); if (u) updateUser(p[1], { elo: Math.max(100, u.elo - p[0]), losses: u.losses + 1, total_games: u.total_games + 1 }); return {}; }
      if (/wins = wins \+ 1/.test(sql)) { const u = getUserById(p[0]); if (u) updateUser(p[0], { wins: u.wins + 1, total_games: u.total_games + 1 }); return {}; }
      if (/losses = losses \+ 1/.test(sql)) { const u = getUserById(p[0]); if (u) updateUser(p[0], { losses: u.losses + 1, total_games: u.total_games + 1 }); return {}; }
      if (/total_correct/.test(sql)) { const u = getUserById(p[2]); if (u) updateUser(p[2], { total_correct: u.total_correct + p[0], total_questions: u.total_questions + p[1] }); return {}; }
      return {};
    }
  }),
  pragma: () => {}, exec: () => {},
};

module.exports = db;
