import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  ArrowLeft,
  Search,
  Package,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { chatService } from '../services/services';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { formatPrice, formatTime, formatDate, cn } from '../utils/format';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';
import { ScrollReveal } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, on, off, joinConversation, leaveConversation, emitTyping, emitStopTyping } = useSocket();

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

  useEffect(() => {
    chatService.conversations().then((r) => {
      setConversations(r.data.conversations);
      if (id) {
        const conv = r.data.conversations.find((c) => c._id === id);
        if (conv) setActiveConv(conv);
      }
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!activeConv) return;
    joinConversation(activeConv._id);
    chatService
      .messages(activeConv._id)
      .then((r) => setMessages(r.data.messages))
      .catch(() => toast.error('Failed to load messages'));

    return () => leaveConversation(activeConv._id);
  }, [activeConv?._id]);

  useEffect(() => {
    const handleNew = (msg) => {
      if (activeConv && msg.conversation === activeConv._id) {
        setMessages((prev) => [...prev, msg]);
      }
      setConversations((prev) =>
        prev.map((c) =>
          c._id === msg.conversation
            ? { ...c, lastMessage: msg, lastMessageAt: msg.createdAt }
            : c
        ).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
      );
    };
    on('message:new', handleNew);
    return () => off('message:new');
  }, [activeConv, on, off]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeConv) return;
    setSending(true);
    try {
      const { data } = await chatService.send({
        conversationId: activeConv._id,
        content: input.trim(),
      });
      setMessages((prev) => [...prev, data.message]);
      setInput('');
      emitStopTyping({
        conversationId: activeConv._id,
        recipientId: activeConv.participants.find((p) => p._id !== user._id)?._id,
      });
    } catch {
      toast.error('Failed to send message');
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

  if (loading) return <Loader />;

  return (
    <PageTransition>
      <div className="relative min-h-screen">

        <div className="container-page py-4 relative z-10">
          <ScrollReveal direction="up">
            <div className="card overflow-hidden h-[calc(100vh-10rem)] flex">
              {/* Conversations list */}
              <div className={cn(
                'w-full md:w-80 border-r border-slate-200 flex flex-col',
                activeConv && 'hidden md:flex'
              )}>
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
                          {other.avatar?.url ? (
                            <img src={other.avatar.url} alt="" className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-semibold">
                              {other.name?.[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <p className="font-medium text-sm truncate">{other.name}</p>
                              <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                                {formatDate(conv.lastMessageAt)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {conv.lastMessage?.content || 'No messages yet'}
                            </p>
                            {conv.product && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-brand-600">
                                <Package className="w-3 h-3" />
                                {conv.product.title}
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Messages panel */}
              <div className={cn(
                'flex-1 flex flex-col',
                !activeConv && 'hidden md:flex'
              )}>
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
                        return (
                          <>
                            {other.avatar?.url ? (
                              <img src={other.avatar.url} alt="" className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-semibold">
                                {other.name?.[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1">
                              <p className="font-semibold">{other.name}</p>
                              {activeConv.product && (
                                <motion.button
                                  onClick={() => navigate(`/product/${activeConv.product._id}`)}
                                  className="text-xs text-brand-600 hover:underline"
                                  whileHover={{ x: 4 }}
                                >
                                  About: {activeConv.product.title}
                                </motion.button>
                              )}
                            </div>
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
                                <p className="text-sm leading-relaxed">{msg.content}</p>
                                <p className={cn(
                                  'text-xs mt-1',
                                  isMe ? 'text-white/70' : 'text-slate-400'
                                )}>
                                  {formatTime(msg.createdAt)}
                                </p>
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
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
                      />
                      <MagneticButton
                        type="submit"
                        disabled={!input.trim() || sending}
                        className="btn-primary px-4"
                        strength={0.15}
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
    </PageTransition>
  );
}
