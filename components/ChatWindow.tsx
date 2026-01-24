import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { PLAYER_4_NAME } from '../constants';

interface ChatWindowProps {
  messages: ChatMessage[];
  isPlayer4Thinking: boolean;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ messages, isPlayer4Thinking }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPlayer4Thinking]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 rounded-lg shadow-inner p-4">
      <h3 className="text-xl font-bold mb-4 text-center text-gray-800 dark:text-gray-200">Game Log</h3>
      <div className="flex-grow overflow-y-auto space-y-3 pb-4">
        {messages.map((msg, index) => (
          <div key={index} className="flex items-start">
            <div
              className={`p-3 rounded-lg max-w-[80%] break-words
                          ${msg.player === 'System'
                              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 italic'
                              : msg.player === PLAYER_4_NAME
                                  ? 'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 self-end ml-auto'
                                  : 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200'
                          }`}
            >
              <span className="font-semibold text-sm mr-1">{msg.player}:</span>
              <span className="text-base">{msg.content}</span>
            </div>
          </div>
        ))}
        {isPlayer4Thinking && (
          <div className="flex justify-end">
            <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 max-w-[80%]">
              <span className="font-semibold text-sm">{PLAYER_4_NAME}:</span>
              <span className="text-base"> is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ChatWindow;