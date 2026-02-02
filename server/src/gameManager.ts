// Game state management

export enum Role {
  CIVILIAN = 'Civilian',
  UNDERCOVER = 'Undercover',
}

export enum GamePhase {
  LOBBY = 'lobby',
  DESCRIPTION = 'description',
  DISCUSSION = 'discussion',
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

export interface AIPersona {
  personality: {
    name: string;
    description: string;
    examples: string[];
  };
  quirks: string[];
  strategy: {
    name: string;
    description: string;
  };
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Map<string, GamePlayer>;  // id -> GamePlayer
  aiPlayerId: string;
  civilianWord: string;
  undercoverWord: string;
  aiPersona?: AIPersona;  // Persistent AI personality for this game
  // Turn-based description phase
  descriptionTurnOrder: string[];   // shuffled player IDs for description order
  descriptionTurnIndex: number;     // 0-based current turn
  // Results tracking
  eliminatedPlayerId?: string;
  civiliansWon?: boolean;
  aiGuesses: Map<string, string>;  // playerId -> guessed AI player id
  aiGuessWinners: string[];  // playerIds who correctly guessed AI
  // Multi-cycle: alive players (eliminated are removed from this list)
  alivePlayerIds: string[];
  cycleNumber: number;  // starts at 1, incremented each new cycle
}

export interface GameResults {
  eliminatedPlayer: { id: string; name: string; role: Role } | null;
  civiliansWon: boolean;
  undercoverPlayer: { id: string; name: string };
  aiPlayer: { id: string; name: string; role: Role };
  voteCounts: { playerId: string; playerName: string; votes: number }[];
  allPlayers: { id: string; name: string; role: Role; word: string; voteTarget: string }[];
}

/** Result of voting: game over (show results → AI guess / final) or new cycle (back to description). */
export type VotingOutcome = 'game_over' | 'new_cycle';

export interface VotingResultsWithOutcome extends GameResults {
  outcome: VotingOutcome;
}

// What each player can see (filtered view)
export interface PlayerGameView {
  roomCode: string;
  phase: GamePhase;
  myPlayerId: string;
  myRole?: Role;    // Only shown in results - players don't know their role!
  myWord: string;   // Players know their word but not their role
  descriptionTurnOrder: string[];   // player IDs in turn order
  descriptionTurnIndex: number;    // current turn (0-based)
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
    isEliminated: boolean;  // Based on alivePlayerIds
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

// AI Personality and Strategy definitions
const PERSONALITY_STYLES = [
  { name: 'confident', description: 'Confident and direct. Clear, assertive responses.', examples: ['definitely', 'its basically', 'you know'] },
  { name: 'nervous', description: 'A bit uncertain. Uses hedging language.', examples: ['umm maybe', 'not sure but', 'could be wrong'] },
  { name: 'playful', description: 'Playful and joking. Uses humor.', examples: ['lol', 'haha', 'bruh'] },
  { name: 'analytical', description: 'Thoughtful and analytical. Reasons things out.', examples: ['thinking about it', 'if i had to describe', 'the way i see it'] },
  { name: 'brief', description: 'Very few words. Short and to the point.', examples: ['its warm', 'morning thing'] },
  { name: 'normal', description: 'Plain and straightforward. No strong personality.', examples: ['its like', 'kind of', 'i guess'] },
];

const TEXT_QUIRKS = [
  'skip apostrophes sometimes (dont, cant)',
  'use ... for pauses occasionally',
  'make small typos rarely',
  'start sentences lowercase sometimes',
  'use filler words (like, um)',
  'use abbreviations rarely (tbh, ngl)',
];

const STRATEGY_STYLES = [
  { name: 'mirror', description: 'Try to match the majority style. Blend in by being similar to others.' },
  { name: 'deflect', description: 'If you might be suspicious, deflect attention to others subtly.' },
  { name: 'overthink', description: 'Give slightly overthought descriptions. Show you\'re trying hard.' },
  { name: 'underthink', description: 'Give simple, off-the-cuff responses. Act casual.' },
  { name: 'risky', description: 'Take calculated risks. Sometimes give slightly odd descriptions.' },
  { name: 'safe', description: 'Play it safe. Give generic, inoffensive descriptions.' },
];

function generateAIPersona(): AIPersona {
  const personality = PERSONALITY_STYLES[Math.floor(Math.random() * PERSONALITY_STYLES.length)];
  const strategy = STRATEGY_STYLES[Math.floor(Math.random() * STRATEGY_STYLES.length)];
  
  // Pick 0-2 quirks (not always applied - probabilistic)
  const shuffledQuirks = [...TEXT_QUIRKS].sort(() => Math.random() - 0.5);
  const numQuirks = Math.floor(Math.random() * 3); // 0, 1, or 2 quirks
  const quirks = shuffledQuirks.slice(0, numQuirks);
  
  return { personality, quirks, strategy };
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

    // Generate AI persona for this game (persists across all AI actions)
    const aiPersona = generateAIPersona();

    // Turn order from alive players only (at start = all 4)
    const allPlayerIds = [...humanPlayers.map(p => p.id), AI_PLAYER_ID];
    const alivePlayerIds = [...allPlayerIds];
    const descriptionTurnOrder = shuffleArray([...alivePlayerIds]);

    const gameState: GameState = {
      roomCode,
      phase: GamePhase.DESCRIPTION,
      players,
      aiPlayerId: AI_PLAYER_ID,
      civilianWord: CIVILIAN_WORD,
      undercoverWord: UNDERCOVER_WORD,
      aiPersona,
      descriptionTurnOrder,
      descriptionTurnIndex: 0,
      aiGuesses: new Map(),
      aiGuessWinners: [],
      alivePlayerIds,
      cycleNumber: 1,
    };

    this.games.set(roomCode, gameState);
    
    console.log(`Game started for room ${roomCode}`);
    console.log(`AI (${aiName}) is ${aiRole} with word "${aiRole === Role.CIVILIAN ? CIVILIAN_WORD : UNDERCOVER_WORD}"`);
    console.log(`AI Persona: ${aiPersona.personality.name}, Strategy: ${aiPersona.strategy.name}, Quirks: ${aiPersona.quirks.length}`);
    
    return gameState;
  }

