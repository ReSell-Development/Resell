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
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const updateTotalUnread = useCallback(() => {
    let total = 0;
    for (const count of unreadMapRef.current.values()) {
      total += count;
    }
    setTotalUnread(total);
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    if (!userRef.current) return;
    try {
      const res = await api.get('/chat/unread-count', { _noCache: true });
      const count = res.data?.count ?? 0;
      const breakdown = res.data?.breakdown || {};
      // Rebuild map from breakdown for accurate per-conversation tracking
      unreadMapRef.current.clear();
      for (const [convId, n] of Object.entries(breakdown)) {
        unreadMapRef.current.set(convId, n);
      }
      setTotalUnread(count);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[Socket] fetch unread-count failed:', err?.message);
    }
  }, []);

  const refreshUnread = useCallback(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

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
      api.get('/notifications/unread', { _noCache: true }).then((res) => {
        if (res.data?.count != null) setUnreadNotifications(res.data.count);
      }).catch(() => {});
      fetchUnreadCount();
    });
    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setConnected(false);
    });
    socket.on('connect_error', (err) => {
      console.error('[Socket] Error:', err.message);
      setConnected(false);
    });

    socket.on('user:online-list', (data) => {
      const list = data?.onlineUsers || [];
      setOnlineUsers(new Set(list));
    });

    socket.on('user:status', ({ userId: uid, online }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (online) next.add(uid);
        else next.delete(uid);
        return next;
      });
    });

    // Handle initial online users list on connect
    socket.on('user:online-list', ({ onlineUsers: onlineUserIds }) => {
      if (Array.isArray(onlineUserIds)) {
        setOnlineUsers(new Set(onlineUserIds));
      }
    });

    // Central unread increment for any incoming message (single source of truth for badge)
    const handleIncomingMessage = (msg) => {
      try {
        const currentUserId = userRef.current?._id;
        if (!currentUserId) return;
        const senderId = msg.sender?._id || msg.sender;
        if (senderId && String(senderId) === String(currentUserId)) return; // own message
        const convId = msg.conversation;
        if (!convId) return;
        // If user is currently viewing this conversation, treat as read (Chat.jsx will also mark read)
        if (joinedConversationsRef.current.has(String(convId))) return;
        const cur = unreadMapRef.current.get(String(convId)) || 0;
        unreadMapRef.current.set(String(convId), cur + 1);
        updateTotalUnread();
      } catch {}
    };

    socket.on('chat:message', handleIncomingMessage);
    socket.on('message:new', handleIncomingMessage);

    // Keep listeners map in sync for Chat.jsx handlers (re-attach on new socket)
    for (const [event, handler] of listenersRef.current.entries()) {
      if (event !== 'chat:message' && event !== 'message:new') {
        socket.on(event, handler);
      }
    }

    return () => {
      socket.off('chat:message', handleIncomingMessage);
      socket.off('message:new', handleIncomingMessage);
      socket.disconnect();
    };
  }, [user, fetchUnreadCount, updateTotalUnread]);

  // Also fetch on initial auth and on visibility regain
  useEffect(() => {
    if (user) fetchUnreadCount();
  }, [user, fetchUnreadCount]);

  const on = useCallback((event, handler) => {
    listenersRef.current.set(event, handler);
    if (socketRef.current) socketRef.current.on(event, handler);
  }, []);

  const off = useCallback((event, handler) => {
    // Remove specific handler if provided, else remove all for event
    if (handler && socketRef.current) {
      socketRef.current.off(event, handler);
    } else {
      listenersRef.current.delete(event);
      if (socketRef.current) socketRef.current.off(event);
    }
    if (!handler) listenersRef.current.delete(event);
  }, []);

  const emit = useCallback((event, payload) => {
    if (socketRef.current) socketRef.current.emit(event, payload);
  }, []);

  const joinConversation = useCallback((id) => {
    joinedConversationsRef.current.add(String(id));
    emit('conversation:join', id);
  }, [emit]);

  const leaveConversation = useCallback((id) => {
    joinedConversationsRef.current.delete(String(id));
    emit('conversation:leave', id);
  }, [emit]);

  const emitTyping = useCallback((data) => emit('typing:start', data), [emit]);
  const emitStopTyping = useCallback((data) => emit('typing:stop', data), [emit]);

  const setUnread = useCallback((conversationId, count) => {
    unreadMapRef.current.set(String(conversationId), count);
    updateTotalUnread();
  }, [updateTotalUnread]);

  const incrementUnread = useCallback((conversationId) => {
    const current = unreadMapRef.current.get(String(conversationId)) || 0;
    unreadMapRef.current.set(String(conversationId), current + 1);
    updateTotalUnread();
  }, [updateTotalUnread]);

  const clearUnread = useCallback((conversationId) => {
    unreadMapRef.current.set(String(conversationId), 0);
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
        refreshUnread,
        fetchUnreadCount,
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
