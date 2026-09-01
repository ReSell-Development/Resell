import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());
  const joinedConversationsRef = useRef(new Set());

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
        joinedConversationsRef.current.clear();
      }
      return;
    }

    const token = localStorage.getItem('token');
    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      setConnected(true);
      // Re-join conversations on reconnect
      for (const convId of joinedConversationsRef.current) {
        socket.emit('conversation:join', convId);
      }
    });
    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setConnected(false);
    });
    socket.on('connect_error', (err) => {
      console.error('[Socket] Error:', err.message);
      setConnected(false);
    });

    // Re-attach existing listeners
    for (const [event, handler] of listenersRef.current.entries()) {
      socket.on(event, handler);
    }

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const on = (event, handler) => {
    listenersRef.current.set(event, handler);
    if (socketRef.current) socketRef.current.on(event, handler);
  };

  const off = (event) => {
    listenersRef.current.delete(event);
    if (socketRef.current) socketRef.current.off(event);
  };

  const emit = (event, payload) => {
    if (socketRef.current) socketRef.current.emit(event, payload);
  };

  const joinConversation = (id) => {
    joinedConversationsRef.current.add(id);
    emit('conversation:join', id);
  };
  const leaveConversation = (id) => {
    joinedConversationsRef.current.delete(id);
    emit('conversation:leave', id);
  };
  const emitTyping = (data) => emit('typing:start', data);
  const emitStopTyping = (data) => emit('typing:stop', data);

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        connected,
        on,
        off,
        emit,
        joinConversation,
        leaveConversation,
        emitTyping,
        emitStopTyping,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
};