  // Get game state
  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
  }

  // Get IDs of players still in the game (for multi-cycle)
  getAlivePlayerIds(roomCode: string): string[] {
    const game = this.games.get(roomCode);
    if (!game) return [];
    return game.alivePlayerIds ?? Array.from(game.players.keys());
  }

  // Check if a player is still in the game
  isPlayerAlive(roomCode: string, playerId: string): boolean {
    const alive = this.getAlivePlayerIds(roomCode);
    return alive.includes(playerId);
  }

  // Start a new cycle: reset description/voting for alive players, back to DESCRIPTION phase
  startNewCycle(roomCode: string): void {
    const game = this.games.get(roomCode);
    if (!game) return;

    const alive = game.alivePlayerIds ?? Array.from(game.players.keys());
    game.descriptionTurnOrder = shuffleArray([...alive]);
    game.descriptionTurnIndex = 0;

    for (const playerId of alive) {
      const p = game.players.get(playerId);
      if (p) {
        p.description = '';
        p.voteTarget = '';
        p.hasSubmittedDescription = false;
        p.hasVoted = false;
      }
    }

    game.phase = GamePhase.DESCRIPTION;
    game.cycleNumber = (game.cycleNumber ?? 1) + 1;
    console.log(`Game ${roomCode} started new cycle ${game.cycleNumber}`);
  }

  // Get filtered view for a specific player (hides other players' secrets)
  getPlayerView(roomCode: string, playerId: string, showResults: boolean = false): PlayerGameView | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    const myPlayer = game.players.get(playerId);
    if (!myPlayer) return null;

