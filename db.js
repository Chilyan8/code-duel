/**
 * DB hybride : Firebase Firestore si FIREBASE_CREDENTIALS défini, sinon JSON local.
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// ── JSON fallback ────────────────────────────────────────────────────────────
let store = { users: [], games: [], _nextId: 1 };

function loadJSON() {
  try {
    if (fs.existsSync(DB_FILE)) store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    else saveJSON();
  } catch { saveJSON(); }
}
function saveJSON() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (e) { console.error('DB save error:', e.message); }
}

// ── Firebase ─────────────────────────────────────────────────────────────────
let db = null;
let useFirebase = false;

async function initFirebase() {
  const creds = process.env.FIREBASE_CREDENTIALS;
  if (!creds) return false;
  try {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(creds);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
    useFirebase = true;
    console.log('✅ Firebase Firestore connecté');
    return true;
  } catch (e) {
    console.error('❌ Firebase erreur:', e.message);
    return false;
  }
}

// ── Unified API ──────────────────────────────────────────────────────────────
const database = {

  async init() {
    const ok = await initFirebase();
    if (!ok) {
      loadJSON();
      setInterval(saveJSON, 10000);
      console.log('⚠️  Stockage JSON local (comptes non persistants entre redémarrages)');
    }
  },

  // ── USERS ──────────────────────────────────────────────────────────────────
  async getUser(pseudo) {
    if (useFirebase) {
      const snap = await db.collection('users').where('pseudo', '==', pseudo).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return store.users.find(u => u.pseudo === pseudo) || null;
  },

  async getUserById(id) {
    if (useFirebase) {
      const doc = await db.collection('users').doc(id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }
    return store.users.find(u => u.id == id) || null;
  },

  async createUser(pseudo, passwordHash) {
    if (useFirebase) {
      const ref = await db.collection('users').add({
        pseudo, password_hash: passwordHash,
        elo: 1000, wins: 0, losses: 0,
        total_games: 0, total_correct: 0, total_questions: 0,
        created_at: new Date().toISOString()
      });
      return { lastInsertRowid: ref.id, id: ref.id };
    }
    const id = store._nextId++;
    store.users.push({ id, pseudo, password_hash: passwordHash, elo: 1000, wins: 0, losses: 0, total_games: 0, total_correct: 0, total_questions: 0 });
    saveJSON();
    return { lastInsertRowid: id, id };
  },

  async updateUser(id, inc = {}, set = {}) {
    if (useFirebase) {
      const admin = require('firebase-admin');
      const updates = { ...set };
      Object.entries(inc).forEach(([k, v]) => {
        updates[k] = admin.firestore.FieldValue.increment(v);
      });
      await db.collection('users').doc(id).update(updates);
      return;
    }
    const u = store.users.find(u => u.id == id);
    if (!u) return;
    Object.entries(inc).forEach(([k, v]) => { u[k] = (u[k] || 0) + v; });
    Object.assign(u, set);
    saveJSON();
  },

  async getLeaderboard(limit = 20) {
    if (useFirebase) {
      const snap = await db.collection('users').orderBy('elo', 'desc').limit(limit).get();
      return snap.docs.map(d => {
        const data = d.data();
        return { pseudo: data.pseudo, elo: data.elo, wins: data.wins, losses: data.losses, total_games: data.total_games };
      });
    }
    return [...store.users].sort((a, b) => b.elo - a.elo).slice(0, limit)
      .map(u => ({ pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses, total_games: u.total_games }));
  },

  // ── GAMES ──────────────────────────────────────────────────────────────────
  async createGame(roomCode, player1Pseudo) {
    if (useFirebase) {
      await db.collection('games').doc(roomCode).set({ room_code: roomCode, player1_pseudo: player1Pseudo, status: 'waiting', created_at: new Date().toISOString() });
    }
    return { lastInsertRowid: roomCode };
  },

  async updateGame(roomCode, fields) {
    if (useFirebase) {
      await db.collection('games').doc(roomCode).update(fields);
      return;
    }
    const g = store.games?.find(g => g.room_code === roomCode);
    if (g) Object.assign(g, fields);
    saveJSON();
  },
};

module.exports = database;
