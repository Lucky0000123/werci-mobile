import React, { useEffect, useState } from 'react'
import './MatrixLoader.css'

interface MatrixLoaderProps {
  message?: string
  size?: 'small' | 'medium' | 'large'
  theme?: 'matrix' | 'blue' | 'orange'
}

const MatrixLoader: React.FC<MatrixLoaderProps> = ({ 
  message = 'Syncing...', 
  size = 'medium',
  theme = 'matrix'
}) => {
  const [digits, setDigits] = useState<string[]>([])

  // Generate random binary/hex digits for the matrix effect
  useEffect(() => {
    const generateDigits = () => {
      const chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F']
      return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)])
    }

    setDigits(generateDigits())

    const interval = setInterval(() => {
      setDigits(generateDigits())
    }, 500)

    return () => clearInterval(interval)
  }, [])

  const getLoaderClass = () => {
    let baseClass = 'ai-matrix-loader'
    if (size === 'small') baseClass += ' loader-small'
    if (size === 'large') baseClass += ' loader-large'
    if (theme === 'blue') baseClass += ' theme-blue'
    if (theme === 'orange') baseClass += ' theme-orange'
    return baseClass
  }

  return (
    <div className="matrix-loader-container">
      <div className={getLoaderClass()}>
        {digits.map((digit, index) => (
          <div key={index} className="digit">
            {digit}
          </div>
        ))}
        <div className="glow"></div>
      </div>
      {message && (
        <div className="loader-message">
          {message}
        </div>
      )}
    </div>
  )
}

export default MatrixLoader