    const alive = game.alivePlayerIds ?? Array.from(game.players.keys());
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
      isEliminated: !alive.includes(p.id),
    }));

    return {
      roomCode: game.roomCode,
      phase: game.phase,
      myPlayerId: playerId,
      myRole: showResults ? myPlayer.role : undefined,
      myWord: myPlayer.word,
      descriptionTurnOrder: game.descriptionTurnOrder,
      descriptionTurnIndex: game.descriptionTurnIndex,
      players,
    };
  }

  // Get AI player info (for server-side AI logic)
  getAIPlayer(roomCode: string): GamePlayer | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    return game.players.get(AI_PLAYER_ID) || null;
  }

  // Get AI persona for this game
  getAIPersona(roomCode: string): AIPersona | null {
    const game = this.games.get(roomCode);
    if (!game || !game.aiPersona) return null;
    return game.aiPersona;
  }

  // Get current turn player ID (for description phase)
  getCurrentTurnPlayerId(roomCode: string): string | null {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.DESCRIPTION) return null;
    if (game.descriptionTurnIndex >= game.descriptionTurnOrder.length) return null;
    return game.descriptionTurnOrder[game.descriptionTurnIndex];
  }

  // Get next turn player ID (after current)
  getNextTurnPlayerId(roomCode: string): string | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    const nextIndex = game.descriptionTurnIndex + 1;
    if (nextIndex >= game.descriptionTurnOrder.length) return null;
    return game.descriptionTurnOrder[nextIndex];
  }

  // Get descriptions so far (in turn order) for transcript / AI
  getDescriptionsSoFar(roomCode: string): { playerId: string; playerName: string; description: string }[] {
    const game = this.games.get(roomCode);
    if (!game) return [];
    const result: { playerId: string; playerName: string; description: string }[] = [];
    for (let i = 0; i < game.descriptionTurnIndex; i++) {
      const pid = game.descriptionTurnOrder[i];
      const p = game.players.get(pid);
      if (p && p.description) result.push({ playerId: p.id, playerName: p.name, description: p.description });
    }
    return result;
  }

  // Advance to next turn; returns next player ID or null if phase complete
  advanceDescriptionTurn(roomCode: string): string | null {
    const game = this.games.get(roomCode);
    if (!game) return null;
    game.descriptionTurnIndex++;
    if (game.descriptionTurnIndex >= game.descriptionTurnOrder.length) return null;
    return game.descriptionTurnOrder[game.descriptionTurnIndex];
  }

  // Submit description for a player (only valid if it's their turn and they're alive)
  submitDescription(roomCode: string, playerId: string, description: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.DESCRIPTION) return false;
    if (!this.isPlayerAlive(roomCode, playerId)) return false;

    const currentTurnId = this.getCurrentTurnPlayerId(roomCode);
    if (currentTurnId !== playerId) return false;

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

  // Submit vote for a player (both voter and target must be alive)
  submitVote(roomCode: string, playerId: string, voteTarget: string): boolean {
    const game = this.games.get(roomCode);
    if (!game || game.phase !== GamePhase.VOTING) return false;
    if (!this.isPlayerAlive(roomCode, playerId)) return false;
    if (!this.isPlayerAlive(roomCode, voteTarget)) return false;

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

  // Check if all alive human players have voted
  allHumanVotesSubmitted(roomCode: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;

    const alive = game.alivePlayerIds ?? Array.from(game.players.keys());
    return Array.from(game.players.values())
      .filter(p => p.isHuman && alive.includes(p.id))
      .every(p => p.hasVoted);
  }

  // Advance to next phase
  advancePhase(roomCode: string): GamePhase | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    switch (game.phase) {
      case GamePhase.DESCRIPTION:
        game.phase = GamePhase.DISCUSSION;
        break;
      case GamePhase.DISCUSSION:
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

  // Calculate voting results; applies elimination and optionally starts new cycle
  calculateVotingResults(roomCode: string): VotingResultsWithOutcome | null {
    const game = this.games.get(roomCode);
    if (!game) return null;

    // Count votes (only alive players' votes count; current game has everyone voting)
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

    game.eliminatedPlayerId = eliminatedId || undefined;

    let civiliansWon: boolean;
    let outcome: VotingOutcome;

    if (eliminatedPlayer?.role === Role.UNDERCOVER) {
      // Undercover eliminated: civilians win, game ends
      civiliansWon = true;
      outcome = 'game_over';
      // Do not change alivePlayerIds
    } else if (eliminatedPlayer?.role === Role.CIVILIAN) {
      // Civilian eliminated: remove from alive
      game.alivePlayerIds = (game.alivePlayerIds ?? Array.from(game.players.keys())).filter(id => id !== eliminatedId);
      const aliveCivilians = game.alivePlayerIds.filter(id => game.players.get(id)?.role === Role.CIVILIAN).length;
      if (aliveCivilians <= 1) {
        // Only 1 civilian left (and 1 undercover): undercover wins
        civiliansWon = false;
        outcome = 'game_over';
      } else {
        // 2+ civilians still alive: new cycle
        civiliansWon = false; // round lost for civilians but game continues
        this.startNewCycle(roomCode);
        outcome = 'new_cycle';
      }
    } else {
      // No one eliminated (tie) or invalid
      civiliansWon = false;
      outcome = 'game_over';
    }

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

    console.log(`Voting results for ${roomCode}: Eliminated=${eliminatedPlayer?.name}, CiviliansWon=${civiliansWon}, outcome=${outcome}`);

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
      outcome,
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
