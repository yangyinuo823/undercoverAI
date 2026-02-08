import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// Room player (lobby phase)
interface RoomPlayer {
  id: string;
  name: string;
  isReady: boolean;
}

// Game player (after game starts)
interface GamePlayer {
  id: string;
  name: string;
  isAI: boolean;
  description: string;
  hasSubmittedDescription: boolean;
  hasVoted: boolean;
  hasGuessedAI?: boolean;
  voteTarget?: string;
  role?: string;
  word?: string;
  isEliminated?: boolean;
}

interface RoomState {
  roomCode: string | null;
  players: RoomPlayer[];
  playersNeeded: number;
  isRoomFull: boolean;
  isConnected: boolean;
  error: string | null;
}

interface VotingResults {
  eliminatedPlayer: { id: string; name: string; role: string } | null;
  civiliansWon: boolean;
  undercoverPlayer: { id: string; name: string };
  aiPlayer: { id: string; name: string; role: string };
  voteCounts: { playerId: string; playerName: string; votes: number }[];
  allPlayers: { id: string; name: string; role: string; word: string; voteTarget: string }[];
  /** Present when server sends voting results: game ends or new cycle started */
  outcome?: 'game_over' | 'new_cycle';
}

interface FinalResults {
  aiGuessWinners: { id: string; name: string }[];
  aiPlayer: { id: string; name: string; role: string };
  allGuesses: { playerId: string; playerName: string; guessedId: string; correct: boolean }[];
  civiliansWon?: boolean;
}

interface DescriptionTranscriptEntry {
  playerId: string;
  playerName: string;
  description: string;
}

