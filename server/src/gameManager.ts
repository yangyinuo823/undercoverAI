// Game state management

export enum Role {
  CIVILIAN = 'Civilian',
  UNDERCOVER = 'Undercover',
}

export enum GamePhase {
  LOBBY = 'lobby',
  DESCRIPTION = 'description',
  VOTING = 'voting',
  RESULTS = 'results',
  AI_GUESS = 'ai_guess',
  FINAL_RESULTS = 'final_results',
}

export interface GamePlayer {
  id: string;           // Socket ID for humans, 'AI' for AI player
  name: string;
  isHuman: boolean;
  isAI: boolean;
  role: Role;
  word: string;
  description: string;
  voteTarget: string;
  hasSubmittedDescription: boolean;
  hasVoted: boolean;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Map<string, GamePlayer>;  // id -> GamePlayer
  aiPlayerId: string;
  civilianWord: string;
  undercoverWord: string;
  // Results tracking
  eliminatedPlayerId?: string;
  civiliansWon?: boolean;
  aiGuesses: Map<string, string>;  // playerId -> guessed AI player id
  aiGuessWinners: string[];  // playerIds who correctly guessed AI
}

export interface GameResults {
  eliminatedPlayer: { id: string; name: string; role: Role } | null;
  civiliansWon: boolean;
  undercoverPlayer: { id: string; name: string };
  aiPlayer: { id: string; name: string; role: Role };
  voteCounts: { playerId: string; playerName: string; votes: number }[];
  allPlayers: { id: string; name: string; role: Role; word: string; voteTarget: string }[];
}

// What each player can see (filtered view)
export interface PlayerGameView {
  roomCode: string;
  phase: GamePhase;
  myPlayerId: string;
  myRole?: Role;    // Only shown in results - players don't know their role!
  myWord: string;   // Players know their word but not their role
  players: {
    id: string;
    name: string;
    isAI: boolean;  // Hidden - always false for other players
    description: string;
    hasSubmittedDescription: boolean;
    hasVoted: boolean;
    voteTarget?: string;  // Only shown in results
    role?: Role;          // Only shown in results
    word?: string;        // Only shown in results
  }[];
}

const CIVILIAN_WORD = 'Coffee';
const UNDERCOVER_WORD = 'Tea';
const AI_PLAYER_ID = 'AI_PLAYER';

// Pool of random names for players
const RANDOM_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Quinn',
  'Avery', 'Charlie', 'Jamie', 'Drew', 'Blake', 'Skyler', 'Reese', 'Parker',
  'Hayden', 'Dakota', 'Finley', 'Sage', 'River', 'Phoenix', 'Rowan', 'Emery',
  'Logan', 'Cameron', 'Dylan', 'Peyton', 'Kendall', 'Jessie', 'Kai', 'Ellis',
  'Max', 'Leo', 'Mia', 'Zoe', 'Luna', 'Chloe', 'Emma', 'Ava', 'Noah', 'Liam',
  'Ethan', 'Mason', 'Lucas', 'Oliver', 'Aiden', 'Elijah', 'James', 'Ben',
];

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Get 4 unique random names
function getRandomNames(count: number): string[] {
  const shuffled = shuffleArray(RANDOM_NAMES);
  return shuffled.slice(0, count);
}

class GameManager {
  private games: Map<string, GameState> = new Map(); // roomCode -> GameState

  // Start a new game for a room
  startGame(roomCode: string, humanPlayers: { id: string; name: string }[]): GameState | null {
    if (humanPlayers.length !== 3) {
      console.error('Need exactly 3 human players to start');
      return null;
    }

    // Create 4 roles: 3 civilians, 1 undercover
    const roles: Role[] = shuffleArray([Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.UNDERCOVER]);
    
    // Get human player names to avoid duplicates
    const humanNameSet = new Set(humanPlayers.map(p => p.name.toLowerCase()));
    
    // Get a random name for AI that doesn't match any human player's name
    let aiName = getRandomNames(1)[0];
    let attempts = 0;
    while (humanNameSet.has(aiName.toLowerCase()) && attempts < 50) {
      aiName = getRandomNames(1)[0];
      attempts++;
    }

    // Create players map
    const players = new Map<string, GamePlayer>();

    // Add human players with their chosen names
    humanPlayers.forEach((hp, index) => {
      const role = roles[index];
      players.set(hp.id, {
        id: hp.id,
        name: hp.name,  // Keep the name they chose in lobby
        isHuman: true,
        isAI: false,
        role: role,
        word: role === Role.CIVILIAN ? CIVILIAN_WORD : UNDERCOVER_WORD,
        description: '',
        voteTarget: '',
        hasSubmittedDescription: false,
        hasVoted: false,
      });
    });

    // Add AI player with random name
    const aiRole = roles[3];
    players.set(AI_PLAYER_ID, {
      id: AI_PLAYER_ID,
      name: aiName,  // Random human-like name (e.g., "Alex", "Sam", "Jordan")
      isHuman: false,
      isAI: true,
      role: aiRole,
      word: aiRole === Role.CIVILIAN ? CIVILIAN_WORD : UNDERCOVER_WORD,
      description: '',
      voteTarget: '',
      hasSubmittedDescription: false,
      hasVoted: false,
    });

    const gameState: GameState = {
      roomCode,
      phase: GamePhase.DESCRIPTION,
      players,
      aiPlayerId: AI_PLAYER_ID,
      civilianWord: CIVILIAN_WORD,
      undercoverWord: UNDERCOVER_WORD,
      aiGuesses: new Map(),
      aiGuessWinners: [],
    };

    this.games.set(roomCode, gameState);
    
    console.log(`Game started for room ${roomCode}`);
    console.log(`AI (${aiName}) is ${aiRole} with word "${aiRole === Role.CIVILIAN ? CIVILIAN_WORD : UNDERCOVER_WORD}"`);
    
    return gameState;
  }

