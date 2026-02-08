import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { roomManager } from './roomManager';
import { gameManager, GamePhase, AI_PLAYER_ID, Role } from './gameManager';
import { generateAIDescription, generateAIVote, generateAIDiscussionMessage } from './geminiService';

const app = express();
const httpServer = createServer(app);

// Configure CORS for the frontend
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

// Discussion phase: messages and timers per room
const DISCUSSION_DURATION_MS = 30000;
const MAX_DISCUSSION_MESSAGE_LENGTH = 200;
const discussionMessagesByRoom = new Map<string, Array<{ playerId: string; playerName: string; message: string; timestamp: number }>>();
const discussionTimersByRoom = new Map<string, NodeJS.Timeout>();
const aiDiscussionTimeoutsByRoom = new Map<string, NodeJS.Timeout[]>();
const lastAiDiscussionAttemptByRoom = new Map<string, number>();
const MIN_MS_BETWEEN_AI_DISCUSSION_ATTEMPTS = 6000;
const AI_TYPING_DELAY_MS_PER_CHAR = 50;
const AI_TYPING_DELAY_MIN_MS = 2000;
const AI_TYPING_DELAY_MAX_MS = 10000;
const AI_RESPONSE_TO_HUMAN_DELAY_MIN_MS = 5000;
const AI_RESPONSE_TO_HUMAN_DELAY_MAX_MS = 10000;

function clearAIDiscussionTimeouts(roomCode: string): void {
  const timeouts = aiDiscussionTimeoutsByRoom.get(roomCode);
  if (timeouts) {
    timeouts.forEach(t => clearTimeout(t));
    aiDiscussionTimeoutsByRoom.delete(roomCode);
  }
  lastAiDiscussionAttemptByRoom.delete(roomCode);
}

async function tryAIDiscussionMessage(roomCode: string): Promise<void> {
  const game = gameManager.getGame(roomCode);
  if (!game || game.phase !== GamePhase.DISCUSSION) return;
  if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) return;
  const aiPlayer = gameManager.getAIPlayer(roomCode);
  const aiPersona = gameManager.getAIPersona(roomCode);
  if (!aiPlayer || !aiPersona) return;

  const list = discussionMessagesByRoom.get(roomCode) || [];
  const aiMessageCount = list.filter(m => m.playerId === AI_PLAYER_ID).length;
  if (aiMessageCount >= 2) return;

  lastAiDiscussionAttemptByRoom.set(roomCode, Date.now());

  const allDescriptions = gameManager.getAllDescriptions(roomCode);
  const discussionTranscript = list.map(m => ({ playerName: m.playerName, message: m.message }));
  const otherPlayerNames = Array.from(game.players.values())
    .filter(p => p.id !== AI_PLAYER_ID)
    .map(p => p.name);
  const isUndercover = aiPlayer.role === Role.UNDERCOVER;

  try {
    const response = await generateAIDiscussionMessage(
      aiPlayer.word,
      aiPlayer.name,
      otherPlayerNames,
      aiPersona,
      isUndercover,
      allDescriptions.map(d => ({ playerName: d.playerName, description: d.description })),
      discussionTranscript
    );
    const content = (response.content || '').trim();
    if (!content) return;

    const typingDelayMs = Math.min(AI_TYPING_DELAY_MAX_MS, Math.max(AI_TYPING_DELAY_MIN_MS, AI_TYPING_DELAY_MIN_MS + AI_TYPING_DELAY_MS_PER_CHAR * content.length));
    await new Promise<void>(r => setTimeout(r, typingDelayMs));

    const g = gameManager.getGame(roomCode);
    if (!g || g.phase !== GamePhase.DISCUSSION) return;
    const messages = discussionMessagesByRoom.get(roomCode) || [];
    const entry = { playerId: AI_PLAYER_ID, playerName: aiPlayer.name, message: content.slice(0, MAX_DISCUSSION_MESSAGE_LENGTH), timestamp: Date.now() };
    messages.push(entry);
    discussionMessagesByRoom.set(roomCode, messages);
    io.to(roomCode).emit('discussion-message', entry);
  } catch (err) {
    console.error('AI discussion message failed:', err);
  }
}

function scheduleAIDiscussionAttempts(roomCode: string, startedAt: number): void {
  clearAIDiscussionTimeouts(roomCode);
  const timeouts: NodeJS.Timeout[] = [];

  const firstDelay = 5000 + Math.random() * 7000;
  const t1 = setTimeout(() => {
    tryAIDiscussionMessage(roomCode);
    const secondDelay = 10000 + Math.random() * 10000;
    const t2 = setTimeout(() => tryAIDiscussionMessage(roomCode), secondDelay);
    timeouts.push(t2);
  }, firstDelay);
  timeouts.push(t1);

  aiDiscussionTimeoutsByRoom.set(roomCode, timeouts);
}

