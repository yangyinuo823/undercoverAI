import React, { useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import Button from './Button';
import InputField from './InputField';

const Lobby: React.FC = () => {
  const { roomState, playerName, setPlayerName, createRoom, joinRoom, startGame } = useSocket();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [mode, setMode] = useState<'choice' | 'join'>('choice');

  const handleCreateRoom = () => {
    if (playerName.trim()) {
      createRoom();
    }
  };

  const handleJoinRoom = () => {
    if (playerName.trim() && roomCodeInput.trim()) {
      joinRoom(roomCodeInput);
    }
  };

  // If in a room, show waiting screen
  if (roomState.roomCode) {
    return (
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Room: {roomState.roomCode}</h2>
        <p className="text-lg mb-2">Share this code with your friends!</p>
        
        <div className="bg-blue-100 dark:bg-blue-900 p-4 rounded-lg mb-6 inline-block">
          <span className="text-3xl font-mono font-bold tracking-widest text-blue-700 dark:text-blue-300">
            {roomState.roomCode}
          </span>
        </div>

        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-3">Players ({roomState.players.length}/3)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Names are hidden until the game starts.</p>
          <div className="flex flex-col gap-2 items-center">
            {roomState.players.map((player, index) => (
              <div 
                key={player.id} 
                className="bg-white dark:bg-gray-700 px-4 py-2 rounded-lg shadow border border-gray-200 dark:border-gray-600 w-64"
              >
                <span className="font-medium">Player {index + 1}</span>
                <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">joined</span>
              </div>
            ))}
            {Array.from({ length: roomState.playersNeeded }).map((_, index) => (
              <div 
                key={`empty-${index}`} 
                className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 w-64 text-gray-400"
              >
                Waiting for player...
              </div>
            ))}
          </div>
        </div>

        {roomState.playersNeeded > 0 ? (
          <div className="text-orange-600 dark:text-orange-400 text-lg font-medium animate-pulse">
            Waiting for {roomState.playersNeeded} more player{roomState.playersNeeded > 1 ? 's' : ''}...
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="text-green-600 dark:text-green-400 text-lg font-medium">
              All players joined! Ready to start!
            </div>
            <Button onClick={startGame}>
              Start Game
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Not in a room - show join/create options
  return (
    <div className="text-center max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-6">Join or Create a Game</h2>
      
      {/* Connection status */}
      <div className={`mb-4 text-sm ${roomState.isConnected ? 'text-green-600' : 'text-red-600'}`}>
        {roomState.isConnected ? '● Connected to server' : '○ Connecting to server...'}
      </div>

      {/* Error message */}
      {roomState.error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-lg">
          {roomState.error}
        </div>
      )}

      {/* Name input */}
      <div className="mb-6">
        <InputField
          label="Your Name"
          placeholder="Enter your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className="text-center"
          disabled={!roomState.isConnected}
        />
      </div>

      {mode === 'choice' ? (
        <div className="flex flex-col gap-4">
          <Button 
            onClick={handleCreateRoom} 
            disabled={!roomState.isConnected || !playerName.trim()}
          >
            Create New Game
          </Button>
          <Button 
            onClick={() => setMode('join')} 
            disabled={!roomState.isConnected || !playerName.trim()}
          >
            Join Existing Game
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <InputField
            label="Room Code"
            placeholder="Enter 6-letter code"
            value={roomCodeInput}
            onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            className="text-center font-mono text-xl tracking-widest"
            maxLength={6}
            disabled={!roomState.isConnected}
          />
          <Button 
            onClick={handleJoinRoom} 
            disabled={!roomState.isConnected || !playerName.trim() || !roomCodeInput.trim()}
          >
            Join Game
          </Button>
          <button 
            onClick={() => setMode('choice')}
            className="text-blue-600 dark:text-blue-400 underline"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
};

export default Lobby;
