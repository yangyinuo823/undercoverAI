import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ children, className, disabled, ...props }) => {
  return (
    <button
      className={`px-6 py-3 rounded-lg font-semibold text-lg
                  bg-blue-600 hover:bg-blue-700 text-white
                  dark:bg-blue-700 dark:hover:bg-blue-800
                  transition-colors duration-200 ease-in-out
                  ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-400 dark:bg-gray-600' : ''}
                  ${className || ''}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;