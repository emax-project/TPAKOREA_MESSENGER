import { useEffect, useRef, useState } from 'react';
import { isNotificationPopupEnabled } from '../../../utils/notificationPopup';

type ShowToast = (message: string, type?: 'info' | 'success' | 'error') => void;

export function useNotificationPrefs(showToast: ShowToast) {
  const [mutedRoomIds, setMutedRoomIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('mutedRoomIds');
      if (!raw) return new Set();
      const list = JSON.parse(raw);
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const [notificationsSnoozedUntil, setNotificationsSnoozedUntil] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('notificationsSnoozedUntil');
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  });
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('notificationSoundEnabled') !== '0';
    } catch {
      return true;
    }
  });
  const [notificationPopupEnabled, setNotificationPopupEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('notificationPopupEnabled') !== '0';
    } catch {
      return true;
    }
  });

  const mutedRoomIdsRef = useRef<Set<string>>(mutedRoomIds);
  const notificationsSnoozedUntilRef = useRef<number>(notificationsSnoozedUntil);
  mutedRoomIdsRef.current = mutedRoomIds;
  notificationsSnoozedUntilRef.current = notificationsSnoozedUntil;

  // Snooze timer
  useEffect(() => {
    if (!notificationsSnoozedUntil) return;
    const remaining = notificationsSnoozedUntil - Date.now();
    if (remaining <= 0) return;
    const t = setTimeout(() => {
      setNotificationsSnoozedUntil(0);
      try {
        localStorage.removeItem('notificationsSnoozedUntil');
      } catch {
        // ignore
      }
      showToast('알림 일시 중지가 해제되었습니다', 'info');
      try {
        const title = 'TPA-Korea';
        const body = '알림 일시 중지가 해제되었습니다';
        if (isNotificationPopupEnabled() && window.electronAPI?.showNotification) {
          window.electronAPI.showNotification(title, body);
        } else if (isNotificationPopupEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(title, { body });
        }
      } catch {
        // ignore
      }
    }, remaining);
    return () => clearTimeout(t);
  }, [notificationsSnoozedUntil, showToast]);

  const toggleMuteRoom = (roomId: string) => {
    setMutedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      try {
        localStorage.setItem('mutedRoomIds', JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const snoozeNotifications = (minutes: number) => {
    const until = Date.now() + minutes * 60 * 1000;
    setNotificationsSnoozedUntil(until);
    try {
      localStorage.setItem('notificationsSnoozedUntil', String(until));
    } catch {
      // ignore
    }
  };

  const clearSnooze = () => {
    setNotificationsSnoozedUntil(0);
    try {
      localStorage.removeItem('notificationsSnoozedUntil');
    } catch {
      // ignore
    }
  };

  const toggleNotificationSound = () => {
    setNotificationSoundEnabled((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.removeItem('notificationSoundEnabled');
        else localStorage.setItem('notificationSoundEnabled', '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleNotificationPopup = () => {
    setNotificationPopupEnabled((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.removeItem('notificationPopupEnabled');
        else localStorage.setItem('notificationPopupEnabled', '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  return {
    mutedRoomIds,
    notificationsSnoozedUntil,
    notificationSoundEnabled,
    notificationPopupEnabled,
    mutedRoomIdsRef,
    notificationsSnoozedUntilRef,
    toggleMuteRoom,
    snoozeNotifications,
    clearSnooze,
    toggleNotificationSound,
    toggleNotificationPopup,
  };
}
