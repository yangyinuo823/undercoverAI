import React from 'react';
import { Player } from '../types';
import { PLAYER_4_NAME } from '../constants';

interface PlayerCardProps {
  player: Player;
  children?: React.ReactNode;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ player, children }) => {
  return (
    <div
      className={`p-5 rounded-lg shadow-md border-2
                  ${player.id === PLAYER_4_NAME
                      ? 'bg-blue-50 dark:bg-blue-900 border-blue-400 dark:border-blue-600'
                      : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'
                  }
                  flex flex-col`}
    >
      <h3 className="text-xl font-bold mb-2">
        {player.name} {player.id === PLAYER_4_NAME && <span className="text-sm font-normal">(AI)</span>}
      </h3>
      {children}
    </div>
  );
};

export default PlayerCard;