interface DiscussionMessageEntry {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

interface GameState {
  isGameStarted: boolean;
  phase: string;
  myPlayerId: string | null;
  myRole: string | null;
  myWord: string | null;
  players: GamePlayer[];
  votingResults: VotingResults | null;
  finalResults: FinalResults | null;
  playersWhoNeedToGuessAI: string[];
  // Turn-based description
  descriptionTurnOrder: string[];
  descriptionTurnIndex: number;
  descriptionTranscript: DescriptionTranscriptEntry[];
  currentTurnPlayerId: string | null;
  nextTurnPlayerId: string | null;
  aiThinking: boolean;
  // Discussion phase
  discussionMessages: DiscussionMessageEntry[];
  discussionEndsAt: number | null;
  /** Round number (1, 2, 3...) for multi-cycle games */
  cycleNumber: number;
}

interface SocketContextType {
  socket: Socket | null;
  roomState: RoomState;
  gameState: GameState;
  playerName: string;
  setPlayerName: (name: string) => void;
  createRoom: () => void;
  joinRoom: (roomCode: string) => void;
  leaveRoom: () => void;
  startGame: () => void;
  submitDescription: (description: string) => void;
  sendDiscussionMessage: (message: string) => void;
  advanceToVoting: () => void;
  submitVote: (targetId: string) => void;
  advanceToAIGuess: () => void;
  submitAIGuess: (guessedPlayerId: string) => void;
  skipAIGuess: () => void;
}

const initialRoomState: RoomState = {
  roomCode: null,
  players: [],
  playersNeeded: 3,
  isRoomFull: false,
  isConnected: false,
  error: null,
};

const initialGameState: GameState = {
  isGameStarted: false,
  phase: 'lobby',
  myPlayerId: null,
  myRole: null,
  myWord: null,
  players: [],
  votingResults: null,
  finalResults: null,
  playersWhoNeedToGuessAI: [],
  descriptionTurnOrder: [],
  descriptionTurnIndex: 0,
  descriptionTranscript: [],
  currentTurnPlayerId: null,
  nextTurnPlayerId: null,
  aiThinking: false,
  discussionMessages: [],
  discussionEndsAt: null,
  cycleNumber: 1,
};

const SocketContext = createContext<SocketContextType | null>(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomState, setRoomState] = useState<RoomState>(initialRoomState);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [playerName, setPlayerName] = useState<string>('');

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('Connected to server:', newSocket.id);
      setRoomState(prev => ({ ...prev, isConnected: true, error: null }));
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setRoomState(prev => ({ ...prev, isConnected: false }));
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setRoomState(prev => ({ ...prev, isConnected: false, error: 'Failed to connect to server' }));
    });

    // ========== ROOM EVENTS ==========
    newSocket.on('room-created', (data) => {
      console.log('Room created:', data);
      setRoomState(prev => ({
        ...prev,
        roomCode: data.roomCode,
        players: data.players,
        playersNeeded: data.playersNeeded,
        isRoomFull: data.playersNeeded === 0,
        error: null,
      }));
    });

    newSocket.on('player-joined', (data) => {
      console.log('Player joined:', data);
      setRoomState(prev => ({
        ...prev,
        roomCode: data.roomCode,
        players: data.players,
        playersNeeded: data.playersNeeded,
        isRoomFull: data.isRoomFull,
        error: null,
      }));
    });

    newSocket.on('waiting-for-players', (data) => {
      setRoomState(prev => ({
        ...prev,
        players: data.players,
        playersNeeded: data.playersNeeded,
      }));
    });

    newSocket.on('room-ready', (data) => {
      setRoomState(prev => ({
        ...prev,
        players: data.players,
        playersNeeded: 0,
        isRoomFull: true,
      }));
    });

    newSocket.on('player-left', (data) => {
      setRoomState(prev => ({
        ...prev,
        players: data.players,
        playersNeeded: data.playersNeeded,
        isRoomFull: false,
      }));
    });

    newSocket.on('join-error', (data) => {
      console.error('Join error:', data.error);
      setRoomState(prev => ({ ...prev, error: data.error }));
    });

    // ========== GAME EVENTS ==========
    newSocket.on('game-started', (data) => {
      console.log('Game started! My view:', data);
      setGameState({
        isGameStarted: true,
        phase: data.phase,
        myPlayerId: data.myPlayerId,
        myRole: data.myRole,
        myWord: data.myWord,
        players: data.players,
        votingResults: null,
        finalResults: null,
        playersWhoNeedToGuessAI: [],
        descriptionTurnOrder: data.descriptionTurnOrder || [],
        descriptionTurnIndex: data.descriptionTurnIndex ?? 0,
        descriptionTranscript: [],
        currentTurnPlayerId: null,
        nextTurnPlayerId: null,
        aiThinking: false,
        discussionMessages: [],
        discussionEndsAt: null,
        cycleNumber: 1,
      });
    });

    newSocket.on('description-turn-started', (data: {
      currentTurnPlayerId: string | null;
      currentTurnPlayerName: string | null;
      nextTurnPlayerId: string | null;
      nextTurnPlayerName: string | null;
      transcript: DescriptionTranscriptEntry[];
      aiThinking?: boolean;
    }) => {
      setGameState(prev => ({
        ...prev,
        currentTurnPlayerId: data.currentTurnPlayerId,
        nextTurnPlayerId: data.nextTurnPlayerId,
        descriptionTranscript: data.transcript || prev.descriptionTranscript,
        aiThinking: data.aiThinking ?? false,
      }));
    });

    newSocket.on('game-phase-changed', (data) => {
      console.log('Game phase changed:', data);
      setGameState(prev => ({
        ...prev,
        phase: data.phase,
        playersWhoNeedToGuessAI: data.playersWhoNeedToGuess || prev.playersWhoNeedToGuessAI,
      }));
    });

    newSocket.on('player-submitted-description', (data: { playerId: string; playerName: string; description?: string }) => {
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => 
          p.id === data.playerId 
            ? { ...p, hasSubmittedDescription: true, description: data.description ?? p.description }
            : p
        ),
        descriptionTranscript: data.description
          ? [...prev.descriptionTranscript, { playerId: data.playerId, playerName: data.playerName, description: data.description }]
          : prev.descriptionTranscript,
      }));
    });

    newSocket.on('player-submitted-vote', (data) => {
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => 
          p.id === data.playerId 
            ? { ...p, hasVoted: true }
            : p
        ),
      }));
    });

    newSocket.on('player-submitted-ai-guess', (data) => {
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => 
          p.id === data.playerId 
            ? { ...p, hasGuessedAI: true }
            : p
        ),
      }));
    });

    newSocket.on('all-descriptions-revealed', (data) => {
      console.log('All descriptions revealed:', data);
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => {
          const desc = data.descriptions.find((d: any) => d.playerId === p.id);
          return desc ? { ...p, description: desc.description, hasSubmittedDescription: true } : p;
        }),
      }));
    });

    newSocket.on('game-state-updated', (data) => {
      console.log('Game state updated:', data);
      if (data && !data.error) {
        setGameState(prev => ({
          ...prev,
          phase: data.phase,
          myRole: data.myRole ?? prev.myRole,
          players: data.players,
          ...(data.descriptionTurnOrder != null && { descriptionTurnOrder: data.descriptionTurnOrder }),
          ...(data.descriptionTurnIndex != null && { descriptionTurnIndex: data.descriptionTurnIndex }),
          // New cycle: clear transcript when we get new turn order
          ...(data.descriptionTurnOrder != null && { descriptionTranscript: [] }),
        }));
      }
    });

    newSocket.on('voting-results', (data) => {
      console.log('Voting results:', data);
      setGameState(prev => ({
        ...prev,
        phase: data.phase,
        votingResults: data,
      }));
    });

    newSocket.on('new-cycle-started', (data: {
      cycleNumber: number;
      alivePlayerIds: string[];
      descriptionTurnOrder: string[];
      eliminatedPlayer: { id: string; name: string; role: string } | null;
      currentTurnPlayerId?: string | null;
      currentTurnPlayerName?: string | null;
      nextTurnPlayerId?: string | null;
      nextTurnPlayerName?: string | null;
    }) => {
      console.log('New cycle started:', data);
      const alive = new Set(data.alivePlayerIds || []);
      setGameState(prev => ({
        ...prev,
        phase: 'description',
        cycleNumber: data.cycleNumber ?? prev.cycleNumber,
        descriptionTurnOrder: data.descriptionTurnOrder,
        descriptionTranscript: [],
        currentTurnPlayerId: data.currentTurnPlayerId ?? null,
        nextTurnPlayerId: data.nextTurnPlayerId ?? null,
        votingResults: { outcome: 'new_cycle' as const, eliminatedPlayer: data.eliminatedPlayer ?? null, voteCounts: (data as any).voteCounts ?? prev.votingResults?.voteCounts ?? [] },
        players: prev.players.map(p => ({ ...p, isEliminated: !alive.has(p.id) })),
      }));
    });

    newSocket.on('final-results', (data) => {
      console.log('Final results:', data);
      setGameState(prev => ({
        ...prev,
        phase: data.phase,
        finalResults: data,
      }));
    });

    newSocket.on('game-error', (data) => {
      console.error('Game error:', data.error);
      setRoomState(prev => ({ ...prev, error: data.error }));
    });

    newSocket.on('all-humans-submitted-descriptions', (data) => {
      console.log(data.message);
    });

    newSocket.on('description-phase-complete', (data: { transcript?: DescriptionTranscriptEntry[] }) => {
      setGameState(prev => ({
        ...prev,
        aiThinking: false,
        descriptionTranscript: data.transcript ?? prev.descriptionTranscript,
      }));
    });

    newSocket.on('discussion-phase-started', (data: { startedAt: number; durationMs: number }) => {
      setGameState(prev => ({
        ...prev,
        phase: 'discussion',
        discussionMessages: [],
        discussionEndsAt: data.startedAt + data.durationMs,
      }));
    });

    newSocket.on('discussion-message', (data: DiscussionMessageEntry) => {
      setGameState(prev => ({
        ...prev,
        discussionMessages: [...prev.discussionMessages, data],
      }));
    });

    newSocket.on('discussion-phase-ended', () => {
      setGameState(prev => ({
        ...prev,
        phase: 'voting',
        discussionEndsAt: null,
      }));
    });

    newSocket.on('all-humans-submitted-votes', (data) => {
      console.log(data.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const createRoom = useCallback(() => {
    if (socket && playerName.trim()) {
      setRoomState(prev => ({ ...prev, error: null }));
      socket.emit('create-room', playerName.trim());
    } else if (!playerName.trim()) {
      setRoomState(prev => ({ ...prev, error: 'Please enter your name' }));
    }
  }, [socket, playerName]);

  const joinRoom = useCallback((roomCode: string) => {
    if (socket && playerName.trim() && roomCode.trim()) {
      setRoomState(prev => ({ ...prev, error: null }));
      socket.emit('join-room', { roomCode: roomCode.trim().toUpperCase(), playerName: playerName.trim() });
    } else if (!playerName.trim()) {
      setRoomState(prev => ({ ...prev, error: 'Please enter your name' }));
    } else if (!roomCode.trim()) {
      setRoomState(prev => ({ ...prev, error: 'Please enter a room code' }));
    }
  }, [socket, playerName]);

  const leaveRoom = useCallback(() => {
    setRoomState(initialRoomState);
    setGameState(initialGameState);
    if (socket) {
      socket.disconnect();
      socket.connect();
    }
  }, [socket]);

  const startGame = useCallback(() => {
    if (socket && roomState.roomCode && roomState.isRoomFull) {
      socket.emit('start-game', roomState.roomCode);
    }
  }, [socket, roomState.roomCode, roomState.isRoomFull]);

  const submitDescription = useCallback((description: string) => {
    if (socket && roomState.roomCode) {
      socket.emit('submit-description', { roomCode: roomState.roomCode, description });
    }
  }, [socket, roomState.roomCode]);

  const sendDiscussionMessage = useCallback((message: string) => {
    if (socket && roomState.roomCode && message.trim()) {
      socket.emit('send-discussion-message', { roomCode: roomState.roomCode, message: message.trim() });
    }
  }, [socket, roomState.roomCode]);

  const advanceToVoting = useCallback(() => {
    if (socket && roomState.roomCode) {
      socket.emit('advance-to-voting', roomState.roomCode);
    }
  }, [socket, roomState.roomCode]);

  const submitVote = useCallback((targetId: string) => {
    if (socket && roomState.roomCode) {
      socket.emit('submit-vote', { roomCode: roomState.roomCode, voteTarget: targetId });
    }
  }, [socket, roomState.roomCode]);

  const advanceToAIGuess = useCallback(() => {
    if (socket && roomState.roomCode) {
      socket.emit('advance-to-ai-guess', roomState.roomCode);
    }
  }, [socket, roomState.roomCode]);

  const submitAIGuess = useCallback((guessedPlayerId: string) => {
    if (socket && roomState.roomCode) {
      socket.emit('submit-ai-guess', { roomCode: roomState.roomCode, guessedPlayerId });
    }
  }, [socket, roomState.roomCode]);

  const skipAIGuess = useCallback(() => {
    if (socket && roomState.roomCode) {
      socket.emit('skip-ai-guess', roomState.roomCode);
    }
  }, [socket, roomState.roomCode]);

  return (
    <SocketContext.Provider value={{
      socket,
      roomState,
      gameState,
      playerName,
      setPlayerName,
      createRoom,
      joinRoom,
      leaveRoom,
      startGame,
      submitDescription,
      sendDiscussionMessage,
      advanceToVoting,
      submitVote,
      advanceToAIGuess,
      submitAIGuess,
      skipAIGuess,
    }}>
      {children}
    </SocketContext.Provider>
  );
};
