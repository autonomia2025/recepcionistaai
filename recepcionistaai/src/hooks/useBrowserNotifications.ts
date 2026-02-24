import { useEffect, useCallback } from 'react';

export function useBrowserNotifications() {
  // Request permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const showNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return;
    }

    if (Notification.permission === 'granted') {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options,
      });

      // Auto close after 10 seconds
      setTimeout(() => notification.close(), 10000);

      // Focus window when clicked
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return notification;
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          showNotification(title, options);
        }
      });
    }
  }, []);

  const notifyHumanRequest = useCallback((contactName: string, message?: string) => {
    showNotification(`🙋 ${contactName} quiere hablar con un humano`, {
      body: message || 'El cliente ha solicitado atención personalizada',
      tag: 'human-request',
      requireInteraction: true,
    });

    // Also play a sound if possible
    try {
      const audio = new Audio('/notification.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {
      // Ignore audio errors
    }
  }, [showNotification]);

  const requestPermission = useCallback(async () => {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      return result === 'granted';
    }
    return false;
  }, []);

  const permissionStatus = 'Notification' in window ? Notification.permission : 'denied';

  return {
    showNotification,
    notifyHumanRequest,
    requestPermission,
    permissionStatus,
    isSupported: 'Notification' in window,
  };
}
