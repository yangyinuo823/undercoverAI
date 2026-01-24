import React from 'react';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const InputField: React.FC<InputFieldProps> = ({ label, className, ...props }) => {
  return (
    <div className="flex flex-col w-full">
      {label && (
        <label htmlFor={props.id} className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <input
        className={`p-3 border border-gray-300 rounded-md shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                    bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600
                    ${className || ''}`}
        {...props}
      />
    </div>
  );
};

export default InputField;