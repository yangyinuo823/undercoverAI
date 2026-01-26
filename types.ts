export enum Role {
  CIVILIAN = 'Civilian',
  UNDERCOVER = 'Undercover',
}

export interface Player {
  id: string;
  name: string;
  isHuman: boolean;
  role?: Role; // Only revealed in results or to Player_4 (AI)
  word?: string; // Only revealed in results or to Player_4 (AI)
  description: string;
  voteTarget: string; // ID of the player being voted for
}

export interface Player4Output {
  player_name: string;
  content: string;
  vote_target?: string; // Optional for description phase
  thought_process: string;
}

export enum GamePhase {
  SETUP = 'setup',
  DESCRIPTION = 'description',
  VOTING = 'voting',
  RESULTS = 'results',
  AI_GUESS = 'ai_guess',
  FINAL_RESULTS = 'final_results',
}

export interface ChatMessage {
  player: string;
  type: 'description' | 'vote' | 'system';
  content: string;
}