  // Get game state
  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
  }

  // Get filtered view for a specific player (hides other players' secrets)
  getPlayerView(roomCode: string, playerId: string, showResults: boolean = false): PlayerGameView | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const myPlayer = game.players.get(playerId);
    if (!myPlayer) return null;

    const players = Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isAI: false,  // Hide who is AI from everyone
      description: p.description,
      hasSubmittedDescription: p.hasSubmittedDescription,
      hasVoted: p.hasVoted,
      // Only show these in results phase
      voteTarget: showResults ? p.voteTarget : undefined,
      role: showResults ? p.role : undefined,
      word: showResults ? p.word : undefined,
    }));

    return {
      roomCode: game.roomCode,
      phase: game.phase,
      myPlayerId: playerId,
      // Only show role in results - players must guess their role from descriptions!
      myRole: showResults ? myPlayer.role : undefined,
      myWord: myPlayer.word,
      players,
    };
  }

  // Get AI player info (for server-side AI logic)
  getAIPlayer(roomCode: string): GamePlayer | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    return game.players.get(AI_PLAYER_ID) || null;
  }

  // Submit description for a player
  submitDescription(roomCode: string, playerId: string, description: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.DESCRIPTION) return false;

    const player = game.players.get(playerId);
    if (!player) return false;

    player.description = description;
    player.hasSubmittedDescription = true;

    console.log(`${player.name} submitted description: "${description}"`);
    return true;
  }

  // Check if all players have submitted descriptions
  allDescriptionsSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    return Array.from(game.players.values()).every(p => p.hasSubmittedDescription);
  }

  // Check if all human players have submitted descriptions
  allHumanDescriptionsSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    return Array.from(game.players.values())
      .filter(p => p.isHuman)
      .every(p => p.hasSubmittedDescription);
  }

  // Submit vote for a player
  submitVote(roomCode: string, playerId: string, voteTarget: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.VOTING) return false;

    const player = game.players.get(playerId);
    if (!player) return false;

    player.voteTarget = voteTarget;
    player.hasVoted = true;

    console.log(`${player.name} voted for: ${voteTarget}`);
    return true;
  }

  // Check if all players have voted
  allVotesSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    return Array.from(game.players.values()).every(p => p.hasVoted);
  }

  // Check if all human players have voted
  allHumanVotesSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    return Array.from(game.players.values())
      .filter(p => p.isHuman)
      .every(p => p.hasVoted);
  }

  // Advance to next phase
  advancePhase(roomCode: string): GamePhase | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    switch (game.phase) {
      case GamePhase.DESCRIPTION:
        game.phase = GamePhase.VOTING;
        break;
      case GamePhase.VOTING:
        game.phase = GamePhase.RESULTS;
        break;
      case GamePhase.RESULTS:
        game.phase = GamePhase.AI_GUESS;
        break;
      case GamePhase.AI_GUESS:
        game.phase = GamePhase.FINAL_RESULTS;
        break;
    }

    console.log(`Game ${roomCode} advanced to phase: ${game.phase}`);
    return game.phase;
  }

  // Set phase directly
  setPhase(roomCode: string, phase: GamePhase): void {
    const game = this.games.get(roomCode);
    if (game) {
      game.phase = phase;
    }
  }

  // Get all descriptions for AI to analyze
  getAllDescriptions(roomCode: string): { playerId: string; playerName: string; description: string }[] {
    const game = this.games.get(roomCode);
    if (!game) return [];

    return Array.from(game.players.values()).map(p => ({
      playerId: p.id,
      playerName: p.name,
      description: p.description,
    }));
  }

  // Delete game
  deleteGame(roomCode: string): void {
    this.games.delete(roomCode);
    console.log(`Game deleted for room ${roomCode}`);
  }

  // Calculate voting results
  calculateVotingResults(roomCode: string): GameResults | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    // Count votes
    const voteCounts = new Map<string, number>();
    for (const player of game.players.values()) {
      if (player.voteTarget) {
        voteCounts.set(player.voteTarget, (voteCounts.get(player.voteTarget) || 0) + 1);
      }
    }

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedId: string | null = null;
    for (const [playerId, votes] of voteCounts) {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminatedId = playerId;
      }
    }

    const eliminatedPlayer = eliminatedId ? game.players.get(eliminatedId) : null;
    const undercoverPlayer = Array.from(game.players.values()).find(p => p.role === Role.UNDERCOVER)!;
    const aiPlayer = game.players.get(AI_PLAYER_ID)!;

    // Civilians win if the Undercover was eliminated
    const civiliansWon = eliminatedPlayer?.role === Role.UNDERCOVER;
    
    game.eliminatedPlayerId = eliminatedId || undefined;
    game.civiliansWon = civiliansWon;

    const voteCountsArray = Array.from(voteCounts.entries()).map(([playerId, votes]) => ({
      playerId,
      playerName: game.players.get(playerId)?.name || 'Unknown',
      votes,
    })).sort((a, b) => b.votes - a.votes);

    const allPlayers = Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      word: p.word,
      voteTarget: p.voteTarget,
    }));

    console.log(`Voting results for ${roomCode}: Eliminated=${eliminatedPlayer?.name}, CiviliansWon=${civiliansWon}`);

    return {
      eliminatedPlayer: eliminatedPlayer ? {
        id: eliminatedPlayer.id,
        name: eliminatedPlayer.name,
        role: eliminatedPlayer.role,
      } : null,
      civiliansWon,
      undercoverPlayer: {
        id: undercoverPlayer.id,
        name: undercoverPlayer.name,
      },
      aiPlayer: {
        id: aiPlayer.id,
        name: aiPlayer.name,
        role: aiPlayer.role,
      },
      voteCounts: voteCountsArray,
      allPlayers,
    };
  }

  // Submit AI guess (for humans who lost)
  submitAIGuess(roomCode: string, playerId: string, guessedAIId: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.AI_GUESS) return false;

    game.aiGuesses.set(playerId, guessedAIId);
    console.log(`${game.players.get(playerId)?.name} guessed AI is: ${guessedAIId}`);
    return true;
  }

  // Check if all losing human players have submitted AI guesses
  allAIGuessesSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    // Only players who lost need to guess
    const losingHumans = Array.from(game.players.values()).filter(p => {
      if (!p.isHuman) return false;
      // If civilians won, undercover humans lost (if any)
      // If civilians lost, civilian humans lost
      if (game.civiliansWon) {
        return p.role === Role.UNDERCOVER;
      } else {
        return p.role === Role.CIVILIAN;
      }
    });

    return losingHumans.every(p => game.aiGuesses.has(p.id));
  }

  // Get players who need to guess AI
  getPlayersWhoNeedToGuessAI(roomCode: string): string[] {
    const game = this.games.get(roomCode);
    if (!game) return [];

    return Array.from(game.players.values())
      .filter(p => {
        if (!p.isHuman) return false;
        if (game.civiliansWon) {
          return p.role === Role.UNDERCOVER;
        } else {
          return p.role === Role.CIVILIAN;
        }
      })
      .map(p => p.id);
  }

  // Calculate final results including AI guesses
  calculateFinalResults(roomCode: string): {
    aiGuessWinners: { id: string; name: string }[];
    aiPlayer: { id: string; name: string; role: Role };
    allGuesses: { playerId: string; playerName: string; guessedId: string; correct: boolean }[];
  } | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const aiPlayer = game.players.get(AI_PLAYER_ID)!;
    const winners: { id: string; name: string }[] = [];
    const allGuesses: { playerId: string; playerName: string; guessedId: string; correct: boolean }[] = [];

    for (const [playerId, guessedId] of game.aiGuesses) {
      const player = game.players.get(playerId);
      const correct = guessedId === AI_PLAYER_ID;
      if (correct && player) {
        winners.push({ id: player.id, name: player.name });
      }
      allGuesses.push({
        playerId,
        playerName: player?.name || 'Unknown',
        guessedId,
        correct,
      });
    }

    game.aiGuessWinners = winners.map(w => w.id);

    console.log(`AI Guess winners: ${winners.map(w => w.name).join(', ') || 'None'}`);

    return {
      aiGuessWinners: winners,
      aiPlayer: {
        id: aiPlayer.id,
        name: aiPlayer.name,
        role: aiPlayer.role,
      },
      allGuesses,
    };
  }

  // Check if a player needs to guess AI
  playerNeedsToGuessAI(roomCode: string, playerId: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    const player = game.players.get(playerId);
    if (!player || !player.isHuman) return false;

    // If civilians won, only undercover humans need to guess
    // If civilians lost, only civilian humans need to guess
    if (game.civiliansWon) {
      return player.role === Role.UNDERCOVER;
    } else {
      return player.role === Role.CIVILIAN;
    }
  }

  // Check if player has already guessed AI
  hasGuessedAI(roomCode: string, playerId: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;
    return game.aiGuesses.has(playerId);
  }
}

export const gameManager = new GameManager();
export { AI_PLAYER_ID, CIVILIAN_WORD, UNDERCOVER_WORD };
