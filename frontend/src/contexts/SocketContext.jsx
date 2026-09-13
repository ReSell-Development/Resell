import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import api from '../services/api';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());
  const joinedConversationsRef = useRef(new Set());
  const unreadMapRef = useRef(new Map());

  const updateTotalUnread = useCallback(() => {
    let total = 0;
    for (const count of unreadMapRef.current.values()) {
      total += count;
    }
    setTotalUnread(total);
  }, []);

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
        setTotalUnread(0);
        setOnlineUsers(new Set());
        joinedConversationsRef.current.clear();
        unreadMapRef.current.clear();
      }
      return;
    }

    const socket = io(SOCKET_URL, {
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      setConnected(true);
      for (const convId of joinedConversationsRef.current) {
        socket.emit('conversation:join', convId);
      }
      api.get('/notifications/unread').then((res) => {
        if (res.data?.count != null) setUnreadNotifications(res.data.count);
      }).catch(() => {});
    });
    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setConnected(false);
    });
    socket.on('connect_error', (err) => {
      console.error('[Socket] Error:', err.message);
      setConnected(false);
    });

    socket.on('user:status', ({ userId: uid, online }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (online) next.add(uid);
        else next.delete(uid);
        return next;
      });
    });

    // Re-attach existing listeners
    for (const [event, handler] of listenersRef.current.entries()) {
      socket.on(event, handler);
    }

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const on = useCallback((event, handler) => {
    listenersRef.current.set(event, handler);
    if (socketRef.current) socketRef.current.on(event, handler);
  }, []);

  const off = useCallback((event) => {
    listenersRef.current.delete(event);
    if (socketRef.current) socketRef.current.off(event);
  }, []);

  const emit = useCallback((event, payload) => {
    if (socketRef.current) socketRef.current.emit(event, payload);
  }, []);

  const joinConversation = useCallback((id) => {
    joinedConversationsRef.current.add(id);
    emit('conversation:join', id);
  }, [emit]);

  const leaveConversation = useCallback((id) => {
    joinedConversationsRef.current.delete(id);
    emit('conversation:leave', id);
  }, [emit]);

  const emitTyping = useCallback((data) => emit('typing:start', data), [emit]);
  const emitStopTyping = useCallback((data) => emit('typing:stop', data), [emit]);

  const setUnread = useCallback((conversationId, count) => {
    unreadMapRef.current.set(conversationId, count);
    updateTotalUnread();
  }, [updateTotalUnread]);

  const incrementUnread = useCallback((conversationId) => {
    const current = unreadMapRef.current.get(conversationId) || 0;
    unreadMapRef.current.set(conversationId, current + 1);
    updateTotalUnread();
  }, [updateTotalUnread]);

  const clearUnread = useCallback((conversationId) => {
    unreadMapRef.current.set(conversationId, 0);
    updateTotalUnread();
  }, [updateTotalUnread]);

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        connected,
        totalUnread,
        unreadNotifications,
        setUnreadNotifications,
        onlineUsers,
        on,
        off,
        emit,
        joinConversation,
        leaveConversation,
        emitTyping,
        emitStopTyping,
        setUnread,
        incrementUnread,
        clearUnread,
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
