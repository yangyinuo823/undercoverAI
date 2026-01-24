import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Player, Role, GamePhase, ChatMessage } from './types';
import { CIVILIAN_WORD, UNDERCOVER_WORD, PLAYER_NAMES, PLAYER_4_NAME } from './constants';
import { generatePlayer4Description, generatePlayer4Vote } from './services/geminiService';
import PlayerCard from './components/PlayerCard';
import Button from './components/Button';
import InputField from './components/InputField';
import ChatWindow from './components/ChatWindow';

const App: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.SETUP);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [player4Role, setPlayer4Role] = useState<Role | undefined>(undefined);
  const [player4Word, setPlayer4Word] = useState<string | undefined>(undefined);
  const [isPlayer4Thinking, setIsPlayer4Thinking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  const startGame = useCallback(() => {
    const roles: Role[] = [Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.UNDERCOVER];
    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    const initialPlayers: Player[] = PLAYER_NAMES.map((name, index) => {
      const role = roles[index];
      const word = role === Role.CIVILIAN ? CIVILIAN_WORD : UNDERCOVER_WORD;
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
      content: `Game started! ${CIVILIAN_WORD} (Civilians) vs ${UNDERCOVER_WORD} (Undercover). Player_4 is ${initialPlayers.find(p => p.id === PLAYER_4_NAME)?.role}.`,
    });
    addChatMessage({ player: 'System', type: 'system', content: 'Description Phase: Enter a 1-sentence description of your word.' });
  }, [addChatMessage]);

  const handleDescriptionChange = useCallback((playerId: string, description: string) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(p => (p.id === playerId ? { ...p, description } : p))
    );
  }, []);

  const handleVoteChange = useCallback((playerId: string, voteTarget: string) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(p => (p.id === playerId ? { ...p, voteTarget } : p))
    );
  }, []);

  const allHumanDescriptionsEntered = useMemo(() => {
    return humanPlayers.every(p => p.description && p.description.trim() !== '');
  }, [humanPlayers]);

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

      generatePlayer4Description(player4Role, player4Word, otherDescriptions)
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

      generatePlayer4Vote(player4Role, player4Word, allDescriptions)
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
      // Assign roles to human players for results display
      const finalPlayers = players.map(p => {
        if (p.isHuman) {
          const isUndercover = Math.random() < 0.25; // Randomly assign for demonstration if not fixed
          return { ...p, role: isUndercover ? Role.UNDERCOVER : Role.CIVILIAN, word: isUndercover ? UNDERCOVER_WORD : CIVILIAN_WORD };
        }
        return p;
      });
      setPlayers(finalPlayers); // Update with assigned roles/words for humans
      setGamePhase(GamePhase.RESULTS);
      addChatMessage({ player: 'System', type: 'system', content: 'Results Phase!' });
    }
    setError(null);
  }, [gamePhase, players, addChatMessage]);

  const renderGameContent = () => {
    switch (gamePhase) {
      case GamePhase.SETUP:
        return (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Undercover: Coffee vs Tea</h2>
            <p className="mb-6">3 Civilians have "Coffee", 1 Undercover has "Tea". Find the Undercover!</p>
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
                      <InputField
                        placeholder={`Describe your word (e.g., "idk maybe like... something you drink")`}
                        value={player.description || ''}
                        onChange={(e) => handleDescriptionChange(player.id, e.target.value)}
                        disabled={isPlayer4Thinking}
                        className="mt-2 w-full"
                      />
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
        const undercoverFound = players.some(p => p.role === Role.UNDERCOVER && p.id === player4?.voteTarget);
        const player4VotedForUndercover = player4?.role === Role.CIVILIAN && players.find(p => p.role === Role.UNDERCOVER && p.id === player4.voteTarget);
        const player4SurvivedAsUndercover = player4?.role === Role.UNDERCOVER && !players.some(p => p.voteTarget === PLAYER_4_NAME);

        let gameOutcomeMessage = '';
        if (undercoverFound) {
          gameOutcomeMessage = 'Civilians win! The Undercover was found.';
        } else if (player4SurvivedAsUndercover) {
          gameOutcomeMessage = 'Undercover wins! Player_4 successfully blended in.';
        } else {
          gameOutcomeMessage = 'Undercover wins! The Civilians failed to find the imposter.';
        }

        return (
          <>
            <h2 className="text-3xl font-bold mb-6 text-center text-emerald-700 dark:text-emerald-400">Game Over!</h2>
            <p className="text-xl text-center mb-8">{gameOutcomeMessage}</p>

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
                  {player.id === PLAYER_4_NAME && player4?.role && (
                    <p className="text-xs italic mt-2 text-gray-500 dark:text-gray-400">
                      (You were the {player4.role} with word "{player4.word}")
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

  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="w-full max-w-4xl text-center py-6">
        <h1 className="text-4xl font-extrabold text-blue-700 dark:text-blue-400">
          Undercover
        </h1>
      </header>
      <main className="flex-grow w-full max-w-6xl p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col md:flex-row gap-6">
        <div className="md:w-2/3 flex flex-col justify-between">
          {renderGameContent()}
        </div>
        <div className="md:w-1/3 min-h-[300px] md:min-h-full">
          <ChatWindow messages={chatMessages} isPlayer4Thinking={isPlayer4Thinking} />
        </div>
      </main>
    </div>
  );
};

export default App;