function endDiscussionPhase(roomCode: string): void {
  const game = gameManager.getGame(roomCode);
  if (!game || game.phase !== GamePhase.DISCUSSION) return;
  clearAIDiscussionTimeouts(roomCode);
  const timer = discussionTimersByRoom.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    discussionTimersByRoom.delete(roomCode);
  }
  gameManager.setPhase(roomCode, GamePhase.VOTING);
  io.to(roomCode).emit('discussion-phase-ended', {});
  io.to(roomCode).emit('game-phase-changed', {
    phase: GamePhase.VOTING,
    message: 'Voting Phase! Vote for who you think has a different word.',
  });
  const g = gameManager.getGame(roomCode);
  if (g) {
    for (const [playerId, p] of g.players) {
      if (p.isHuman) {
        const playerView = gameManager.getPlayerView(roomCode, playerId, false);
        if (playerView) io.to(playerId).emit('game-state-updated', playerView);
      }
    }
  }
  console.log(`Discussion ended for room ${roomCode}, voting started`);
}

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Serve test page
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '../test.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (playerName: string) => {
    console.log(`${playerName} is creating a room...`);
    
    const room = roomManager.createRoom(socket.id, playerName);
    
    // Join the socket to the room channel
    socket.join(room.code);
    
    // Emit room created event to the creator
    socket.emit('room-created', {
      roomCode: room.code,
      players: roomManager.getPlayersInRoom(room.code),
      playersNeeded: roomManager.getPlayersNeeded(room.code),
    });

    console.log(`Room ${room.code} created by ${playerName}`);
  });

  // Join an existing room
  socket.on('join-room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    console.log(`${playerName} is trying to join room ${roomCode}...`);
    
    const result = roomManager.joinRoom(roomCode, socket.id, playerName);
    
    if (!result.success) {
      socket.emit('join-error', { error: result.error });
      return;
    }

    // Join the socket to the room channel
    socket.join(roomCode.toUpperCase());
    
    const players = roomManager.getPlayersInRoom(roomCode);
    const playersNeeded = roomManager.getPlayersNeeded(roomCode);
    const isRoomFull = roomManager.isRoomFull(roomCode);

    // Emit to the player who joined
    socket.emit('player-joined', {
      roomCode: roomCode.toUpperCase(),
      players,
      playersNeeded,
      isRoomFull,
    });

    // Emit to all other players in the room
    socket.to(roomCode.toUpperCase()).emit('player-joined', {
      roomCode: roomCode.toUpperCase(),
      players,
      playersNeeded,
      isRoomFull,
    });

    // If still waiting for players, emit waiting status
    if (!isRoomFull) {
      io.to(roomCode.toUpperCase()).emit('waiting-for-players', {
        roomCode: roomCode.toUpperCase(),
        players,
        playersNeeded,
      });
    } else {
      // Room is full, ready to start
      io.to(roomCode.toUpperCase()).emit('room-ready', {
        roomCode: roomCode.toUpperCase(),
        players,
      });
    }

    console.log(`${playerName} joined room ${roomCode}. Players: ${players.length}/3`);
  });

  // Get room info
  socket.on('get-room-info', (roomCode: string) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      socket.emit('room-info', { error: 'Room not found' });
      return;
    }

    socket.emit('room-info', {
      roomCode: room.code,
      players: roomManager.getPlayersInRoom(roomCode),
      playersNeeded: roomManager.getPlayersNeeded(roomCode),
      isRoomFull: roomManager.isRoomFull(roomCode),
    });
  });

  // ============ GAME EVENTS ============

  // Start the game
  socket.on('start-game', (roomCode: string) => {
    console.log(`Starting game for room ${roomCode}...`);
    
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      socket.emit('game-error', { error: 'Room not found' });
      return;
    }

    if (!roomManager.isRoomFull(roomCode)) {
      socket.emit('game-error', { error: 'Need 3 players to start' });
      return;
    }

    // Get human players from room
    const humanPlayers = roomManager.getPlayersInRoom(roomCode).map(p => ({
      id: p.id,
      name: p.name,
    }));

    // Create game state with roles assigned
    const gameState = gameManager.startGame(roomCode, humanPlayers);
    if (!gameState) {
      socket.emit('game-error', { error: 'Failed to start game' });
      return;
    }

    // Send each player their own view (with turn order)
    for (const [playerId, player] of gameState.players) {
      if (player.isHuman) {
        const playerView = gameManager.getPlayerView(roomCode, playerId, false);
        if (playerView) {
          io.to(playerId).emit('game-started', playerView);
          console.log(`Sent game view to ${player.name}: Role=${playerView.myRole}, Word=${playerView.myWord}`);
        }
      }
    }

    // Emit first turn (turn-based description)
    let firstTurnId = gameManager.getCurrentTurnPlayerId(roomCode);
    let nextTurnId = gameManager.getNextTurnPlayerId(roomCode);
    const firstPlayer = firstTurnId ? gameState.players.get(firstTurnId) : null;
    let nextPlayer = nextTurnId ? gameState.players.get(nextTurnId) : null;
    io.to(roomCode).emit('description-turn-started', {
      currentTurnPlayerId: firstTurnId,
      currentTurnPlayerName: firstPlayer?.name,
      nextTurnPlayerId: nextTurnId ?? null,
      nextTurnPlayerName: nextPlayer?.name ?? null,
      transcript: [],
      aiThinking: firstTurnId === AI_PLAYER_ID,
    });

    io.to(roomCode).emit('game-phase-changed', {
      phase: GamePhase.DESCRIPTION,
      message: 'Turn-based descriptions! Wait for your turn, then describe your word.',
    });

    // If first turn is AI, run AI turn(s) immediately (skip if AI eliminated)
    if (firstTurnId === AI_PLAYER_ID) {
      (async () => {
        let nextPlayerId: string | null = firstTurnId;
        while (nextPlayerId === AI_PLAYER_ID) {
          const game = gameManager.getGame(roomCode);
          if (!game) return;
          if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) {
            nextPlayerId = gameManager.advanceDescriptionTurn(roomCode);
            continue;
          }
          const aiPlayer = gameManager.getAIPlayer(roomCode);
          const aiPersona = gameManager.getAIPersona(roomCode);
          if (!aiPlayer || !aiPersona) {
            io.to(roomCode).emit('game-error', { error: 'AI configuration error' });
            return;
          }
          try {
            const otherPlayerNames = Array.from(game.players.values())
              .filter(p => p.id !== AI_PLAYER_ID)
              .map(p => p.name);
            const turnIndex = gameManager.getGame(roomCode)!.descriptionTurnIndex;
            const previousDescriptions = gameManager.getDescriptionsSoFar(roomCode);
            const isUndercover = aiPlayer.role === Role.UNDERCOVER;
            const aiResponse = await generateAIDescription(
              aiPlayer.word, aiPlayer.name, otherPlayerNames, aiPersona, isUndercover,
              turnIndex, previousDescriptions
            );
            gameManager.submitDescription(roomCode, AI_PLAYER_ID, aiResponse.content);
            io.to(roomCode).emit('player-submitted-description', {
              playerId: AI_PLAYER_ID,
              playerName: aiPlayer.name,
              description: aiResponse.content,
            });
            nextPlayerId = gameManager.advanceDescriptionTurn(roomCode);
          } catch (err) {
            console.error('Error generating AI description:', err);
            io.to(roomCode).emit('game-error', { error: 'AI failed to generate description' });
            return;
          }
        }
        const game = gameManager.getGame(roomCode);
        if (!game) return;
        if (nextPlayerId) {
          const nextP = game.players.get(nextPlayerId);
          const afterNextId = gameManager.getNextTurnPlayerId(roomCode);
          const afterNextP = afterNextId ? game.players.get(afterNextId) : null;
          io.to(roomCode).emit('description-turn-started', {
            currentTurnPlayerId: nextPlayerId,
            currentTurnPlayerName: nextP?.name,
            nextTurnPlayerId: afterNextId ?? null,
            nextTurnPlayerName: afterNextP?.name ?? null,
            transcript: gameManager.getDescriptionsSoFar(roomCode),
            aiThinking: false,
          });
        } else {
          setTimeout(() => {
            gameManager.setPhase(roomCode, GamePhase.DISCUSSION);
            discussionMessagesByRoom.set(roomCode, []);
            const startedAt = Date.now();
            io.to(roomCode).emit('description-phase-complete', { transcript: gameManager.getDescriptionsSoFar(roomCode) });
            const allDescriptions = gameManager.getAllDescriptions(roomCode);
            io.to(roomCode).emit('all-descriptions-revealed', {
              descriptions: allDescriptions.map(d => ({ playerId: d.playerId, playerName: d.playerName, description: d.description })),
            });
            io.to(roomCode).emit('discussion-phase-started', { startedAt, durationMs: DISCUSSION_DURATION_MS, roomCode });
            scheduleAIDiscussionAttempts(roomCode, startedAt);
            const g = gameManager.getGame(roomCode);
            if (g) {
              for (const [playerId, p] of g.players) {
                if (p.isHuman) {
                  const playerView = gameManager.getPlayerView(roomCode, playerId, false);
                  if (playerView) io.to(playerId).emit('game-state-updated', playerView);
                }
              }
            }
            const t = setTimeout(() => endDiscussionPhase(roomCode), DISCUSSION_DURATION_MS);
            discussionTimersByRoom.set(roomCode, t);
            console.log(`Description phase complete for room ${roomCode}, discussion started (30s)`);
          }, 1000);
        }
      })();
    }
  });

  // Submit description (turn-based: only current turn player can submit)
  socket.on('submit-description', async ({ roomCode, description }: { roomCode: string; description: string }) => {
    console.log(`${socket.id} submitting description for room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }
    if (!gameManager.isPlayerAlive(roomCode, socket.id)) {
      socket.emit('game-error', { error: 'You have been eliminated and cannot act.' });
      return;
    }

    const success = gameManager.submitDescription(roomCode, socket.id, description);
    if (!success) {
      socket.emit('game-error', { error: 'Not your turn or invalid submission' });
      return;
    }

    const player = game.players.get(socket.id);
    // Append to transcript: emit so all clients can show it
    io.to(roomCode).emit('player-submitted-description', {
      playerId: socket.id,
      playerName: player?.name,
      description,
    });

    // Advance to next turn
    let nextPlayerId = gameManager.advanceDescriptionTurn(roomCode);

    // If next turn is AI, run AI turn(s) until next is human or phase complete (skip if AI eliminated)
    while (nextPlayerId === AI_PLAYER_ID) {
      if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) {
        nextPlayerId = gameManager.advanceDescriptionTurn(roomCode);
        continue;
      }
      io.to(roomCode).emit('description-turn-started', {
        currentTurnPlayerId: AI_PLAYER_ID,
        currentTurnPlayerName: game.players.get(AI_PLAYER_ID)?.name,
        nextTurnPlayerId: null,
        nextTurnPlayerName: null,
        transcript: gameManager.getDescriptionsSoFar(roomCode),
        aiThinking: true,
      });

      const aiPlayer = gameManager.getAIPlayer(roomCode);
      const aiPersona = gameManager.getAIPersona(roomCode);
      if (!aiPlayer || !aiPersona) {
        io.to(roomCode).emit('game-error', { error: 'AI configuration error' });
        return;
      }

      try {
        const otherPlayerNames = Array.from(game.players.values())
          .filter(p => p.id !== AI_PLAYER_ID)
          .map(p => p.name);
        const turnIndex = gameManager.getGame(roomCode)!.descriptionTurnIndex; // current index is now AI's turn
        const previousDescriptions = gameManager.getDescriptionsSoFar(roomCode);
        const isUndercover = aiPlayer.role === Role.UNDERCOVER;

        const aiResponse = await generateAIDescription(
          aiPlayer.word,
          aiPlayer.name,
          otherPlayerNames,
          aiPersona,
          isUndercover,
          turnIndex,
          previousDescriptions
        );

        gameManager.submitDescription(roomCode, AI_PLAYER_ID, aiResponse.content);
        io.to(roomCode).emit('player-submitted-description', {
          playerId: AI_PLAYER_ID,
          playerName: aiPlayer.name,
          description: aiResponse.content,
        });
        nextPlayerId = gameManager.advanceDescriptionTurn(roomCode);
      } catch (error) {
        console.error('Error generating AI description:', error);
        io.to(roomCode).emit('game-error', { error: 'AI failed to generate description' });
        return;
      }
    }

    if (nextPlayerId) {
      // Next turn is a human
      const nextPlayer = gameManager.getGame(roomCode)?.players.get(nextPlayerId);
      const afterNextId = gameManager.getNextTurnPlayerId(roomCode);
      const afterNextPlayer = afterNextId ? gameManager.getGame(roomCode)?.players.get(afterNextId) : null;
      io.to(roomCode).emit('description-turn-started', {
        currentTurnPlayerId: nextPlayerId,
        currentTurnPlayerName: nextPlayer?.name,
        nextTurnPlayerId: afterNextId ?? null,
        nextTurnPlayerName: afterNextPlayer?.name ?? null,
        transcript: gameManager.getDescriptionsSoFar(roomCode),
        aiThinking: false,
      });
    } else {
      // All 4 have submitted - wait 1s then start discussion phase (30s)
      const room = roomCode;
      setTimeout(() => {
        gameManager.setPhase(room, GamePhase.DISCUSSION);
        discussionMessagesByRoom.set(room, []);
        const startedAt = Date.now();
        io.to(room).emit('description-phase-complete', {
          transcript: gameManager.getDescriptionsSoFar(room),
        });
        const allDescriptions = gameManager.getAllDescriptions(room);
        io.to(room).emit('all-descriptions-revealed', {
          descriptions: allDescriptions.map(d => ({
            playerId: d.playerId,
            playerName: d.playerName,
            description: d.description,
          })),
        });
        io.to(room).emit('discussion-phase-started', { startedAt, durationMs: DISCUSSION_DURATION_MS, roomCode: room });
        scheduleAIDiscussionAttempts(room, startedAt);
        const g = gameManager.getGame(room);
        if (g) {
          for (const [playerId, p] of g.players) {
            if (p.isHuman) {
              const playerView = gameManager.getPlayerView(room, playerId, false);
              if (playerView) io.to(playerId).emit('game-state-updated', playerView);
            }
          }
        }
        const timer = setTimeout(() => endDiscussionPhase(room), DISCUSSION_DURATION_MS);
        discussionTimersByRoom.set(room, timer);
        console.log(`Description phase complete for room ${room}, discussion started (30s)`);
      }, 1000);
    }
  });

  // Send discussion chat message
  socket.on('send-discussion-message', ({ roomCode, message }: { roomCode: string; message: string }) => {
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }
    if (game.phase !== GamePhase.DISCUSSION) {
      socket.emit('game-error', { error: 'Discussion phase is not active' });
      return;
    }
    const player = game.players.get(socket.id);
    if (!player) {
      socket.emit('game-error', { error: 'You are not in this game' });
      return;
    }
    if (!gameManager.isPlayerAlive(roomCode, socket.id)) {
      socket.emit('game-error', { error: 'You have been eliminated and cannot act.' });
      return;
    }
    const trimmed = (message || '').trim().slice(0, MAX_DISCUSSION_MESSAGE_LENGTH);
    if (!trimmed) return;
    const list = discussionMessagesByRoom.get(roomCode) || [];
    const entry = { playerId: socket.id, playerName: player.name, message: trimmed, timestamp: Date.now() };
    list.push(entry);
    discussionMessagesByRoom.set(roomCode, list);
    io.to(roomCode).emit('discussion-message', entry);

    const humanCount = list.filter(m => m.playerId !== AI_PLAYER_ID).length;
    const aiCount = list.filter(m => m.playerId === AI_PLAYER_ID).length;
    const lastAttempt = lastAiDiscussionAttemptByRoom.get(roomCode) ?? 0;
    if (aiCount < 2 && (humanCount === 2 || humanCount === 4) && Date.now() - lastAttempt >= MIN_MS_BETWEEN_AI_DISCUSSION_ATTEMPTS) {
      const delayMs = AI_RESPONSE_TO_HUMAN_DELAY_MIN_MS + Math.random() * (AI_RESPONSE_TO_HUMAN_DELAY_MAX_MS - AI_RESPONSE_TO_HUMAN_DELAY_MIN_MS);
      setTimeout(() => tryAIDiscussionMessage(roomCode), delayMs);
    }
  });

  // Advance to voting phase (end discussion early when phase is DISCUSSION)
  socket.on('advance-to-voting', (roomCode: string) => {
    console.log(`Advancing to voting phase for room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }

    if (game.phase === GamePhase.DISCUSSION) {
      endDiscussionPhase(roomCode);
      return;
    }

    if (game.phase !== GamePhase.VOTING) {
      gameManager.setPhase(roomCode, GamePhase.VOTING);
      io.to(roomCode).emit('game-phase-changed', {
        phase: GamePhase.VOTING,
        message: 'Voting Phase! Vote for who you think has a different word.',
      });
      for (const [playerId, p] of game.players) {
        if (p.isHuman) {
          const playerView = gameManager.getPlayerView(roomCode, playerId, false);
          if (playerView) io.to(playerId).emit('game-state-updated', playerView);
        }
      }
    }
  });

  // Submit vote
  socket.on('submit-vote', async ({ roomCode, voteTarget }: { roomCode: string; voteTarget: string }) => {
    console.log(`${socket.id} voting for ${voteTarget} in room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }
    if (!gameManager.isPlayerAlive(roomCode, socket.id)) {
      socket.emit('game-error', { error: 'You have been eliminated and cannot act.' });
      return;
    }
    if (!gameManager.isPlayerAlive(roomCode, voteTarget)) {
      socket.emit('game-error', { error: 'Cannot vote for an eliminated player.' });
      return;
    }

    const success = gameManager.submitVote(roomCode, socket.id, voteTarget);
    if (!success) {
      socket.emit('game-error', { error: 'Failed to submit vote' });
      return;
    }

    // Notify all players that this player has voted (but not WHO they voted for)
    const player = game.players.get(socket.id);
    io.to(roomCode).emit('player-submitted-vote', {
      playerId: socket.id,
      playerName: player?.name,
    });

    // Check if all humans have voted - then trigger AI (or compute results if AI eliminated)
      if (gameManager.allHumanVotesSubmitted(roomCode)) {
        if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) {
          // AI eliminated - compute results directly from alive players' votes
          const results = gameManager.calculateVotingResults(roomCode);
          if (results) {
            const currentGame = gameManager.getGame(roomCode)!;
            const isNewCycle = results.outcome === 'new_cycle';
            if (isNewCycle) {
              io.to(roomCode).emit('voting-results', {
                ...results,
                phase: GamePhase.RESULTS,
              });
              const firstTurnId = gameManager.getCurrentTurnPlayerId(roomCode);
              const nextTurnId = gameManager.getNextTurnPlayerId(roomCode);
              const firstPlayer = firstTurnId ? currentGame.players.get(firstTurnId) : null;
              const nextPlayer = nextTurnId ? currentGame.players.get(nextTurnId) : null;
              io.to(roomCode).emit('new-cycle-started', {
                cycleNumber: currentGame.cycleNumber,
                alivePlayerIds: currentGame.alivePlayerIds,
                descriptionTurnOrder: currentGame.descriptionTurnOrder,
                eliminatedPlayer: results.eliminatedPlayer,
                currentTurnPlayerId: firstTurnId,
                currentTurnPlayerName: firstPlayer?.name,
                nextTurnPlayerId: nextTurnId ?? null,
                nextTurnPlayerName: nextPlayer?.name ?? null,
              });
              io.to(roomCode).emit('game-phase-changed', {
                phase: GamePhase.DESCRIPTION,
                message: 'New round! Describe your word.',
              });
              for (const [playerId, p] of currentGame.players) {
                if (p.isHuman && gameManager.isPlayerAlive(roomCode, playerId)) {
                  const playerView = gameManager.getPlayerView(roomCode, playerId, false);
                  if (playerView) io.to(playerId).emit('game-state-updated', playerView);
                }
              }
              io.to(roomCode).emit('description-turn-started', {
                currentTurnPlayerId: firstTurnId,
                currentTurnPlayerName: firstPlayer?.name,
                nextTurnPlayerId: nextTurnId ?? null,
                nextTurnPlayerName: nextPlayer?.name ?? null,
                transcript: [],
                aiThinking: firstTurnId === AI_PLAYER_ID,
              });
              if (firstTurnId === AI_PLAYER_ID) {
                (async () => {
                  let nextPlayerIdInner: string | null = firstTurnId;
                  while (nextPlayerIdInner === AI_PLAYER_ID) {
                    const g = gameManager.getGame(roomCode);
                    if (!g) return;
                    if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) {
                      nextPlayerIdInner = gameManager.advanceDescriptionTurn(roomCode);
                      continue;
                    }
                    const aiPlayer = gameManager.getAIPlayer(roomCode);
                    const aiPersona = gameManager.getAIPersona(roomCode);
                    if (!aiPlayer || !aiPersona) {
                      io.to(roomCode).emit('game-error', { error: 'AI configuration error' });
                      return;
                    }
                    try {
                      const otherPlayerNames = Array.from(g.players.values())
                        .filter(p => p.id !== AI_PLAYER_ID)
                        .map(p => p.name);
                      const turnIndex = g.descriptionTurnIndex;
                      const previousDescriptions = gameManager.getDescriptionsSoFar(roomCode);
                      const isUndercover = aiPlayer.role === Role.UNDERCOVER;
                      const aiResponse = await generateAIDescription(
                        aiPlayer.word, aiPlayer.name, otherPlayerNames, aiPersona, isUndercover,
                        turnIndex, previousDescriptions
                      );
                      gameManager.submitDescription(roomCode, AI_PLAYER_ID, aiResponse.content);
                      io.to(roomCode).emit('player-submitted-description', {
                        playerId: AI_PLAYER_ID,
                        playerName: aiPlayer.name,
                        description: aiResponse.content,
                      });
                      nextPlayerIdInner = gameManager.advanceDescriptionTurn(roomCode);
                    } catch (err) {
                      console.error('Error generating AI description:', err);
                      io.to(roomCode).emit('game-error', { error: 'AI failed to generate description' });
                      return;
                    }
                  }
                  const g = gameManager.getGame(roomCode);
                  if (g && nextPlayerIdInner) {
                    const nextP = g.players.get(nextPlayerIdInner);
                    const afterNextId = gameManager.getNextTurnPlayerId(roomCode);
                    const afterNextP = afterNextId ? g.players.get(afterNextId) : null;
                    io.to(roomCode).emit('description-turn-started', {
                      currentTurnPlayerId: nextPlayerIdInner,
                      currentTurnPlayerName: nextP?.name,
                      nextTurnPlayerId: afterNextId ?? null,
                      nextTurnPlayerName: afterNextP?.name ?? null,
                      transcript: gameManager.getDescriptionsSoFar(roomCode),
                      aiThinking: false,
                    });
                  }
                })();
              }
              console.log(`Voting results sent for room ${roomCode} (new cycle, AI eliminated)`);
            } else {
              gameManager.setPhase(roomCode, GamePhase.RESULTS);
              io.to(roomCode).emit('voting-results', {
                ...results,
                phase: GamePhase.RESULTS,
              });
              for (const [playerId, p] of currentGame.players) {
                if (p.isHuman) {
                  const playerView = gameManager.getPlayerView(roomCode, playerId, true);
                  if (playerView) io.to(playerId).emit('game-state-updated', playerView);
                }
              }
              console.log(`Voting results sent for room ${roomCode} (game over, AI eliminated)`);
            }
          }
        } else {
        console.log(`All humans voted for room ${roomCode}. Triggering AI vote...`);
        
        io.to(roomCode).emit('all-humans-submitted-votes', {
          message: 'All human players have voted. Player_4 is deciding...',
        });

        // Get AI player and all descriptions for AI to analyze
        const aiPlayer = gameManager.getAIPlayer(roomCode);
        const allDescriptions = gameManager.getAllDescriptions(roomCode);
        
        if (aiPlayer) {
          try {
            // Get AI persona (consistent across game)
            const aiPersona = gameManager.getAIPersona(roomCode);
            if (!aiPersona) {
              console.error('AI persona not found for room', roomCode);
              io.to(roomCode).emit('game-error', { error: 'AI configuration error' });
              return;
            }
            
            // AI generates vote based on descriptions
            const isUndercover = aiPlayer.role === Role.UNDERCOVER;
            const aiVoteResponse = await generateAIVote(
              aiPlayer.word,
              allDescriptions.map(d => ({ playerName: d.playerName, description: d.description })),
              aiPlayer.name,
              aiPersona,
              isUndercover
            );
            
            // Find the player ID from the player name AI voted for
            const votedForPlayer = Array.from(game.players.values())
              .find(p => p.name === aiVoteResponse.vote_target);
            const voteTargetId = votedForPlayer?.id || aiVoteResponse.vote_target;
            
            // Submit AI's vote
            gameManager.submitVote(roomCode, AI_PLAYER_ID, voteTargetId);
            
            console.log(`AI (${aiPlayer.name}) voted for: ${aiVoteResponse.vote_target} (ID: ${voteTargetId})`);

            // Calculate results (may call startNewCycle and set phase to DESCRIPTION)
            const results = gameManager.calculateVotingResults(roomCode);
            
            if (results) {
              const currentGame = gameManager.getGame(roomCode)!;
              const isNewCycle = results.outcome === 'new_cycle';

              if (isNewCycle) {
                // Emit voting-results first so client can show "No one eliminated (tie)" or "X was eliminated" and vote counts
                io.to(roomCode).emit('voting-results', {
                  ...results,
                  phase: GamePhase.RESULTS,
                });
                // Then start new round (phase already DESCRIPTION from startNewCycle)
                const firstTurnId = gameManager.getCurrentTurnPlayerId(roomCode);
                const nextTurnId = gameManager.getNextTurnPlayerId(roomCode);
                const firstPlayer = firstTurnId ? currentGame.players.get(firstTurnId) : null;
                const nextPlayer = nextTurnId ? currentGame.players.get(nextTurnId) : null;
                io.to(roomCode).emit('new-cycle-started', {
                  cycleNumber: currentGame.cycleNumber,
                  alivePlayerIds: currentGame.alivePlayerIds,
                  descriptionTurnOrder: currentGame.descriptionTurnOrder,
                  eliminatedPlayer: results.eliminatedPlayer,
                  currentTurnPlayerId: firstTurnId,
                  currentTurnPlayerName: firstPlayer?.name,
                  nextTurnPlayerId: nextTurnId ?? null,
                  nextTurnPlayerName: nextPlayer?.name ?? null,
                });
                io.to(roomCode).emit('game-phase-changed', {
                  phase: GamePhase.DESCRIPTION,
                  message: 'New round! Describe your word.',
                });
                for (const [playerId, p] of currentGame.players) {
                  if (p.isHuman && gameManager.isPlayerAlive(roomCode, playerId)) {
                    const playerView = gameManager.getPlayerView(roomCode, playerId, false);
                    if (playerView) io.to(playerId).emit('game-state-updated', playerView);
                  }
                }
                io.to(roomCode).emit('description-turn-started', {
                  currentTurnPlayerId: firstTurnId,
                  currentTurnPlayerName: firstPlayer?.name,
                  nextTurnPlayerId: nextTurnId ?? null,
                  nextTurnPlayerName: nextPlayer?.name ?? null,
                  transcript: [],
                  aiThinking: firstTurnId === AI_PLAYER_ID,
                });
                if (firstTurnId === AI_PLAYER_ID) {
                  (async () => {
                    let nextPlayerIdInner: string | null = firstTurnId;
                    while (nextPlayerIdInner === AI_PLAYER_ID) {
                      const g = gameManager.getGame(roomCode);
                      if (!g) return;
                      if (!gameManager.isPlayerAlive(roomCode, AI_PLAYER_ID)) {
                        nextPlayerIdInner = gameManager.advanceDescriptionTurn(roomCode);
                        continue;
                      }
                      const aiPlayer = gameManager.getAIPlayer(roomCode);
                      const aiPersona = gameManager.getAIPersona(roomCode);
                      if (!aiPlayer || !aiPersona) {
                        io.to(roomCode).emit('game-error', { error: 'AI configuration error' });
                        return;
                      }
                      try {
                        const otherPlayerNames = Array.from(g.players.values())
                          .filter(p => p.id !== AI_PLAYER_ID)
                          .map(p => p.name);
                        const turnIndex = g.descriptionTurnIndex;
                        const previousDescriptions = gameManager.getDescriptionsSoFar(roomCode);
                        const isUndercover = aiPlayer.role === Role.UNDERCOVER;
                        const aiResponse = await generateAIDescription(
                          aiPlayer.word, aiPlayer.name, otherPlayerNames, aiPersona, isUndercover,
                          turnIndex, previousDescriptions
                        );
                        gameManager.submitDescription(roomCode, AI_PLAYER_ID, aiResponse.content);
                        io.to(roomCode).emit('player-submitted-description', {
                          playerId: AI_PLAYER_ID,
                          playerName: aiPlayer.name,
                          description: aiResponse.content,
                        });
                        nextPlayerIdInner = gameManager.advanceDescriptionTurn(roomCode);
                      } catch (err) {
                        console.error('Error generating AI description:', err);
                        io.to(roomCode).emit('game-error', { error: 'AI failed to generate description' });
                        return;
                      }
                    }
                    const g = gameManager.getGame(roomCode);
                    if (g && nextPlayerIdInner) {
                      const nextP = g.players.get(nextPlayerIdInner);
                      const afterNextId = gameManager.getNextTurnPlayerId(roomCode);
                      const afterNextP = afterNextId ? g.players.get(afterNextId) : null;
                      io.to(roomCode).emit('description-turn-started', {
                        currentTurnPlayerId: nextPlayerIdInner,
                        currentTurnPlayerName: nextP?.name,
                        nextTurnPlayerId: afterNextId ?? null,
                        nextTurnPlayerName: afterNextP?.name ?? null,
                        transcript: gameManager.getDescriptionsSoFar(roomCode),
                        aiThinking: false,
                      });
                    }
                  })();
                }
                console.log(`Voting results sent for room ${roomCode} (new cycle)`);
              } else {
                gameManager.setPhase(roomCode, GamePhase.RESULTS);
                io.to(roomCode).emit('voting-results', {
                  ...results,
                  phase: GamePhase.RESULTS,
                });
                for (const [playerId, p] of currentGame.players) {
                  if (p.isHuman) {
                    const playerView = gameManager.getPlayerView(roomCode, playerId, true);
                    if (playerView) io.to(playerId).emit('game-state-updated', playerView);
                  }
                }
                console.log(`Voting results sent for room ${roomCode} (game over)`);
              }
            }
          } catch (error) {
            console.error('Error generating AI vote:', error);
            io.to(roomCode).emit('game-error', { error: 'AI failed to vote' });
          }
        }
        }
    }
  });

  // Advance to AI guess phase (for losing players to guess who is AI)
  socket.on('advance-to-ai-guess', (roomCode: string) => {
    console.log(`Advancing to AI guess phase for room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }

    gameManager.setPhase(roomCode, GamePhase.AI_GUESS);
    
    const playersWhoNeedToGuess = gameManager.getPlayersWhoNeedToGuessAI(roomCode);
    
    io.to(roomCode).emit('game-phase-changed', {
      phase: GamePhase.AI_GUESS,
      message: 'Losing players get a second chance! Guess who is the AI to redeem yourself.',
      playersWhoNeedToGuess,
    });
  });

  // Submit AI guess
  socket.on('submit-ai-guess', ({ roomCode, guessedPlayerId }: { roomCode: string; guessedPlayerId: string }) => {
    console.log(`${socket.id} guessing AI is ${guessedPlayerId} in room ${roomCode}`);
    
    const success = gameManager.submitAIGuess(roomCode, socket.id, guessedPlayerId);
    if (!success) {
      socket.emit('game-error', { error: 'Failed to submit AI guess' });
      return;
    }

    const game = gameManager.getGame(roomCode);
    if (game) {
      const player = game.players.get(socket.id);
      io.to(roomCode).emit('player-submitted-ai-guess', {
        playerId: socket.id,
        playerName: player?.name,
      });

      // Check if all losing players have guessed
      if (gameManager.allAIGuessesSubmitted(roomCode)) {
        console.log(`All AI guesses submitted for room ${roomCode}`);
        
        // Calculate final results
        const finalResults = gameManager.calculateFinalResults(roomCode);
        
        if (finalResults) {
          gameManager.setPhase(roomCode, GamePhase.FINAL_RESULTS);
          
          io.to(roomCode).emit('final-results', {
            ...finalResults,
            phase: GamePhase.FINAL_RESULTS,
          });

          console.log(`Final results sent for room ${roomCode}`);
        }
      }
    }
  });

  // Skip AI guess phase (go directly to final results)
  socket.on('skip-ai-guess', (roomCode: string) => {
    console.log(`Skipping AI guess for room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }

    gameManager.setPhase(roomCode, GamePhase.FINAL_RESULTS);
    
    const aiPlayer = gameManager.getAIPlayer(roomCode);
    
    io.to(roomCode).emit('final-results', {
      aiGuessWinners: [],
      aiPlayer: aiPlayer ? { id: aiPlayer.id, name: aiPlayer.name, role: aiPlayer.role } : null,
      allGuesses: [],
      phase: GamePhase.FINAL_RESULTS,
    });
  });

  // Request current game state
  socket.on('get-game-state', (roomCode: string) => {
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-state', { error: 'No game found' });
      return;
    }

    const showResults = game.phase === GamePhase.RESULTS || 
                        game.phase === GamePhase.AI_GUESS || 
                        game.phase === GamePhase.FINAL_RESULTS;
    
    const playerView = gameManager.getPlayerView(roomCode, socket.id, showResults);
    socket.emit('game-state', playerView);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const { room, wasHost } = roomManager.removePlayer(socket.id);
    
    if (room) {
      const players = roomManager.getPlayersInRoom(room.code);
      const playersNeeded = roomManager.getPlayersNeeded(room.code);
      
      // Notify remaining players
      io.to(room.code).emit('player-left', {
        roomCode: room.code,
        players,
        playersNeeded,
        newHostId: room.hostId,
      });

      if (playersNeeded > 0) {
        io.to(room.code).emit('waiting-for-players', {
          roomCode: room.code,
          players,
          playersNeeded,
        });
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
