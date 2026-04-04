import { useEffect } from 'react';
import { registerDisconnectCleanup } from '../services/RoomManager.js';

export function useCleanupHook({
  enabled,
  roomId,
  participantId,
  onPageHide,
}) {
  useEffect(() => {
    if (!enabled || !roomId || !participantId) {
      return undefined;
    }

    let cancelDisconnectCleanup = null;

    void registerDisconnectCleanup({ participantId, roomId }).then(
      (cancelRegistration) => {
        cancelDisconnectCleanup = cancelRegistration;
      },
    );

    const handlePageHide = () => {
      onPageHide?.();
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);

      if (cancelDisconnectCleanup) {
        void cancelDisconnectCleanup();
      }
    };
  }, [enabled, onPageHide, participantId, roomId]);
}
