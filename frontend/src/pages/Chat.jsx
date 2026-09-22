import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  ArrowLeft,
  Search,
  Package,
  Loader2,
  Check,
  CheckCheck,
  Image as ImageIcon,
  Phone,
} from 'lucide-react';
import CallModal from '../components/CallModal';
import toast from 'react-hot-toast';
import { chatService } from '../services/services';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { formatTime, formatDate, cn } from '../utils/format';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';
import { ScrollReveal } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    socket,
    on,
    off,
    emit,
    joinConversation,
    leaveConversation,
    emitTyping,
    emitStopTyping,
    onlineUsers,
    setUnread,
    clearUnread,
  } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [search, setSearch] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const callModalRef = useRef(null);

  // Load conversations
  useEffect(() => {
    chatService
      .conversations()
      .then((r) => {
        const convs = r.data.conversations;
        setConversations(convs);
        // Sync unread counts to socket context
        convs.forEach((c) => {
          const count = c.unreadCounts?.[user._id] || 0;
          setUnread(c._id, count);
        });
        if (id) {
          const conv = convs.find((c) => c._id === id);
          if (conv) setActiveConv(conv);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Load messages when active conversation changes
  useEffect(() => {
    const convId = activeConv?._id;
    if (!convId) return;
    // Guard: ensure valid ObjectId (24 hex chars)
    if (!/^[a-f\d]{24}$/i.test(String(convId))) return;
    let cancelled = false;
    joinConversation(convId);
    // Avoid cached GET (messages must be fresh) and allow refresh retry
    chatService
      .messages(convId)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.data.messages);
        // Mark as read via REST (persists) – navbar badge cleared via clearUnread
        // Separate from message load so emit failure does not show "Failed to load messages"
        try {
          chatService.markRead(convId).catch(() => {});
          clearUnread(convId);
          if (emit) emit('chat:read', { conversationId: convId });
        } catch (e) {
          if (import.meta.env.DEV) console.warn('[Chat] mark read emit failed:', e?.message);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err.response?.status;
        // 401 is handled by api.js refresh interceptor; only toast if refresh failed
        if (status === 401) return;
        if (import.meta.env.DEV) console.error('[Chat] load messages failed:', err.response?.data || err.message);
        // Dedupe duplicate toasts for same conv (StrictMode double-invoke)
        toast.error('Failed to load messages', { id: `load-msg-${convId}` });
      });

    return () => {
      cancelled = true;
      leaveConversation(convId);
    };
  }, [activeConv?._id]);

  // Handle new messages from socket
  useEffect(() => {
    const handleNew = (msg) => {
      if (activeConv && msg.conversation === activeConv._id) {
        setMessages((prev) => {
          if (prev.some((m) => m._id === msg._id)) return prev;
          return [...prev, msg];
        });
        // Auto-mark as read if viewing the conversation
        chatService.markRead(activeConv._id).catch(() => {});
        clearUnread(activeConv._id);
      } else {
        setConversations((prev) => {
          const existing = prev.find((c) => c._id === msg.conversation);
          if (existing) {
            return prev.map((c) =>
              c._id === msg.conversation
                ? { ...c, lastMessage: msg, lastMessageAt: msg.createdAt }
                : c
            ).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
          }
          return prev;
        });
      }
    };
    on('chat:message', handleNew);
    on('message:new', handleNew);
    return () => {
      off('chat:message');
      off('message:new');
    };
  }, [activeConv, on, off, clearUnread]);

  // Handle conversation list updates
  useEffect(() => {
    const handleConvUpdate = () => {
      chatService.conversations().then((r) => {
        const convs = r.data.conversations;
        setConversations(convs);
        // Keep global badge in sync after update
        convs.forEach((c) => setUnread(c._id, c.unreadCounts?.[user._id] || 0));
      }).catch(() => {});
    };
    on('conversation:update', handleConvUpdate);
    return () => off('conversation:update');
  }, [on, off, setUnread, user._id]);

  // Handle read receipts
  useEffect(() => {
    const handleRead = ({ conversationId, readerId }) => {
      if (activeConv && conversationId === activeConv._id && readerId !== user._id) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.sender._id === user._id && !msg.readBy?.some((r) => r.user === readerId)) {
              return {
                ...msg,
                readBy: [...(msg.readBy || []), { user: readerId, readAt: new Date() }],
                status: 'read',
              };
            }
            return msg;
          })
        );
      }
    };
    on('conversation:read', handleRead);
    return () => off('conversation:read');
  }, [activeConv, user._id, on, off]);

  // Socket error feedback (backend emits chat:error on socket send failure)
  useEffect(() => {
    const handleChatError = (payload) => {
      console.error('[Chat] socket error:', payload);
      toast.error(payload?.message || 'Message failed on server');
    };
    on('chat:error', handleChatError);
    return () => off('chat:error');
  }, [on, off]);

  // Typing indicators
  useEffect(() => {
    const handleTyping = ({ userId: typingUserId }) => {
      if (activeConv && typingUserId !== user._id) setTyping(true);
    };
    const handleStopTyping = ({ userId: typingUserId }) => {
      if (typingUserId !== user._id) setTyping(false);
    };
    on('typing:start', handleTyping);
    on('typing:stop', handleStopTyping);
    return () => {
      off('typing:start');
      off('typing:stop');
    };
  }, [activeConv, user._id, on, off]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeConv) return;
    if (sending) return;
    const text = input.trim();
    const convId = activeConv._id;
    setInput('');
    setSending(true);
    try {
      // Prefer REST for reliability — it persists, validates auth, and
      // benefits from the api.js refresh-token interceptor. Socket is
      // used for real-time broadcast to other participants.
      const { data } = await chatService.send({
        conversationId: convId,
        content: text,
      });
      const saved = data.message;
      // Immediately append own message (REST path does not broadcast to sender)
      setMessages((prev) => {
        if (prev.some((m) => m._id === saved._id)) return prev;
        return [...prev, saved];
      });
      // Update conversation preview
      setConversations((prev) =>
        prev
          .map((c) =>
            c._id === convId
              ? { ...c, lastMessage: saved, lastMessageAt: saved.createdAt }
              : c
          )
          .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
      );
      emitStopTyping({
        conversationId: convId,
        recipientId: activeConv.participants.find((p) => p._id !== user._id)?._id,
      });
    } catch (err) {
      // Restore input so user doesn't lose text
      setInput(text);
      const status = err.response?.status;
      const code = err.response?.data?.code;
      const serverMsg = err.response?.data?.message;
      console.error('[Chat] send failed:', { status, code, serverMsg, error: err.message });
      if (status === 401) {
        toast.error('Session expired. Please log in again.');
      } else if (status === 403) {
        toast.error('Not authorized to send in this conversation.');
      } else if (status === 404) {
        toast.error('Conversation not found.');
      } else if (status === 400) {
        toast.error(serverMsg || 'Invalid message. Check content and try again.');
      } else if (status === 429) {
        toast.error('Too many messages. Please slow down.');
      } else if (status >= 500) {
        toast.error('Server error. Please try again.');
      } else if (!err.response) {
        toast.error('Cannot reach server. Check backend on port 5000.');
      } else {
        toast.error(serverMsg || 'Failed to send message');
      }
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (activeConv) {
      emitTyping({
        conversationId: activeConv._id,
        recipientId: activeConv.participants.find((p) => p._id !== user._id)?._id,
      });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        emitStopTyping({
          conversationId: activeConv._id,
          recipientId: activeConv.participants.find((p) => p._id !== user._id)?._id,
        });
      }, 1500);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    const other = c.participants.find((p) => p._id !== user._id);
    return other?.name?.toLowerCase().includes(search.toLowerCase());
  });

  const getOtherParticipant = (conv) =>
    conv.participants.find((p) => p._id !== user._id) || {};

  const getUnreadCount = (conv) => conv.unreadCounts?.[user._id] || 0;

  const isOnline = (userId) => onlineUsers.has(userId);

  if (loading) return <Loader />;

  return (
    <PageTransition>
      <div className="relative min-h-screen">
        <div className="container-page py-4 relative z-10">
          <ScrollReveal direction="up">
            <div className="card overflow-hidden h-[calc(100vh-10rem)] flex">
              {/* Conversations list */}
              <div
                className={cn(
                  'w-full md:w-80 border-r border-slate-200 flex flex-col',
                  activeConv && 'hidden md:flex'
                )}
              >
                <div className="p-4 border-b border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-display font-bold text-lg">Messages</h2>
                    {activeConv && (
                      <motion.button
                        onClick={() => {
                          setActiveConv(null);
                          navigate('/chat');
                        }}
                        className="md:hidden p-2 rounded-lg hover:bg-slate-100"
                        whileTap={{ scale: 0.9 }}
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </motion.button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search conversations..."
                      className="input pl-9 text-sm"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {filteredConversations.length === 0 ? (
                    <p className="p-8 text-center text-sm text-slate-500">
                      No conversations yet
                    </p>
                  ) : (
                    filteredConversations.map((conv) => {
                      const other = getOtherParticipant(conv);
                      const unread = getUnreadCount(conv);
                      return (
                        <motion.button
                          key={conv._id}
                          onClick={() => {
                            setActiveConv(conv);
                            navigate(`/chat/${conv._id}`);
                          }}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={cn(
                            'w-full p-4 flex items-start gap-3 hover:bg-slate-50 transition border-b border-slate-100 text-left',
                            activeConv?._id === conv._id && 'bg-brand-50'
                          )}
                          whileTap={{ scale: 0.99 }}
                        >
                          <div className="relative flex-shrink-0">
                            {other.avatar?.url ? (
                              <img
                                src={other.avatar.url}
                                alt=""
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-semibold">
                                {other.name?.[0]?.toUpperCase()}
                              </div>
                            )}
                            {isOnline(other._id) && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className={cn('text-sm truncate', unread > 0 ? 'font-bold' : 'font-medium')}>
                                  {other.name}
                                </p>
                                {conv.product && (
                                  <span className="text-xs text-slate-400 hidden sm:inline">
                                    · {conv.product.title?.slice(0, 15)}{conv.product.title?.length > 15 ? '...' : ''}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                                {formatDate(conv.lastMessageAt)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn(
                                'text-xs truncate',
                                unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'
                              )}>
                                {conv.lastMessage?.content || 'No messages yet'}
                              </p>
                              {unread > 0 && (
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold grid place-items-center">
                                  {unread > 9 ? '9+' : unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Messages panel */}
              <div
                className={cn(
                  'flex-1 flex flex-col',
                  !activeConv && 'hidden md:flex'
                )}
              >
                {activeConv ? (
                  <>
                    {/* Header */}
                    <motion.div
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 border-b border-slate-200 flex items-center gap-3"
                    >
                      <motion.button
                        onClick={() => {
                          setActiveConv(null);
                          navigate('/chat');
                        }}
                        className="md:hidden p-2 rounded-lg hover:bg-slate-100"
                        whileTap={{ scale: 0.9 }}
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </motion.button>
                      {(() => {
                        const other = getOtherParticipant(activeConv);
                        const online = isOnline(other._id);
                        return (
                          <>
                            <div className="relative flex-shrink-0">
                              {other.avatar?.url ? (
                                <img
                                  src={other.avatar.url}
                                  alt=""
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-semibold">
                                  {other.name?.[0]?.toUpperCase()}
                                </div>
                              )}
                              {online && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm">{other.name}</p>
                              <div className="flex items-center gap-1.5">
                                {activeConv.product && (
                                  <motion.button
                                    onClick={() => navigate(`/product/${activeConv.product._id}`)}
                                    className="text-xs text-brand-600 hover:underline truncate"
                                    whileHover={{ x: 4 }}
                                  >
                                    About: {activeConv.product.title}
                                  </motion.button>
                                )}
                              </div>
                            </div>
                            <span className={cn(
                              'text-xs px-2 py-1 rounded-full',
                              online ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                            )}>
                              {online ? 'Online' : 'Offline'}
                            </span>
                            <motion.button
                              onClick={() => {
                                const target = activeConv.participants.find((p) => p._id !== user._id);
                                if (target && callModalRef.current) {
                                  callModalRef.current.startCall(target._id, target.name);
                                }
                              }}
                              className="p-2 rounded-full bg-brand-50 text-brand-600 hover:bg-brand-100 transition ml-1"
                              whileTap={{ scale: 0.9 }}
                              title="Voice call"
                            >
                              <Phone className="w-4 h-4" />
                            </motion.button>
                          </>
                        );
                      })()}
                    </motion.div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {messages.length === 0 ? (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-center py-12 text-slate-500 text-sm"
                        >
                          Start the conversation...
                        </motion.div>
                      ) : (
                        messages.map((msg) => {
                          const isMe = msg.sender._id === user._id;
                          const readByOthers = msg.readBy?.some(
                            (r) => r.user !== user._id
                          );
                          return (
                            <motion.div
                              key={msg._id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn('flex', isMe ? 'justify-end' : 'justify-start')}
                            >
                              <div
                                className={cn(
                                  'max-w-[70%] rounded-2xl px-4 py-2.5',
                                  isMe
                                    ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white'
                                    : 'bg-slate-100 text-slate-900'
                                )}
                              >
                                {msg.type === 'image' && msg.attachments?.length > 0 && (
                                  <div className="mb-2 flex flex-wrap gap-1">
                                    {msg.attachments.map((att, i) => (
                                      <img
                                        key={i}
                                        src={att.url}
                                        alt=""
                                        className="rounded-lg max-w-[200px] max-h-[200px] object-cover"
                                      />
                                    ))}
                                  </div>
                                )}
                                {msg.content && (
                                  <p className="text-sm leading-relaxed">{msg.content}</p>
                                )}
                                <div className={cn(
                                  'flex items-center justify-end gap-1.5 mt-1',
                                  isMe ? 'text-white/70' : 'text-slate-400'
                                )}>
                                  <span className="text-[10px]">{formatTime(msg.createdAt)}</span>
                                  {isMe && (
                                    <>
                                      {readByOthers || msg.status === 'read' ? (
                                        <CheckCheck className="w-3.5 h-3.5 text-blue-300" />
                                      ) : msg.status === 'delivered' ? (
                                        <CheckCheck className="w-3.5 h-3.5" />
                                      ) : (
                                        <Check className="w-3.5 h-3.5" />
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          );
                        })
                      )}
                      <AnimatePresence>
                        {typing && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex"
                          >
                            <div className="bg-slate-100 rounded-2xl px-4 py-3 inline-flex gap-1">
                              <span
                                className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                                style={{ animationDelay: '0ms' }}
                              />
                              <span
                                className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                                style={{ animationDelay: '150ms' }}
                              />
                              <span
                                className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                                style={{ animationDelay: '300ms' }}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <motion.form
                      onSubmit={handleSend}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 border-t border-slate-200 flex gap-2"
                    >
                      <input
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                        className="input flex-1"
                        autoFocus
                      />
                      <MagneticButton
                        type="submit"
                        disabled={!input.trim() || sending}
                        className="btn-primary px-4"
                        strength={0.15}
                      >
                        {sending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </MagneticButton>
                    </motion.form>
                  </>
                ) : (
                  <div className="flex-1 grid place-items-center text-slate-500">
                    <motion.p
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      Select a conversation to start chatting
                    </motion.p>
                  </div>
                )}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
      <CallModal ref={callModalRef} />
    </PageTransition>
  );
}
