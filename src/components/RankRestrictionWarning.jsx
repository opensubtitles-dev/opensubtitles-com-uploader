import React, { useState } from 'react';
import { Ban, AlertTriangle, X } from 'lucide-react';
import { useUserSession } from '../hooks/useUserSession.js';
import { UserService } from '../services/userService.js';

/**
 * Component to display rank restriction warnings when user doesn't have sufficient permissions
 */
const RankRestrictionWarning = () => {
  const { userInfo, isLoading } = useUserSession();
  const [isVisible, setIsVisible] = useState(true);

  if (isLoading) return null;

  const uploadPermission = userInfo ? UserService.canUserUpload(userInfo) : null;

  if (!userInfo || !uploadPermission || uploadPermission.canUpload || !isVisible) {
    return null;
  }

  const rankValidation = uploadPermission.rankValidation;
  const isForbiddenRank = rankValidation?.forbiddenRank;
  const currentRank = UserService.getUserRank(userInfo);
  const userRanks = UserService.getUserRanks(userInfo);

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-50 bg-error text-error-content px-4 py-3 shadow-lg"
    >
      <div className="max-w-4xl mx-auto flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          {isForbiddenRank ? <Ban className="size-6" /> : <AlertTriangle className="size-6" />}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">
            {isForbiddenRank ? 'Account Restricted' : 'Insufficient Permissions'}
          </h3>
          <p className="font-medium opacity-90 mb-2">{uploadPermission.reason}</p>

          <div className="text-sm opacity-80 space-y-1">
            <div>
              <span className="font-medium">Current Rank:</span> {currentRank}
            </div>

            {userRanks.length > 0 && (
              <div>
                <span className="font-medium">All Ranks:</span> {userRanks.join(', ')}
              </div>
            )}

            {!isForbiddenRank && (
              <div>
                <span className="font-medium">Required Ranks:</span>
                <div className="mt-1 text-xs">
                  super admin, translator, trusted member, administrator, moderator, gold member,
                  platinum member, trusted, subtranslator, os legend
                </div>
              </div>
            )}

            <div className="mt-3 p-2 bg-error-content/10 rounded-md text-xs">
              <p className="font-medium mb-1">What you can do:</p>
              <ul className="list-disc list-inside space-y-1">
                {isForbiddenRank ? (
                  <>
                    <li>
                      <a
                        href="https://www.opensubtitles.com/support"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        Contact OpenSubtitles support
                      </a>{' '}
                      to resolve account restrictions
                    </li>
                    <li>Check your account status on the OpenSubtitles website</li>
                  </>
                ) : (
                  <>
                    <li>
                      <a
                        href="https://www.opensubtitles.com/support"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        Contact OpenSubtitles support
                      </a>{' '}
                      to request rank upgrade
                    </li>
                    <li>Contribute to the community to earn higher ranks</li>
                    <li>Check rank requirements on the OpenSubtitles website</li>
                  </>
                )}
                <li>You can still download subtitles even with restricted upload access</li>
              </ul>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsVisible(false)}
          className="btn btn-sm btn-ghost btn-square text-error-content hover:bg-error-content/10"
          aria-label="Close warning"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
};

export default RankRestrictionWarning;
