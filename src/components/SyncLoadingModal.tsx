import React from 'react'
import MatrixLoader from './MatrixLoader'
import './MatrixLoader.css'

interface SyncLoadingModalProps {
  isVisible: boolean
  message?: string
  progress?: number
}

const SyncLoadingModal: React.FC<SyncLoadingModalProps> = ({
  isVisible,
  message = 'Syncing data...',
  progress = 0
}) => {
  if (!isVisible) return null

  const getProgressMessage = () => {
    if (progress === 0) return 'Initializing sync...'
    if (progress < 30) return 'Connecting to server...'
    if (progress < 60) return 'Fetching vehicle data...'
    if (progress < 90) return 'Fetching KIMPER data...'
    if (progress < 100) return 'Storing data locally...'
    return 'Sync complete!'
  }

  return (
    <div className="sync-loading-overlay">
      <div className="sync-loading-modal">
        {/* Header */}
        <div className="sync-modal-header">
          <h4 className="sync-modal-title">
            🚛 WERCI Data Sync
          </h4>
        </div>

        {/* Matrix Loader */}
        <MatrixLoader
          message={message}
          size="small"
          theme="matrix"
        />

        {/* Progress Information */}
        <div className="sync-progress-info">
          <div className="progress-message">
            {getProgressMessage()}
          </div>

          {progress > 0 && (
            <div className="progress-bar-container">
              <div className="progress-bar-wrapper">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <div className="progress-percentage">
                {Math.round(progress)}%
              </div>
            </div>
          )}
        </div>



        {/* Footer */}
        <div className="sync-modal-footer">
          <small className="text-muted">
            Please wait while we sync your data...
          </small>
        </div>
      </div>
    </div>
  )
}

export default SyncLoadingModal
