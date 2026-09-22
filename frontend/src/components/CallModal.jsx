import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, MicOff, Mic } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

const CallModal = forwardRef(function CallModal(_, ref) {
  const { socket, emit, on, off } = useSocket();
  const { user } = useAuth();

  const [receivingCall, setReceivingCall] = useState(false);
  const [callerName, setCallerName] = useState('');
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [calling, setCalling] = useState(false);
  const [activeCallTo, setActiveCallTo] = useState(null);

  const userAudio = useRef();
  const peerAudio = useRef();
  const connectionRef = useRef();
  const streamRef = useRef();
  const pendingSignalRef = useRef(null);
  const pendingCallerRef = useRef(null);

  const cleanup = () => {
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    pendingSignalRef.current = null;
    pendingCallerRef.current = null;
    setReceivingCall(false);
    setCallAccepted(false);
    setCallEnded(false);
    setCallerName('');
    setActiveCallTo(null);
    setIsMuted(false);
    setCalling(false);
  };

  const endCall = (emitEvent = true) => {
    setCallEnded(true);
    if (emitEvent && activeCallTo && socket) {
      emit('endCall', { to: activeCallTo });
    }
    cleanup();
  };

  useEffect(() => {
    if (!socket) return;

    const handleIncoming = (data) => {
      pendingSignalRef.current = data.signal;
      pendingCallerRef.current = data.from;
      setReceivingCall(true);
      setCallerName(data.callerName);
      setActiveCallTo(data.from);
    };

    const handleAccepted = (data) => {
      if (connectionRef.current && !connectionRef.current._answered) {
        connectionRef.current._answered = true;
        connectionRef.current
          .setRemoteDescription(new RTCSessionDescription(data.signal))
          .catch((e) => console.error('setRemoteDescription error', e));
        setCalling(false);
        setCallAccepted(true);
      }
    };

    const handleIce = (data) => {
      if (connectionRef.current) {
        connectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((e) =>
          console.error('addIceCandidate error', e)
        );
      }
    };

    const handleEnded = () => {
      endCall(false);
    };

    on('incomingCall', handleIncoming);
    on('callAccepted', handleAccepted);
    on('iceCandidate', handleIce);
    on('callEnded', handleEnded);

    return () => {
      off('incomingCall');
      off('callAccepted');
      off('iceCandidate');
      off('callEnded');
    };
  }, [socket, on, off]);

  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      streamRef.current = stream;
      if (userAudio.current) {
        userAudio.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.error('Microphone access denied', err);
      return null;
    }
  };

  const createPeer = (stream, remoteUserId) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    peer.ontrack = (event) => {
      if (peerAudio.current) {
        peerAudio.current.srcObject = event.streams[0];
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && remoteUserId) {
        emit('iceCandidate', { to: remoteUserId, candidate: event.candidate });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        endCall(false);
      }
    };

    connectionRef.current = peer;
    return peer;
  };

  const startCall = async (targetUserId, targetName) => {
    const stream = await getMedia();
    if (!stream) return;

    setCalling(true);
    setCallerName(targetName);
    setActiveCallTo(targetUserId);
    setCallAccepted(false);

    const peer = createPeer(stream, targetUserId);

    peer._answered = false;

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    emit('callUser', {
      userToCall: targetUserId,
      signalData: offer,
      from: user._id,
      conversationId: null,
    });
  };

  useImperativeHandle(ref, () => ({
    startCall,
  }));

  const answerCall = async () => {
    const signal = pendingSignalRef.current;
    if (!signal) return;

    setCallAccepted(true);

    const stream = await getMedia();
    if (!stream) {
      endCall(true);
      return;
    }

    const peer = createPeer(stream, activeCallTo);
    peer._answered = true;

    await peer.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    emit('answerCall', { signal: answer, to: activeCallTo });
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const showModal = receivingCall || calling || callAccepted;
  if (!showModal || callEnded) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, x: '-50%' }}
        animate={{ opacity: 1, y: 0, x: '-50%' }}
        exit={{ opacity: 0, y: -20, x: '-50%' }}
        className="fixed top-5 left-1/2 z-[10000] bg-white rounded-3xl shadow-glass-lg p-6 min-w-[320px] text-center border border-slate-200"
      >
        <audio playsInline ref={userAudio} autoPlay muted />
        <audio playsInline ref={peerAudio} autoPlay />

        {calling && !callAccepted && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white text-2xl font-bold animate-pulse">
              {callerName?.[0]?.toUpperCase()}
            </div>
            <h3 className="font-display font-bold text-lg text-slate-900">Calling...</h3>
            <p className="text-sm text-slate-500">{callerName}</p>
            <button
              onClick={() => endCall(true)}
              className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition text-sm font-medium"
            >
              <PhoneOff className="w-4 h-4" /> Cancel
            </button>
          </div>
        )}

        {!callAccepted && receivingCall && !calling && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white text-2xl font-bold">
              {callerName?.[0]?.toUpperCase()}
            </div>
            <h3 className="font-display font-bold text-lg text-slate-900">Incoming Call</h3>
            <p className="text-sm text-slate-500 font-semibold">{callerName}</p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={answerCall}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition text-sm font-medium"
              >
                <Phone className="w-4 h-4" /> Accept
              </button>
              <button
                onClick={() => endCall(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition text-sm font-medium"
              >
                <PhoneOff className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        )}

        {callAccepted && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white text-2xl font-bold">
              {callerName?.[0]?.toUpperCase()}
            </div>
            <h3 className="font-display font-bold text-lg text-slate-900">Active Call</h3>
            <p className="text-sm text-brand-600 font-semibold">{callerName}</p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={toggleMute}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full transition text-sm font-medium ${
                  isMuted
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={() => endCall(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition text-sm font-medium"
              >
                <PhoneOff className="w-4 h-4" /> End Call
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
});

export default CallModal;
