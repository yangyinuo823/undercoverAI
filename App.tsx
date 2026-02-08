import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Player, Role, GamePhase, ChatMessage } from './types';
import { getRandomWordPair, PLAYER_NAMES, PLAYER_4_NAME } from './constants';
import { generatePlayer4Description, generatePlayer4Vote } from './services/geminiService';
import PlayerCard from './components/PlayerCard';
import Button from './components/Button';
import InputField from './components/InputField';
import ChatWindow from './components/ChatWindow';
import Lobby from './components/Lobby';
import { useSocket } from './contexts/SocketContext';

// Shuffle array using Fisher-Yates algorithm with a seed
const shuffleWithSeed = <T,>(array: T[], seed: string): T[] => {
  const result = [...array];
  // Simple hash function to create a number from seed string
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  // Use hash as pseudo-random seed
  const random = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };
  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const App: React.FC = () => {
  const { socket, roomState, gameState, submitDescription, sendDiscussionMessage, advanceToVoting, submitVote, advanceToAIGuess, submitAIGuess } = useSocket();
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [selectedAIGuess, setSelectedAIGuess] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [hasGuessedAI, setHasGuessedAI] = useState(false);
  const [discussionInput, setDiscussionInput] = useState('');
  const [discussionSecondsLeft, setDiscussionSecondsLeft] = useState<number | null>(null);

  // Reset voting state when a new cycle starts so players can vote again in round 2+
  useEffect(() => {
    if (!socket) return;
    const onNewCycle = () => {
      setHasVoted(false);
      setSelectedVote(null);
    };
    socket.on('new-cycle-started', onNewCycle);
    return () => { socket.off('new-cycle-started', onNewCycle); };
  }, [socket]);

  // Countdown for discussion phase
  useEffect(() => {
    if (gameState.phase !== 'discussion' || gameState.discussionEndsAt == null) {
      setDiscussionSecondsLeft(null);
      return;
    }
    const update = () => {
      const left = Math.max(0, Math.ceil((gameState.discussionEndsAt! - Date.now()) / 1000));
      setDiscussionSecondsLeft(left);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [gameState.phase, gameState.discussionEndsAt]);
  
  // Memoize shuffled player order - consistent within a game session using room code as seed
  const shuffledPlayers = React.useMemo(() => {
    if (!gameState.players.length || !roomState.roomCode) return gameState.players;
    return shuffleWithSeed(gameState.players, roomState.roomCode);
  }, [gameState.players, roomState.roomCode]);
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.SETUP);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [player4Role, setPlayer4Role] = useState<Role | undefined>(undefined);
  const [player4Word, setPlayer4Word] = useState<string | undefined>(undefined);
  const [isPlayer4Thinking, setIsPlayer4Thinking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [aiGuesses, setAiGuesses] = useState<Record<string, string>>({});
  const [civiliansWon, setCiviliansWon] = useState<boolean>(false);
  const [submittedDescriptions, setSubmittedDescriptions] = useState<Set<string>>(new Set());
  const [currentGameWords, setCurrentGameWords] = useState<{ civilianWord: string; undercoverWord: string } | null>(null);
  const [tieRound, setTieRound] = useState(false);
  const [lastVoteCounts, setLastVoteCounts] = useState<{ playerId: string; playerName: string; votes: number }[] | null>(null);

  const humanPlayers = useMemo(() => players.filter(p => p.isHuman), [players]);
  const player4 = useMemo(() => players.find(p => p.id === PLAYER_4_NAME), [players]);

  const addChatMessage = useCallback((message: ChatMessage) => {
    setChatMessages(prev => [...prev, message]);
  }, []);

  const resetGame = useCallback(() => {
    setPlayers([]);
    setGamePhase(GamePhase.SETUP);
    setChatMessages([]);
    setPlayer4Role(undefined);
    setPlayer4Word(undefined);
    setIsPlayer4Thinking(false);
    setError(null);
    setAiGuesses({});
    setCiviliansWon(false);
    setSubmittedDescriptions(new Set());
    setCurrentGameWords(null);
    setTieRound(false);
    setLastVoteCounts(null);
  }, []);

  const startGame = useCallback(() => {
    const [civilianWord, undercoverWord] = getRandomWordPair();
    setCurrentGameWords({ civilianWord, undercoverWord });
    const roles: Role[] = [Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.UNDERCOVER];
    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    const initialPlayers: Player[] = PLAYER_NAMES.map((name, index) => {
      const role = roles[index];
      const word = role === Role.CIVILIAN ? civilianWord : undercoverWord;
      return {
        id: name,
        name: name,
        isHuman: name !== PLAYER_4_NAME,
        role: name === PLAYER_4_NAME ? role : undefined, // Only P4 knows its role initially
        word: name === PLAYER_4_NAME ? word : undefined, // Only P4 knows its word initially
        description: '',
        voteTarget: '',
      };
    });

    setPlayers(initialPlayers);
    setPlayer4Role(initialPlayers.find(p => p.id === PLAYER_4_NAME)?.role);
    setPlayer4Word(initialPlayers.find(p => p.id === PLAYER_4_NAME)?.word);
    setGamePhase(GamePhase.DESCRIPTION);
    addChatMessage({
      player: 'System',
      type: 'system',
      content: `Game started! ${civilianWord} (Civilians) vs ${undercoverWord} (Undercover). Player_4 is ${initialPlayers.find(p => p.id === PLAYER_4_NAME)?.role}.`,
    });
    addChatMessage({ player: 'System', type: 'system', content: 'Description Phase: Enter a 1-sentence description of your word.' });
  }, [addChatMessage]);

  const handleDescriptionChange = useCallback((playerId: string, description: string) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(p => (p.id === playerId ? { ...p, description } : p))
    );
  }, []);

  const handleDescriptionSubmit = useCallback((playerId: string, description: string) => {
    if (description && description.trim() !== '') {
      setSubmittedDescriptions(prev => new Set(prev).add(playerId));
    }
  }, []);

  const handleVoteChange = useCallback((playerId: string, voteTarget: string) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(p => (p.id === playerId ? { ...p, voteTarget } : p))
    );
  }, []);

  const handleAiGuessChange = useCallback((playerId: string, guess: string) => {
    setAiGuesses(prev => ({ ...prev, [playerId]: guess }));
  }, []);

  const allHumanDescriptionsEntered = useMemo(() => {
    return humanPlayers.every(p => submittedDescriptions.has(p.id));
  }, [humanPlayers, submittedDescriptions]);

  const allHumanVotesEntered = useMemo(() => {
    return humanPlayers.every(p => p.voteTarget && p.voteTarget.trim() !== '');
  }, [humanPlayers]);

  // Player_4's description turn
  useEffect(() => {
    const player4HasDescription = player4?.description && player4.description.trim() !== '';

    if (gamePhase === GamePhase.DESCRIPTION && allHumanDescriptionsEntered && !player4HasDescription && player4Role && player4Word) {
      setIsPlayer4Thinking(true);
      setError(null);
      const otherDescriptions = players
        .filter(p => p.isHuman)
        .map(p => p.description || '');

      generatePlayer4Description(player4Role, player4Word, otherDescriptions, currentGameWords ?? undefined)
        .then(response => {
          setPlayers(prevPlayers =>
            prevPlayers.map(p =>
              p.id === PLAYER_4_NAME ? { ...p, description: response.content } : p
            )
          );
          addChatMessage({
            player: PLAYER_4_NAME,
            type: 'description',
            content: response.content,
          });
          console.debug('Player_4 Description Thought Process:', response.thought_process);
        })
        .catch(err => {
          console.error('Error generating Player_4 description:', err);
          setError('Failed to get Player_4 description. Please try again.');
          // Provide a fallback description
          setPlayers(prevPlayers =>
            prevPlayers.map(p =>
              p.id === PLAYER_4_NAME ? { ...p, description: "uhh, it's a drink..." } : p
            )
          );
        })
        .finally(() => {
          setIsPlayer4Thinking(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, allHumanDescriptionsEntered, player4Role, player4Word]); // Do NOT include players or player4 in deps

  // Player_4's voting turn
  useEffect(() => {
    const player4HasVote = player4?.voteTarget && player4.voteTarget.trim() !== '';

    if (gamePhase === GamePhase.VOTING && allHumanVotesEntered && !player4HasVote && player4Role && player4Word) {
      setIsPlayer4Thinking(true);
      setError(null);
      const allDescriptions = players.map(p => ({
        player: p.name,
        description: p.description || '',
      }));

      generatePlayer4Vote(player4Role, player4Word, allDescriptions, currentGameWords ?? undefined)
        .then(response => {
          setPlayers(prevPlayers =>
            prevPlayers.map(p =>
              p.id === PLAYER_4_NAME ? { ...p, voteTarget: response.vote_target || '', description: response.content } : p
            )
          );
          addChatMessage({
            player: PLAYER_4_NAME,
            type: 'vote',
            content: `i vote for ${response.vote_target}. ${response.content}`,
          });
          console.debug('Player_4 Vote Thought Process:', response.thought_process);
        })
        .catch(err => {
          console.error('Error generating Player_4 vote:', err);
          setError('Failed to get Player_4 vote. Please try again.');
          // Fallback vote
          setPlayers(prevPlayers =>
            prevPlayers.map(p =>
              p.id === PLAYER_4_NAME ? { ...p, voteTarget: humanPlayers[0]?.id || '', description: 'idk, just a feeling' } : p
            )
          );
        })
        .finally(() => {
          setIsPlayer4Thinking(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, allHumanVotesEntered, player4Role, player4Word, humanPlayers]); // Do NOT include players or player4 in deps

  const advancePhase = useCallback(() => {
    if (gamePhase === GamePhase.DESCRIPTION) {
      if (!players.every(p => p.description && p.description.trim() !== '')) {
        setError('All players must enter a description first!');
        return;
      }
      setGamePhase(GamePhase.VOTING);
      addChatMessage({ player: 'System', type: 'system', content: 'Voting Phase: Vote for the player you think has a different word.' });
    } else if (gamePhase === GamePhase.VOTING) {
      if (!players.every(p => p.voteTarget && p.voteTarget.trim() !== '')) {
        setError('All players must vote first!');
        return;
      }
      
      // Count votes and detect tie (multiple players with same max votes)
      const voteCounts: Record<string, number> = {};
      players.forEach(p => {
        if (p.voteTarget) {
          voteCounts[p.voteTarget] = (voteCounts[p.voteTarget] || 0) + 1;
        }
      });
      const maxVotes = Math.max(0, ...Object.values(voteCounts));
      const playersWithMaxVotes = maxVotes > 0
        ? Object.entries(voteCounts).filter(([, v]) => v === maxVotes).map(([id]) => id)
        : [];
      const isTie = playersWithMaxVotes.length !== 1;

      if (isTie) {
        setCiviliansWon(false);
        setTieRound(true);
        setLastVoteCounts(
          Object.entries(voteCounts)
            .map(([playerId, votes]) => ({
              playerId,
              playerName: players.find(p => p.id === playerId)?.name ?? playerId,
              votes,
            }))
            .sort((a, b) => b.votes - a.votes)
        );
        setGamePhase(GamePhase.RESULTS);
        addChatMessage({ player: 'System', type: 'system', content: 'No one was eliminated (tie). New round!' });
      } else {
        const mostVoted = playersWithMaxVotes[0];
        const undercoverPlayer = players.find(p => p.role === Role.UNDERCOVER);
        const didCiviliansWin = mostVoted === undercoverPlayer?.id;
        setCiviliansWon(didCiviliansWin);
        const civilianWord = currentGameWords?.civilianWord ?? '';
        const finalPlayers = players.map(p => {
          if (p.isHuman) {
            return { ...p, role: Role.CIVILIAN, word: p.word ?? civilianWord };
          }
          return p;
        });
        setPlayers(finalPlayers);
        if (didCiviliansWin) {
          setGamePhase(GamePhase.RESULTS);
          addChatMessage({ player: 'System', type: 'system', content: 'Results Phase! Civilians found the Undercover!' });
        } else {
          setGamePhase(GamePhase.AI_GUESS);
          addChatMessage({ 
            player: 'System', 
            type: 'system', 
            content: 'Civilians failed! But wait... can you guess who is the AI player? Guess correctly to redeem yourself!' 
          });
        }
      }
    } else if (gamePhase === GamePhase.AI_GUESS) {
      setGamePhase(GamePhase.FINAL_RESULTS);
      addChatMessage({ player: 'System', type: 'system', content: 'Final Results!' });
    }
    setError(null);
  }, [gamePhase, players, addChatMessage, currentGameWords]);

  const renderGameContent = () => {
    switch (gamePhase) {
      case GamePhase.SETUP:
        return (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Undercover</h2>
            <p className="mb-6">Each game uses a random pair of related words. 3 Civilians share one word, 1 Undercover has a different word. Find the Undercover!</p>
            <Button onClick={startGame} disabled={isPlayer4Thinking}>
              Start Game
            </Button>
          </div>
        );
      case GamePhase.DESCRIPTION:
      case GamePhase.VOTING:
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-center">
              {gamePhase === GamePhase.DESCRIPTION ? 'Description Phase' : 'Voting Phase'}
            </h2>
            <p className="text-center text-lg mb-6">
              Player_4's word: <span className="font-semibold text-blue-600">{player4Word}</span> (Role: <span className="font-semibold text-blue-600">{player4Role}</span>)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {players.map(player => (
                <PlayerCard key={player.id} player={player}>
                  {player.isHuman ? (
                    gamePhase === GamePhase.DESCRIPTION ? (
                      <div className="mt-2 w-full">
                        <InputField
                          placeholder={submittedDescriptions.has(player.id) ? '' : `Press Enter to submit`}
                          value={player.description || ''}
                          onChange={(e) => handleDescriptionChange(player.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleDescriptionSubmit(player.id, player.description || '');
                            }
                          }}
                          disabled={isPlayer4Thinking || submittedDescriptions.has(player.id)}
                          className="w-full"
                        />
                        {submittedDescriptions.has(player.id) ? (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">Submitted!</p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1">Press Enter to submit</p>
                        )}
                      </div>
                    ) : (
                      <select
                        className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
                        value={player.voteTarget || ''}
                        onChange={(e) => handleVoteChange(player.id, e.target.value)}
                        disabled={isPlayer4Thinking}
                      >
                        <option value="" disabled>Vote for someone...</option>
                        {players
                          .filter(p => p.id !== player.id) // Can't vote for self
                          .map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    )
                  ) : (
                    <div className="mt-2 text-gray-600 dark:text-gray-400 italic">
                      {isPlayer4Thinking ? 'Player_4 is thinking...' : player.description || 'Waiting for Player_4...'}
                    </div>
                  )}
                </PlayerCard>
              ))}
            </div>
            {error && <p className="text-red-600 text-center mb-4">{error}</p>}
            <div className="flex justify-center mt-auto pb-4">
              <Button onClick={advancePhase} disabled={isPlayer4Thinking}>
                {gamePhase === GamePhase.DESCRIPTION ? 'Go to Voting' : 'Go to Results'}
              </Button>
            </div>
          </>
        );
      case GamePhase.RESULTS:
        if (tieRound) {
          return (
            <>
              <h2 className="text-2xl font-bold mb-4 text-center text-amber-700 dark:text-amber-400">
                It&apos;s a tie!
              </h2>
              <p className="text-xl text-center mb-6">
                No one was eliminated. New round — describe your word again.
              </p>
              {lastVoteCounts && lastVoteCounts.length > 0 && (
                <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg max-w-md mx-auto">
                  <p className="font-semibold mb-2">Vote counts:</p>
                  <ul className="list-disc list-inside">
                    {lastVoteCounts.map(({ playerName, votes }) => (
                      <li key={playerName}>{playerName}: {votes} vote{votes !== 1 ? 's' : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-center mt-auto pb-4">
                <Button onClick={() => {
                  setPlayers(prev => prev.map(p => ({ ...p, description: '', voteTarget: '' })));
                  setSubmittedDescriptions(new Set());
                  setTieRound(false);
                  setLastVoteCounts(null);
                  setGamePhase(GamePhase.DESCRIPTION);
                  addChatMessage({ player: 'System', type: 'system', content: 'Description Phase: Enter a 1-sentence description of your word.' });
                }}>
                  Next round
                </Button>
              </div>
            </>
          );
        }
        return (
          <>
            <h2 className="text-3xl font-bold mb-6 text-center text-emerald-700 dark:text-emerald-400">
              Civilians Win!
            </h2>
            <p className="text-xl text-center mb-8">
              The Undercover ({player4Role === Role.UNDERCOVER ? 'Player_4' : 'was found'}) has been eliminated!
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {players.map(player => (
                <PlayerCard key={player.id} player={player}>
                  <p className="text-sm">
                    <span className="font-semibold">Role:</span> {player.role}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Word:</span> {player.word}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Description:</span> "{player.description}"
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Voted For:</span> {player.voteTarget || 'No vote'}
                  </p>
                </PlayerCard>
              ))}
            </div>
            <div className="flex justify-center mt-auto pb-4">
              <Button onClick={resetGame}>Play Again</Button>
            </div>
          </>
        );

      case GamePhase.AI_GUESS:
        return (
          <>
            <h2 className="text-2xl font-bold mb-4 text-center text-orange-600 dark:text-orange-400">
              Second Chance: Find the AI!
            </h2>
            <p className="text-center mb-6 text-gray-600 dark:text-gray-400">
              The Undercover won this round, but you can still redeem yourself!
              <br />
              <span className="font-semibold">Which player do you think is actually an AI?</span>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {humanPlayers.map(player => (
                <PlayerCard key={player.id} player={player}>
                  <p className="text-sm mb-2 text-gray-500">Your description: "{player.description}"</p>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
                    value={aiGuesses[player.id] || ''}
                    onChange={(e) => handleAiGuessChange(player.id, e.target.value)}
                  >
                    <option value="" disabled>Who is the AI?</option>
                    {players.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </PlayerCard>
              ))}
            </div>
            {error && <p className="text-red-600 text-center mb-4">{error}</p>}
            <div className="flex justify-center mt-auto pb-4">
              <Button onClick={advancePhase}>Reveal AI</Button>
            </div>
          </>
        );

      case GamePhase.FINAL_RESULTS:
        const humansWhoGuessedAI = humanPlayers.filter(
          p => aiGuesses[p.id] === PLAYER_4_NAME
        );
        const anyoneGuessedCorrectly = humansWhoGuessedAI.length > 0;

        return (
          <>
            <h2 className="text-3xl font-bold mb-6 text-center text-purple-700 dark:text-purple-400">
              Final Results!
            </h2>
            
            <div className="text-center mb-8 p-4 rounded-lg bg-gray-100 dark:bg-gray-700">
              <p className="text-xl mb-4">
                The AI was: <span className="font-bold text-blue-600 dark:text-blue-400">Player_4</span>
                {player4Role && (
                  <span className="ml-2 text-sm">
                    (who was the <span className="font-semibold">{player4Role}</span> with word "{player4Word}")
                  </span>
                )}
              </p>
              
              {anyoneGuessedCorrectly ? (
                <div className="text-green-600 dark:text-green-400 text-lg font-semibold">
                  {humansWhoGuessedAI.map(p => p.name).join(', ')} correctly identified the AI and wins!
                </div>
              ) : (
                <div className="text-red-600 dark:text-red-400 text-lg font-semibold">
                  No one guessed the AI correctly. Complete AI victory!
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {players.map(player => (
                <PlayerCard key={player.id} player={player}>
                  <p className="text-sm">
                    <span className="font-semibold">Role:</span> {player.role}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Word:</span> {player.word}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Description:</span> "{player.description}"
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Voted For:</span> {player.voteTarget || 'No vote'}
                  </p>
                  {player.isHuman && (
                    <p className="text-sm mt-2">
                      <span className="font-semibold">AI Guess:</span> {aiGuesses[player.id] || 'None'}
                      {aiGuesses[player.id] === PLAYER_4_NAME && (
                        <span className="ml-1 text-green-600 dark:text-green-400 font-bold">✓</span>
                      )}
                    </p>
                  )}
                  {player.id === PLAYER_4_NAME && (
                    <p className="text-xs italic mt-2 text-blue-500 dark:text-blue-400">
                      (This was the AI player)
                    </p>
                  )}
                </PlayerCard>
              ))}
            </div>
            <div className="flex justify-center mt-auto pb-4">
              <Button onClick={resetGame}>Play Again</Button>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  // Show Lobby if room is not full yet OR game hasn't started
  if (!roomState.isRoomFull || !gameState.isGameStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center p-4 bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
        <header className="w-full max-w-4xl text-center py-6">
          <h1 className="text-4xl font-extrabold text-blue-700 dark:text-blue-400">
            Undercover
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">A Social Deduction Game with AI</p>
        </header>
        <main className="flex-grow w-full max-w-2xl p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
          <Lobby />
        </main>
      </div>
    );
  }

  // Render game content based on phase
  const renderMultiplayerGame = () => {
    const allDescriptionsRevealed = gameState.players.every(p => p.description && p.description.length > 0);
    const allHumansSubmittedDescriptions = gameState.players.filter(p => p.id !== 'AI_PLAYER').every(p => p.hasSubmittedDescription);
    const myPlayer = gameState.players.find(p => p.id === gameState.myPlayerId);
    
    // DESCRIPTION PHASE (turn-based)
    if (gameState.phase === 'description') {
      const currentTurnPlayer = gameState.currentTurnPlayerId ? gameState.players.find(p => p.id === gameState.currentTurnPlayerId) : null;
      const isMyTurn = gameState.currentTurnPlayerId === gameState.myPlayerId;
      const amINext = gameState.nextTurnPlayerId === gameState.myPlayerId;
      const isNewCycle = gameState.votingResults?.outcome === 'new_cycle';

      return (
        <>
          {isNewCycle && (
            <div className="mb-4 p-3 bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg text-center">
              {gameState.votingResults?.eliminatedPlayer ? (
                <><strong>{gameState.votingResults.eliminatedPlayer.name}</strong> was eliminated. New round — describe your word in order.</>
              ) : (
                <>It&apos;s a tie! No one was eliminated. New round — describe your word in order.</>
              )}
            </div>
          )}
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold">{gameState.cycleNumber ? `Round ${gameState.cycleNumber} — ` : ''}Description Phase (turn-based)</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Each player describes their word in order. Wait for your turn.
            </p>
          </div>

          {/* Current turn / Next */}
          <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg flex flex-wrap items-center justify-center gap-4">
            <span className="font-semibold">
              Current turn: <span className="text-blue-600 dark:text-blue-400">{currentTurnPlayer?.name ?? '—'}</span>
            </span>
            {gameState.nextTurnPlayerId && (
              <span className={amINext ? 'font-bold text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}>
                Next: {amINext ? 'You' : gameState.players.find(p => p.id === gameState.nextTurnPlayerId)?.name ?? '—'}
              </span>
            )}
            {gameState.aiThinking && (
              <span className="text-yellow-600 dark:text-yellow-400 animate-pulse">{currentTurnPlayer?.name ?? 'Someone'} is thinking...</span>
            )}
          </div>

          {/* Transcript so far — in original speaking order (descriptionTurnOrder) */}
          {(() => {
            const orderedDescriptions = (gameState.descriptionTurnOrder?.length
              ? gameState.descriptionTurnOrder
                  .map((pid) => {
                    const fromTranscript = gameState.descriptionTranscript?.find((e) => e.playerId === pid);
                    const fromPlayer = gameState.players.find((p) => p.id === pid);
                    const description = fromTranscript?.description ?? fromPlayer?.description;
                    const playerName = fromTranscript?.playerName ?? fromPlayer?.name ?? pid;
                    return description ? { playerId: pid, playerName, description } : null;
                  })
                  .filter((x): x is { playerId: string; playerName: string; description: string } => x != null)
              : gameState.descriptionTranscript?.length
                ? gameState.descriptionTranscript
                : []
            );
            return orderedDescriptions.length > 0 ? (
              <div className="mb-4 p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                <h4 className="font-bold mb-2">Descriptions so far:</h4>
                <ol className="list-decimal list-inside space-y-1 text-gray-800 dark:text-gray-200">
                  {orderedDescriptions.map((entry, i) => (
                    <li key={entry.playerId}><span className="font-medium">{entry.playerName}:</span> &quot;{entry.description}&quot;</li>
                  ))}
                </ol>
              </div>
            ) : null;
          })()}

          {allDescriptionsRevealed && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-lg text-center">
              All descriptions revealed! Discussion phase will start next.
            </div>
          )}

          {/* Input only when it's your turn, you're human, and you're alive (not eliminated) */}
          {!allDescriptionsRevealed && isMyTurn && myPlayer && myPlayer.id !== 'AI_PLAYER' && !myPlayer.hasSubmittedDescription && !myPlayer.isEliminated && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900 rounded-lg border-2 border-blue-400">
              <p className="font-bold mb-2">Your turn — describe your word (press Enter to submit):</p>
              <InputField
                placeholder="Describe your word without saying it..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.target as HTMLInputElement;
                    if (input.value.trim()) submitDescription(input.value.trim());
                  }
                }}
                className="w-full"
              />
            </div>
          )}

          {myPlayer?.isEliminated && (
            <div className="mb-4 p-3 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-center">
              You have been eliminated. You cannot describe or vote this round.
            </div>
          )}

          {!allDescriptionsRevealed && !isMyTurn && !gameState.aiThinking && !myPlayer?.isEliminated && (
            <div className="mb-4 p-3 text-center text-gray-600 dark:text-gray-400">
              {amINext ? "You're next — get ready!" : `Waiting for ${currentTurnPlayer?.name ?? 'current player'}...`}
            </div>
          )}

          {/* Player list in speaking order (descriptionTurnOrder) so AI appears in correct position */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(gameState.descriptionTurnOrder?.length
              ? gameState.descriptionTurnOrder
                  .map((pid) => gameState.players.find((p) => p.id === pid))
                  .filter((p): p is NonNullable<typeof p> => p != null)
              : shuffledPlayers
            ).map((player) => (
              <div key={player.id} className={`p-4 rounded-lg border-2 ${
                player.isEliminated ? 'bg-gray-200 dark:bg-gray-600 border-gray-400 opacity-75' :
                player.id === gameState.myPlayerId ? 'bg-blue-50 dark:bg-blue-900 border-blue-400' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600'
              }`}>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-bold">{player.name} {player.id === gameState.myPlayerId && <span className="text-blue-500">(You)</span>} {player.isEliminated && <span className="text-gray-500 text-sm font-normal">— Eliminated</span>}</h4>
                  {player.isEliminated ? <span className="text-gray-500 text-sm">Eliminated</span> : player.hasSubmittedDescription ? <span className="text-green-500 text-sm">✓</span> : gameState.currentTurnPlayerId === player.id && <span className="text-blue-500 text-sm">— speaking</span>}
                </div>
                <div className={player.description ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500 italic'}>
                  {player.description ? `"${player.description}"` : player.hasSubmittedDescription ? '(submitted)' : player.isEliminated ? '—' : 'Waiting for turn...'}
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }

    // DISCUSSION PHASE
    if (gameState.phase === 'discussion') {
      const timeUp = discussionSecondsLeft !== null && discussionSecondsLeft <= 0;
      // Show descriptions in original speaking order (descriptionTurnOrder), not submission/array order
      const descriptionsToShow = gameState.descriptionTurnOrder?.length
        ? gameState.descriptionTurnOrder
            .map((pid) => {
              const fromTranscript = gameState.descriptionTranscript?.find((e) => e.playerId === pid);
              const fromPlayer = gameState.players.find((p) => p.id === pid);
              const description = fromTranscript?.description ?? fromPlayer?.description;
              const playerName = fromTranscript?.playerName ?? fromPlayer?.name ?? pid;
              return description ? { playerName, description } : null;
            })
            .filter((x): x is { playerName: string; description: string } => x != null)
        : gameState.descriptionTranscript?.length
          ? gameState.descriptionTranscript.map((e) => ({ playerName: e.playerName, description: e.description }))
          : gameState.players.filter(p => p.description).map(p => ({ playerName: p.name, description: p.description! }));

      return (
        <>
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold">{gameState.cycleNumber ? `Round ${gameState.cycleNumber} — ` : ''}Discussion Phase</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Discuss who might be Undercover. 30 seconds.
            </p>
          </div>

          {/* What everyone said - show all 4 descriptions for reference during discussion */}
          {descriptionsToShow.length > 0 && (
            <div className="mb-4 p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
              <h4 className="font-bold mb-2">What everyone said:</h4>
              <ol className="list-decimal list-inside space-y-1 text-gray-800 dark:text-gray-200">
                {descriptionsToShow.map((entry, i) => (
                  <li key={i}>
                    <span className="font-medium">{entry.playerName}:</span> &quot;{entry.description}&quot;
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
            {discussionSecondsLeft !== null ? (
              timeUp ? (
                <span className="text-gray-500">Discussion ended. Voting will start shortly.</span>
              ) : (
                <span className="font-semibold">Time left: 0:{String(discussionSecondsLeft).padStart(2, '0')}</span>
              )
            ) : null}
          </div>

          {/* Discussion messages */}
          <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 max-h-48 overflow-y-auto">
            {gameState.discussionMessages && gameState.discussionMessages.length > 0 ? (
              <div className="space-y-2">
                {gameState.discussionMessages.map((entry, i) => (
                  <div key={i} className="flex flex-col">
                    <span className="font-semibold text-sm text-blue-600 dark:text-blue-400">{entry.playerName}:</span>
                    <span className="text-gray-800 dark:text-gray-200">{entry.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 italic text-center">No messages yet. Start the discussion!</p>
            )}
          </div>

          {/* Chat input — only for alive players; messages from everyone (alive and eliminated) shown above */}
          {!timeUp && myPlayer && !myPlayer.isEliminated && (
            <div className="flex gap-2 mb-6">
              <InputField
                placeholder="Type a message..."
                value={discussionInput}
                onChange={(e) => setDiscussionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (discussionInput.trim()) {
                      sendDiscussionMessage(discussionInput.trim());
                      setDiscussionInput('');
                    }
                  }
                }}
                className="flex-1"
              />
              <Button
                onClick={() => {
                  if (discussionInput.trim()) {
                    sendDiscussionMessage(discussionInput.trim());
                    setDiscussionInput('');
                  }
                }}
              >
                Send
              </Button>
            </div>
          )}
          {!timeUp && myPlayer?.isEliminated && (
            <div className="mb-4 p-3 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-center">
              You have been eliminated. You cannot send messages.
            </div>
          )}

          {timeUp && (
            <div className="text-center mb-4">
              <Button onClick={advanceToVoting}>Proceed to Voting</Button>
            </div>
          )}
        </>
      );
    }

    // VOTING PHASE
    if (gameState.phase === 'voting') {
      const alivePlayers = gameState.players.filter(p => !p.isEliminated);
      const eliminatedPlayers = gameState.players.filter(p => p.isEliminated);
      const allAliveHumansVoted = alivePlayers.filter(p => p.id !== 'AI_PLAYER').every(p => p.hasVoted);
      const canVote = myPlayer && !myPlayer.isEliminated;
      
      return (
        <>
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold">{gameState.cycleNumber ? `Round ${gameState.cycleNumber} — ` : ''}Voting Phase</h3>
            <p className="text-gray-600 dark:text-gray-400">Vote for the player you think has a different word!</p>
          </div>

          {!canVote && (
            <div className="mb-4 p-3 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-center">
              You have been eliminated. You cannot vote.
            </div>
          )}

          {canVote && allAliveHumansVoted && !hasVoted && (
            <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-lg text-center animate-pulse">
              Waiting for the last player to vote...
            </div>
          )}

          {/* Alive players — vote targets (clickable) */}
          {canVote && (
            <div className="mb-4">
              <h4 className="font-bold mb-2 text-gray-700 dark:text-gray-300">Vote for a player:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {alivePlayers.map((player) => (
                  <div key={player.id} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedVote === player.id ? 'border-red-500 bg-red-50 dark:bg-red-900' :
                    player.id === gameState.myPlayerId ? 'bg-blue-50 dark:bg-blue-900 border-blue-400' : 
                    'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-red-300'
                  }`} onClick={() => !hasVoted && player.id !== gameState.myPlayerId && setSelectedVote(player.id)}>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold">{player.name} {player.id === gameState.myPlayerId && <span className="text-blue-500">(You)</span>}</h4>
                      {player.hasVoted && <span className="text-green-500 text-sm">✓ Voted</span>}
                    </div>
                    <div className="text-gray-800 dark:text-gray-200">"{player.description}"</div>
                    {selectedVote === player.id && <div className="mt-2 text-red-600 font-bold">Selected for vote</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Eliminated players — greyed out, not clickable */}
          {eliminatedPlayers.length > 0 && (
            <div className="mb-4">
              <h4 className="font-bold mb-2 text-gray-500 dark:text-gray-400">Eliminated:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {eliminatedPlayers.map((player) => (
                  <div key={player.id} className="p-4 rounded-lg border-2 bg-gray-200 dark:bg-gray-600 border-gray-400 opacity-75 cursor-not-allowed">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold text-gray-600 dark:text-gray-400">{player.name} {player.id === gameState.myPlayerId && <span className="text-blue-400">(You)</span>}</h4>
                      <span className="text-gray-500 text-sm">Eliminated</span>
                    </div>
                    <div className="text-gray-500 dark:text-gray-400">"{player.description}"</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canVote && !hasVoted && selectedVote && (
            <div className="text-center">
              <Button onClick={() => { submitVote(selectedVote); setHasVoted(true); }}>
                Submit Vote for {alivePlayers.find(p => p.id === selectedVote)?.name}
              </Button>
            </div>
          )}
          {canVote && hasVoted && <div className="text-center text-green-600 font-bold">Vote submitted! Waiting for results...</div>}
        </>
      );
    }

    // RESULTS PHASE
    if (gameState.phase === 'results' && gameState.votingResults) {
      const results = gameState.votingResults;
      const iWon = (results.civiliansWon && myPlayer?.role === 'Civilian') || (!results.civiliansWon && myPlayer?.role === 'Undercover');
      
      return (
        <>
          <div className="mb-6 text-center">
            <h3 className="text-3xl font-bold mb-4">{results.civiliansWon ? '🎉 Civilians Win!' : '😈 Undercover Wins!'}</h3>
            <p className="text-xl">{results.eliminatedPlayer ? `${results.eliminatedPlayer.name} was eliminated!` : 'No one was eliminated (tie)'}</p>
            <p className="text-lg mt-2">You were: <span className="font-bold">{myPlayer?.role}</span> - {iWon ? '✅ You Won!' : '❌ You Lost'}</p>
          </div>

          {/* Who voted for whom - includes AI player */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border-2 border-blue-200 dark:border-blue-700">
            <h4 className="font-bold mb-3 text-lg">Who voted for whom</h4>
            <ul className="space-y-1">
              {results.allPlayers.map(player => {
                const targetName = player.voteTarget ? results.allPlayers.find(p => p.id === player.voteTarget)?.name : null;
                return (
                  <li key={player.id} className="flex justify-between items-center gap-2">
                    <span className="font-medium">{player.name}</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      → voted for <span className="font-semibold">{targetName ?? 'N/A'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <h4 className="font-bold mb-2">Votes received (tally)</h4>
            {results.voteCounts.map(vc => (
              <div key={vc.playerId} className="flex justify-between">
                <span>{vc.playerName}</span>
                <span>{vc.votes} vote{vc.votes !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>

          {/* Player cards - do NOT reveal who is AI until Final Results (Guess the AI phase) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {shuffleWithSeed<typeof results.allPlayers[0]>(results.allPlayers, roomState.roomCode || '').map(player => (
              <div key={player.id} className={`p-4 rounded-lg border-2 ${
                player.role === 'Undercover' ? 'border-red-500 bg-red-50 dark:bg-red-900' : 
                'border-green-500 bg-green-50 dark:bg-green-900'
              }`}>
                <h4 className="font-bold">
                  {player.name}
                </h4>
                <p>Role: <span className="font-bold">{player.role}</span></p>
                <p>Word: "{player.word}"</p>
                <p>Voted for: <span className="font-semibold">{player.voteTarget ? results.allPlayers.find(p => p.id === player.voteTarget)?.name : 'N/A'}</span></p>
              </div>
            ))}
          </div>

          <div className="text-center p-4 bg-purple-100 dark:bg-purple-900 rounded-lg">
            <p className="text-lg mb-2">🤖 Everyone gets to guess who the AI is!</p>
            <Button onClick={advanceToAIGuess}>Guess the AI</Button>
          </div>
        </>
      );
    }

    // AI GUESS PHASE
    if (gameState.phase === 'ai_guess') {
      const iNeedToGuess = gameState.playersWhoNeedToGuessAI.includes(gameState.myPlayerId || '');
      
      return (
        <>
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold">🤖 Guess the AI!</h3>
            <p className="text-gray-600 dark:text-gray-400">
              {iNeedToGuess ? 'Select who you think is the AI player' : 'Waiting for other players to guess...'}
            </p>
          </div>

          {iNeedToGuess && !hasGuessedAI && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {shuffledPlayers.map((player) => (
                <div key={player.id} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedAIGuess === player.id ? 'border-purple-500 bg-purple-50 dark:bg-purple-900' : 
                  'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-purple-300'
                }`} onClick={() => setSelectedAIGuess(player.id)}>
                  <h4 className="font-bold">{player.name}</h4>
                  <div className="text-gray-600">"{player.description}"</div>
                  {selectedAIGuess === player.id && <div className="mt-2 text-purple-600 font-bold">Selected as AI</div>}
                </div>
              ))}
            </div>
          )}

          {iNeedToGuess && !hasGuessedAI && selectedAIGuess && (
            <div className="text-center">
              <Button onClick={() => { submitAIGuess(selectedAIGuess); setHasGuessedAI(true); }}>
                Confirm: {shuffledPlayers.find(p => p.id === selectedAIGuess)?.name} is the AI
              </Button>
            </div>
          )}

          {hasGuessedAI && <div className="text-center text-green-600 font-bold">Guess submitted! Waiting for others...</div>}
        </>
      );
    }

    // FINAL RESULTS PHASE
    if (gameState.phase === 'final_results' && gameState.finalResults) {
      const finalResults = gameState.finalResults;
      const iGuessedCorrectly = finalResults.aiGuessWinners.some(w => w.id === gameState.myPlayerId);
      const civiliansWon = finalResults.civiliansWon ?? gameState.votingResults?.civiliansWon ?? false;
      const wonRound = (civiliansWon && myPlayer?.role === 'Civilian') || (!civiliansWon && myPlayer?.role === 'Undercover');
      const isHuman = gameState.playersWhoNeedToGuessAI.includes(gameState.myPlayerId || '');

      const scenarioMessages: Record<string, string> = {
        'won-guessed': 'You won the Undercover game — and you found the correct AI player! Double win! Congrats!',
        'lost-guessed': "You lost the Undercover game — but you found the correct AI player! You're a great AI spotter!",
        'won-notguessed': "You won the Undercover game — but you didn't detect the AI player. That AI was too cunning!",
        'lost-notguessed': "You lost the Undercover game — and you didn't detect the AI player. Double oof! Good luck next game!",
      };
      const scenarioKey = wonRound ? (iGuessedCorrectly ? 'won-guessed' : 'won-notguessed') : (iGuessedCorrectly ? 'lost-guessed' : 'lost-notguessed');
      const scenarioMessage = scenarioMessages[scenarioKey];

      return (
        <>
          <div className="mb-6 text-center">
            <h3 className="text-3xl font-bold mb-4">🏆 Final Results</h3>
          </div>

          <div className="mb-6 p-4 bg-purple-100 dark:bg-purple-900 rounded-lg text-center">
            <h4 className="text-xl font-bold mb-2">The AI was: {finalResults.aiPlayer.name}</h4>
            <p>Role: {finalResults.aiPlayer.role}</p>
          </div>

          {isHuman && scenarioMessage && (
            <div className="mb-6 p-4 bg-slate-100 dark:bg-slate-700 rounded-lg text-center">
              <p className="text-xl font-medium">{scenarioMessage}</p>
            </div>
          )}

          {finalResults.aiGuessWinners.length > 0 && (
            <div className="mb-6 p-4 bg-green-100 dark:bg-green-900 rounded-lg">
              <h4 className="font-bold mb-2">🎉 Correct AI Guesses (AI Spotters!):</h4>
              {finalResults.aiGuessWinners.map(w => (
                <div key={w.id} className={w.id === gameState.myPlayerId ? 'font-bold text-green-700' : ''}>
                  {w.name} {w.id === gameState.myPlayerId && '(You!)'}
                </div>
              ))}
            </div>
          )}

          {finalResults.allGuesses.length > 0 && (
            <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <h4 className="font-bold mb-2">All AI Guesses:</h4>
              {finalResults.allGuesses.map(g => (
                <div key={g.playerId} className="flex justify-between">
                  <span>{g.playerName} guessed {gameState.players.find(p => p.id === g.guessedId)?.name}</span>
                  <span>{g.correct ? '✅ Correct!' : '❌ Wrong'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-center">
            <p className="text-gray-500 mb-4">Thanks for playing!</p>
          </div>
        </>
      );
    }

    return <div>Loading game...</div>;
  };

  // Show multiplayer game when game has started
  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="w-full max-w-4xl text-center py-6">
        <h1 className="text-4xl font-extrabold text-blue-700 dark:text-blue-400">Undercover</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Room: {roomState.roomCode}</p>
      </header>
      <main className="flex-grow w-full max-w-4xl p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
        {/* Your Secret Word - show during gameplay phases */}
        {(gameState.phase === 'description' || gameState.phase === 'discussion' || gameState.phase === 'voting') && (
          <div className="mb-6 p-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg text-white">
            <h2 className="text-xl font-bold mb-2">Your Secret Word</h2>
            <div className="text-center">
              <span className="text-4xl font-bold">"{gameState.myWord}"</span>
            </div>
          </div>
        )}
        {renderMultiplayerGame()}
      </main>
    </div>
  );
};

export default App;