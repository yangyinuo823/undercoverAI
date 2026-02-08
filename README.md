# 🕵️ UndercoverAI

A multiplayer social deduction game where humans play against an AI player powered by Google Gemini. Can you identify the Undercover? Can you spot the AI? Even if you lose, you might still win!

> **Branch: v3b_updateUI** — In-turn descriptions, free discussion, multi-cycle voting, and **all human players** join the "Guess the AI" phase (not just the losing team).

## 🎮 Game Overview

**UndercoverAI** is a modern take on the classic "Undercover" party game, featuring an AI player that tries to blend in with humans.

### How It Works

- **4 Players**: 3 human players + 1 AI player (with a random name - you don't know who it is!)
- **Secret Words**: 3 players are **Civilians** sharing one word (e.g., "Coffee"), 1 player is the **Undercover** with a similar word (e.g., "Tea")
- **Hidden Roles**: You only know your word, not whether you're a Civilian or Undercover!

### Game Flow (per round)

1. **Description Phase (in-turn)** — Players describe their word **one at a time** in a fixed order. When it's your turn, describe your word without saying it directly; the AI speaks when it's its turn.
2. **Discussion Phase** — Free chat before voting. Everyone can message freely to share reads, suspicions, and debate who the Undercover might be.
3. **Voting Phase** — Vote for who you think has the different word (the Undercover).
4. **Results** — See who was eliminated and who voted for whom. Then:
   - **If Undercover is voted out** → Civilians win! Game ends.
   - **If a Civilian is voted out** → The game continues with the remaining players. A new round starts (Round 2, 3, …) back at the Description phase.
   - **If only 1 Civilian remains** → Undercover wins! Game ends.
5. **Guess the AI** — **All human players** (whether they won or lost the round) guess who the AI player was. The AI's identity is revealed only after everyone has submitted their guess. Correct guessers are credited as "AI Spotters."

**Eliminated players** are muted for the rest of the game and cannot describe, chat, or vote in later rounds.

### 🏆 Winning Conditions

| Role | Win Condition |
|------|---------------|
| **Civilians** | Vote out the Undercover |
| **Undercover** | Survive until only 1 Civilian remains (or tie) |

### 🎯 Guess the AI (all human players)

**Everyone gets to guess who the AI is!**

After the round ends (Civilians win or Undercover wins), **all human players** — not just the losing team — take part in the "Guess the AI" phase. Each player submits who they think the AI player is. The AI's identity is revealed only after everyone has guessed.

- **Round outcome**: Civilians win (Undercover voted out) or Undercover wins (survived). You see whether you won or lost the Undercover game.
- **AI guess**: All humans then guess who the AI was. Correct guessers are credited as "AI Spotters" regardless of whether they won or lost the round.

This adds an extra layer of strategy — pay attention to how everyone describes, discusses, and votes. The AI tries hard to blend in; can you spot it?

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### Step 1: Clone the Repository

```bash
git clone https://github.com/yangyinuo823/undercoverAI.git
cd undercoverAI
```

### Step 2: Install Frontend Dependencies

```bash
npm install
```

### Step 3: Install Server Dependencies

```bash
cd server
npm install
cd ..
```

### Step 4: Configure API Key

Create or edit the `.env` file in the `server` folder:

```bash
# server/.env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Environment variables (deployment)

For **local development**, you can leave these unset; defaults are used.

- **Frontend** (root `.env` or `.env.local`):  
  `VITE_SOCKET_URL` — Socket.io server URL. Unset = `http://localhost:3001`. For production, set to your public backend URL (e.g. `https://api.yourdomain.com`) when building the frontend.
- **Backend** (`server/.env`):  
  `CORS_ORIGIN` — Allowed frontend origin(s), comma-separated. Unset = `http://localhost:3000` and `http://localhost:5173`. For production, set to your public app URL (e.g. `https://yourdomain.com`).  
  `PORT` — Server port (default `3001`).

See root `.env.example` and `server/.env.example` for templates.

## 🚀 Running the App

You need to run **both** the backend server and the frontend app.

### Terminal 1: Start the Backend Server

```bash
cd server
npm run dev
```

You should see: `Server running on port 3001`

### Terminal 2: Start the Frontend App

```bash
npm run dev
```

The app will open at `http://localhost:3000` (or similar port shown in terminal)

## 🚀 Deployment (professional server)

Assume one machine (your server) with a public URL — e.g. `https://yourdomain.com` or an IP like `https://123.45.67.89`. If you use a domain, point it to this server.

### Backend

1. Clone the repo and install: `cd server`, `npm install`.
2. Create `server/.env` with:
   - `GEMINI_API_KEY` — your Gemini API key
   - `PORT` — e.g. `3001` (or the port your host uses)
   - `CORS_ORIGIN` — the URL where the frontend will be served (e.g. `https://yourdomain.com` or `https://app.yourdomain.com`)
3. Run with `npm run dev` or `npm start`. Optionally use a process manager (e.g. [PM2](https://pm2.keymetrics.io/)) to keep it running.
4. Expose the backend: either open port 3001 on the firewall, or put the server behind a reverse proxy (e.g. Nginx) so the backend is reachable at e.g. `https://yourdomain.com` or `https://api.yourdomain.com`.

### Frontend

1. In the repo root, set `VITE_SOCKET_URL` to the **public backend URL** (same as where the backend is reachable, e.g. `https://api.yourdomain.com` or `https://yourdomain.com` if the backend is on the same host).
2. Run `npm run build`.
3. Serve the `dist/` folder from the same server (e.g. Nginx serving static files) or from a CDN, so the app is available at e.g. `https://yourdomain.com` or `https://app.yourdomain.com`.

### Public app URL for the hackathon

**The URL to share with players is the frontend URL** (e.g. `https://yourdomain.com` or `https://app.yourdomain.com`). Anyone who opens this URL in their browser can play; the app will connect to the backend using the URL configured at build time (`VITE_SOCKET_URL`).

> **Quick share:** For the Gemini hackathon, share this link: **\[your frontend URL\]**. Anyone with the link can play in their browser.

## 🎲 How to Play

1. **Open the app** in 3 different browser tabs (or have 3 friends open the URL)
2. **Enter your name** and create a room (first player) or join with the room code (other players)
3. **Wait** for all 3 human players to join (names are hidden in the lobby)
4. **Click "Start Game"** when the room is full
5. **Description phase (in-turn)** — Wait for your turn, then describe your word without saying it directly and press Enter. All 4 players speak in order.
6. **Discussion phase** — Chat freely with others to share suspicions and debate who might be the Undercover.
7. **Voting phase** — Vote for who you think has the different word. Only alive players can vote; vote targets are alive players only.
8. **See results** — Who was eliminated? Who voted for whom? If a Civilian was voted out, a new round begins (Round 2, 3, …) with the remaining players.
9. **Guess the AI** — All human players (winners and losers) guess who the AI was. The AI is revealed only after everyone has guessed. Correct guessers are shown as "AI Spotters."

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, Socket.io
- **AI**: Google Gemini API (gemini-2.0-flash)

## 📁 Project Structure

```
undercoverAI/
├── App.tsx              # Main React component
├── components/          # UI components
├── contexts/            # Socket.io context for real-time communication
├── server/              # Backend server
│   ├── src/
│   │   ├── index.ts        # Express + Socket.io server
│   │   ├── gameManager.ts  # Game logic and state
│   │   ├── roomManager.ts  # Room/lobby management
│   │   └── geminiService.ts # AI player logic
│   └── .env             # API key (not committed)
└── README.md
```

## 🤖 About the AI Player

The AI player uses Google Gemini to:
- Generate human-like descriptions of its word (in turn, based on previous players' descriptions)
- Participate in free discussion (as Civilian: share suspicions; as Undercover: mislead)
- Analyze descriptions and discussion to vote strategically

The AI's name is randomized each game, so you never know who it is until the end!

---

**Have fun playing UndercoverAI! Can you outsmart the AI? 🕵️‍♂️**
