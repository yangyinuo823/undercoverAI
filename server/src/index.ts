import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { roomManager } from './roomManager';
import { gameManager, GamePhase, AI_PLAYER_ID } from './gameManager';
import { generateAIDescription, generateAIVote } from './geminiService';

const app = express();
const httpServer = createServer(app);

// Configure CORS for the frontend
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

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

    // Send each player their own view (with their own role/word only)
    for (const [playerId, player] of gameState.players) {
      if (player.isHuman) {
        const playerView = gameManager.getPlayerView(roomCode, playerId, false);
        if (playerView) {
          io.to(playerId).emit('game-started', playerView);
          console.log(`Sent game view to ${player.name}: Role=${playerView.myRole}, Word=${playerView.myWord}`);
        }
      }
    }

    // Notify all that game started (public info only)
    io.to(roomCode).emit('game-phase-changed', {
      phase: GamePhase.DESCRIPTION,
      message: 'Game started! Describe your word without saying it directly.',
    });
  });

  // Submit description
  socket.on('submit-description', async ({ roomCode, description }: { roomCode: string; description: string }) => {
    console.log(`${socket.id} submitting description for room ${roomCode}`);
    
    const success = gameManager.submitDescription(roomCode, socket.id, description);
    if (!success) {
      socket.emit('game-error', { error: 'Failed to submit description' });
      return;
    }

    // Notify all players that this player has submitted (but NOT the content yet)
    const game = gameManager.getGame(roomCode);
    if (game) {
      const player = game.players.get(socket.id);
      io.to(roomCode).emit('player-submitted-description', {
        playerId: socket.id,
        playerName: player?.name,
      });

      // Check if all humans have submitted - then trigger AI
      if (gameManager.allHumanDescriptionsSubmitted(roomCode)) {
        console.log(`All humans submitted for room ${roomCode}. Triggering AI...`);
        
        io.to(roomCode).emit('all-humans-submitted-descriptions', {
          message: 'All human players have submitted. Player_4 is thinking...',
        });

        // Get AI player info
        const aiPlayer = gameManager.getAIPlayer(roomCode);
        if (aiPlayer) {
          try {
            // Get other player names for the AI prompt
            const otherPlayerNames = Array.from(game.players.values())
              .filter(p => p.id !== AI_PLAYER_ID)
              .map(p => p.name);
            
            // AI generates description WITHOUT seeing human descriptions
            const aiResponse = await generateAIDescription(aiPlayer.word, aiPlayer.name, otherPlayerNames);
            
            // Submit AI's description
            gameManager.submitDescription(roomCode, AI_PLAYER_ID, aiResponse.content);
            
            console.log(`AI submitted description: "${aiResponse.content}"`);

            // Now all descriptions are in - broadcast to everyone
            const allDescriptions = gameManager.getAllDescriptions(roomCode);
            
            io.to(roomCode).emit('all-descriptions-revealed', {
              descriptions: allDescriptions.map(d => ({
                playerId: d.playerId,
                playerName: d.playerName,
                description: d.description,
              })),
            });

            // Update each player's game state with descriptions visible
            for (const [playerId, p] of game.players) {
              if (p.isHuman) {
                const playerView = gameManager.getPlayerView(roomCode, playerId, false);
                if (playerView) {
                  io.to(playerId).emit('game-state-updated', playerView);
                }
              }
            }

            console.log(`All descriptions revealed for room ${roomCode}`);
          } catch (error) {
            console.error('Error generating AI description:', error);
            io.to(roomCode).emit('game-error', { error: 'AI failed to generate description' });
          }
        }
      }
    }
  });

  // Advance to voting phase
  socket.on('advance-to-voting', (roomCode: string) => {
    console.log(`Advancing to voting phase for room ${roomCode}`);
    
    const game = gameManager.getGame(roomCode);
    if (!game) {
      socket.emit('game-error', { error: 'Game not found' });
      return;
    }

    gameManager.setPhase(roomCode, GamePhase.VOTING);
    
    io.to(roomCode).emit('game-phase-changed', {
      phase: GamePhase.VOTING,
      message: 'Voting Phase! Vote for who you think has a different word.',
    });

    // Send updated state to all players
    for (const [playerId, p] of game.players) {
      if (p.isHuman) {
        const playerView = gameManager.getPlayerView(roomCode, playerId, false);
        if (playerView) {
          io.to(playerId).emit('game-state-updated', playerView);
        }
      }
    }
  });

  // Submit vote
  socket.on('submit-vote', async ({ roomCode, voteTarget }: { roomCode: string; voteTarget: string }) => {
    console.log(`${socket.id} voting for ${voteTarget} in room ${roomCode}`);
    
    const success = gameManager.submitVote(roomCode, socket.id, voteTarget);
    if (!success) {
      socket.emit('game-error', { error: 'Failed to submit vote' });
      return;
    }

    // Notify all players that this player has voted (but not WHO they voted for)
    const game = gameManager.getGame(roomCode);
    if (game) {
      const player = game.players.get(socket.id);
      io.to(roomCode).emit('player-submitted-vote', {
        playerId: socket.id,
        playerName: player?.name,
      });

      // Check if all humans have voted - then trigger AI
      if (gameManager.allHumanVotesSubmitted(roomCode)) {
        console.log(`All humans voted for room ${roomCode}. Triggering AI vote...`);
        
        io.to(roomCode).emit('all-humans-submitted-votes', {
          message: 'All human players have voted. Player_4 is deciding...',
        });

        // Get AI player and all descriptions for AI to analyze
        const aiPlayer = gameManager.getAIPlayer(roomCode);
        const allDescriptions = gameManager.getAllDescriptions(roomCode);
        
        if (aiPlayer) {
          try {
            // AI generates vote based on descriptions
            const aiVoteResponse = await generateAIVote(
              aiPlayer.word,
              allDescriptions.map(d => ({ playerName: d.playerName, description: d.description })),
              aiPlayer.name  // Pass AI's actual name
            );
            
            // Find the player ID from the player name AI voted for
            const votedForPlayer = Array.from(game.players.values())
              .find(p => p.name === aiVoteResponse.vote_target);
            const voteTargetId = votedForPlayer?.id || aiVoteResponse.vote_target;
            
            // Submit AI's vote
            gameManager.submitVote(roomCode, AI_PLAYER_ID, voteTargetId);
            
            console.log(`AI (${aiPlayer.name}) voted for: ${aiVoteResponse.vote_target} (ID: ${voteTargetId})`);

            // Calculate results
            const results = gameManager.calculateVotingResults(roomCode);
            
            if (results) {
              // Move to results phase
              gameManager.setPhase(roomCode, GamePhase.RESULTS);

              // Send results to all players
              io.to(roomCode).emit('voting-results', {
                ...results,
                phase: GamePhase.RESULTS,
              });

              // Send updated game state with all info revealed
              for (const [playerId, p] of game.players) {
                if (p.isHuman) {
                  const playerView = gameManager.getPlayerView(roomCode, playerId, true);
                  if (playerView) {
                    io.to(playerId).emit('game-state-updated', playerView);
                  }
                }
              }

              console.log(`Voting results sent for room ${roomCode}`);
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
