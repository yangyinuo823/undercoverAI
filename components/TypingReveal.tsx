import React, { useState, useEffect, useRef } from 'react';

interface TypingRevealProps {
  fullText: string;
  msPerChar: number;
  className?: string;
  /** Optional cursor to show while typing (e.g. "|") */
  cursor?: string;
}

/**
 * Reveals text character-by-character at a human-like typing speed.
 * Used for AI description and discussion messages.
 */
const TypingReveal: React.FC<TypingRevealProps> = ({ fullText, msPerChar, className, cursor = '|' }) => {
  const [visibleLength, setVisibleLength] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (fullText.length === 0) {
      setVisibleLength(0);
      return;
    }
    setVisibleLength(0);
    const ms = Math.max(20, msPerChar);
    intervalRef.current = setInterval(() => {
      setVisibleLength((prev) => {
        if (prev >= fullText.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          return fullText.length;
        }
        return prev + 1;
      });
    }, ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fullText, msPerChar]);

  const visible = fullText.slice(0, visibleLength);
  const isComplete = visibleLength >= fullText.length;

  return (
    <span className={className}>
      {visible}
      {!isComplete && cursor && <span className="animate-pulse opacity-80">{cursor}</span>}
    </span>
  );
};

export default TypingReveal;
