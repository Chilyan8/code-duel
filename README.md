# 🚗 Code Duel — Révise le code de la route en duel 1v1

Un site web complet pour réviser le code de la route français sous forme de duels 1v1 en temps réel.

## ✨ Fonctionnalités

- ⚔️ **Duel 1v1 en temps réel** via Socket.io (code à partager)
- 👤 **Comptes utilisateurs** + mode invité
- 🎯 **70+ questions** du code de la route français (panneaux, priorités, alcool, vitesses...)
- 🔥 **Système de streak** (enchaîne les bonnes réponses)
- ⚡ **Power-ups** : 50/50, +15s, Stress adverse
- 🧑‍🏫 **Coach virtuel** avec conseils humoristiques
- 😏 **Questions pièges** avec messages fun
- 🏆 **Classement Elo** (comme aux échecs !)
- 📊 **Analyse des erreurs** par thème en fin de partie
- 🎵 Sons interactifs + animations

## 🚀 Déploiement en ligne (GitHub + Render.com)

### Étape 1 — Préparer ton dépôt GitHub

```bash
# Dans le dossier du projet
git init
git add .
git commit -m "🚗 Initial commit — Code Duel"
```

Puis sur [github.com/new](https://github.com/new) :
- Créer un nouveau dépôt (ex: `code-duel`)
- **Ne pas** initialiser avec README

```bash
git remote add origin https://github.com/TON_USERNAME/code-duel.git
git branch -M main
git push -u origin main
```

### Étape 2 — Déployer sur Render.com (gratuit)

1. Va sur [render.com](https://render.com) → **Sign up** avec ton compte GitHub
2. Clique **New → Web Service**
3. Connecte ton repo `code-duel`
4. Render détecte automatiquement le `render.yaml`
5. Clique **Create Web Service**
6. ⏳ Le déploiement prend ~2 minutes

🎉 **Ton site est en ligne !** Tu obtiens une URL du type `https://code-duel.onrender.com`

> ⚠️ Le plan gratuit de Render "endort" l'appli après 15 min d'inactivité. Le premier chargement peut prendre 30-60s. Pour éviter ça, utilise [UptimeRobot](https://uptimerobot.com) (gratuit) pour pinger ton URL toutes les 10 min.

### Variables d'environnement (optionnel)

Sur Render, dans **Environment** :
- `JWT_SECRET` : une chaîne aléatoire longue (auto-générée par render.yaml)
- `PORT` : 3000 (déjà géré automatiquement)

## 🛠️ Lancer en local

```bash
# Installer les dépendances
npm install

# Démarrer le serveur
npm start
# ou en mode développement (hot reload) :
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000)

## 📁 Structure du projet

```
code-duel/
├── server.js          # Serveur Express + Socket.io + logique de jeu
├── db.js              # Couche base de données (Firebase ou mémoire)
├── data/
│   └── questions.json # 70+ questions du code de la route
├── public/
│   ├── index.html     # Application SPA
│   ├── css/style.css  # Design gaming
│   └── js/app.js      # Logique frontend + Socket.io client
├── package.json
├── render.yaml        # Config déploiement Render.com
└── .gitignore
```

## 🎮 Comment jouer

1. **Créer une partie** → Un code à 6 caractères est généré
2. **Partager le code** à ton ami
3. **Les deux joueurs cliquent "Prêt"**
4. **40 questions**, 30 secondes chacune
5. **Réponds**, utilise tes power-ups, bats ton adversaire !
6. **Résultats** : scores, erreurs par thème, changement Elo

## 🏗️ Tech Stack

- **Backend** : Node.js + Express + Socket.io
- **Base de données** : Firebase Firestore (+ fallback mémoire si non configuré)
- **Auth** : JWT + bcrypt
- **Frontend** : Vanilla HTML/CSS/JS (SPA)
- **Déploiement** : Render.com (gratuit)
