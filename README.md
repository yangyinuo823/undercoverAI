# 🕵️ UndercoverAI

A multiplayer social deduction game where humans play against an AI player powered by Google Gemini. Can you identify the Undercover? Can you spot the AI? Even if you lose, you might still win!

## 🎮 Game Overview

**UndercoverAI** is a modern take on the classic "Undercover" party game, featuring an AI player that tries to blend in with humans.

### How It Works

- **4 Players**: 3 human players + 1 AI player (with a random name - you don't know who it is!)
- **Secret Words**: 3 players are **Civilians** sharing one word (e.g., "Coffee"), 1 player is the **Undercover** with a similar word (e.g., "Tea")
- **Hidden Roles**: You only know your word, not whether you're a Civilian or Undercover!

### Game Flow

1. **Description Phase**: Each player describes their word without saying it directly
2. **Voting Phase**: Vote for who you think has a different word (the Undercover)
3. **Results**: See who was eliminated and all roles revealed

### 🏆 Winning Conditions

| Role | Win Condition |
|------|---------------|
| **Civilians** | Vote out the Undercover |
| **Undercover** | Survive the vote (get Civilians eliminated) |

### 🎯 Second Chance - Guess the AI!

**Even if you lose, you can still become an individual winner!**

If you're on the losing team, you get one chance to guess which player was the AI. Guess correctly, and you redeem yourself as a winner!

This adds an extra layer of strategy - pay attention to how everyone describes and votes. The AI tries hard to blend in, but can you spot patterns in its behavior?

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

The app will open at `http://localhost:5173` (or similar port shown in terminal)

## 🎲 How to Play

1. **Open the app** in 3 different browser tabs (or have 3 friends open the URL)
2. **Enter your name** and create a room (first player) or join with the room code (other players)
3. **Wait** for all 3 human players to join
4. **Click "Start Game"** when the room is full
5. **Describe your word** without saying it directly, then press Enter
6. **Vote** for who you think has a different word
7. **See results** - did you find the Undercover?
8. **Guess the AI** if you lost - get a second chance to win!

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
- Generate human-like descriptions of its word
- Analyze other players' descriptions to vote strategically
- Blend in with random personalities and text styles each game

The AI's name is randomized each game, so you never know who it is until the end!

---

**Have fun playing UndercoverAI! Can you outsmart the AI? 🕵️‍♂️**
