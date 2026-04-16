/**
 * DB hybride : Firebase Firestore si FIREBASE_CREDENTIALS défini, sinon mémoire pure.
 */
const store = { users: [], _nextId: 1 };
let firestore = null;
let useFirebase = false;

async function initFirebase() {
  const creds = process.env.FIREBASE_CREDENTIALS;
  if (!creds) return false;
  try {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(creds);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firestore = admin.firestore();
    useFirebase = true;
    console.log('✅ Firebase connecté');
    return true;
  } catch (e) { console.error('❌ Firebase:', e.message); return false; }
}

const db = {
  async init() {
    const ok = await initFirebase();
    if (!ok) console.log('⚠️  Mode mémoire — configure FIREBASE_CREDENTIALS pour persister les comptes.');
  },

  async getUser(pseudo) {
    try {
      if (useFirebase) {
        const snap = await firestore.collection('users').where('pseudo', '==', pseudo).limit(1).get();
        if (snap.empty) return null;
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
      return store.users.find(u => u.pseudo === pseudo) || null;
    } catch (e) { console.error('getUser:', e.message); return store.users.find(u => u.pseudo === pseudo) || null; }
  },

  async getUserById(id) {
    try {
      if (useFirebase) {
        const doc = await firestore.collection('users').doc(String(id)).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
      }
      return store.users.find(u => String(u.id) === String(id)) || null;
    } catch (e) { return store.users.find(u => String(u.id) === String(id)) || null; }
  },

  async createUser(pseudo, passwordHash) {
    if (useFirebase) {
      const ref = await firestore.collection('users').add({
        pseudo, password_hash: passwordHash,
        elo: 1000, wins: 0, losses: 0, draws: 0,
        total_games: 0, total_correct: 0, total_questions: 0,
        category_stats: {}, badges: [], level: 1,
        created_at: new Date().toISOString()
      });
      return { id: ref.id };
    }
    const id = store._nextId++;
    store.users.push({ id, pseudo, password_hash: passwordHash, elo: 1000, wins: 0, losses: 0, total_games: 0, total_correct: 0, total_questions: 0, category_stats: {}, badges: [], level: 1 });
    return { id };
  },

  async updateUser(id, inc = {}, set = {}) {
    try {
      if (useFirebase) {
        const admin = require('firebase-admin');
        const updates = { ...set };
        Object.entries(inc).forEach(([k, v]) => { updates[k] = admin.firestore.FieldValue.increment(v); });
        await firestore.collection('users').doc(String(id)).update(updates);
        return;
      }
      const u = store.users.find(u => String(u.id) === String(id));
      if (!u) return;
      Object.entries(inc).forEach(([k, v]) => { u[k] = (u[k] || 0) + v; });
      Object.assign(u, set);
    } catch (e) { console.error('updateUser:', e.message); }
  },

  async updateCategoryStats(id, categoryErrors) {
    // categoryErrors = { priorites: 2, panneaux: 1, ... }
    try {
      if (useFirebase) {
        const admin = require('firebase-admin');
        const updates = {};
        Object.entries(categoryErrors).forEach(([cat, errors]) => {
          updates[`category_stats.${cat}.errors`] = admin.firestore.FieldValue.increment(errors);
          updates[`category_stats.${cat}.sessions`] = admin.firestore.FieldValue.increment(1);
        });
        if (Object.keys(updates).length > 0)
          await firestore.collection('users').doc(String(id)).update(updates);
        return;
      }
      const u = store.users.find(u => String(u.id) === String(id));
      if (!u) return;
      if (!u.category_stats) u.category_stats = {};
      Object.entries(categoryErrors).forEach(([cat, errors]) => {
        if (!u.category_stats[cat]) u.category_stats[cat] = { errors: 0, sessions: 0 };
        u.category_stats[cat].errors += errors;
        u.category_stats[cat].sessions += 1;
      });
    } catch (e) { console.error('updateCategoryStats:', e.message); }
  },

  async addBadge(id, badge) {
    try {
      if (useFirebase) {
        const admin = require('firebase-admin');
        await firestore.collection('users').doc(String(id)).update({
          badges: admin.firestore.FieldValue.arrayUnion(badge)
        });
        return;
      }
      const u = store.users.find(u => String(u.id) === String(id));
      if (u && u.badges && !u.badges.includes(badge)) u.badges.push(badge);
    } catch (e) { console.error('addBadge:', e.message); }
  },

  async getLeaderboard(limit = 20) {
    try {
      if (useFirebase) {
        const snap = await firestore.collection('users').orderBy('elo', 'desc').limit(limit).get();
        return snap.docs.map(d => { const data = d.data(); return { pseudo: data.pseudo, elo: data.elo, wins: data.wins || 0, losses: data.losses || 0, total_games: data.total_games || 0, level: data.level || 1, badges: data.badges || [] }; });
      }
      return [...store.users].sort((a, b) => b.elo - a.elo).slice(0, limit).map(u => ({ pseudo: u.pseudo, elo: u.elo, wins: u.wins || 0, losses: u.losses || 0, total_games: u.total_games || 0, level: u.level || 1 }));
    } catch (e) { console.error('getLeaderboard:', e.message); return []; }
  },

  async createGame(roomCode, player1Pseudo) {
    try {
      if (useFirebase) await firestore.collection('games').doc(roomCode).set({ room_code: roomCode, player1_pseudo: player1Pseudo, status: 'waiting', created_at: new Date().toISOString() });
    } catch (e) { console.error('createGame:', e.message); }
    return { id: roomCode };
  },

  async updateGame(roomCode, fields) {
    try {
      if (useFirebase) await firestore.collection('games').doc(roomCode).update(fields);
    } catch (e) { console.error('updateGame:', e.message); }
  },
};

module.exports = db;
