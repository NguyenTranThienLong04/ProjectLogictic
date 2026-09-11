import { io, type Socket } from 'socket.io-client';
import { refreshAuthSession } from './api';
import { getAccessToken, updateAuthSession } from './auth-session';
import { SOCKET_BASE_URL } from './runtime-config';

export function operationsSocketUrl(): string {
  return `${SOCKET_BASE_URL}/operations`;
}

export function createOperationsSocket(): Socket {
  let connectionToken: string | null = null;
  const socket = io(operationsSocketUrl(), {
    autoConnect: false,
    auth: (callback: (credentials: { token: string | null }) => void) => {
      connectionToken = getAccessToken();
      callback({ token: connectionToken });
    },
    transports: ['websocket'],
  });
  let refreshing = false;

  const refreshAndReconnect = () => {
    if (refreshing || !getAccessToken()) return;
    if (connectionToken !== getAccessToken()) {
      socket.connect();
      return;
    }
    refreshing = true;
    void refreshAuthSession()
      .then(() => socket.connect())
      .catch(() => updateAuthSession(null))
      .finally(() => {
        refreshing = false;
      });
  };
  socket.on('connect_error', (error) => {
    if (error.message === 'Unauthorized socket') refreshAndReconnect();
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') refreshAndReconnect();
  });
  socket.connect();
  return socket;
}
