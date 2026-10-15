const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const setupSocket = require('../sockets');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let httpServer, io, port;
let userA, userB, tokenA, tokenB, conversation;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;

  httpServer = http.createServer();
  io = new Server(httpServer, { cors: { origin: '*' } });
  setupSocket(io);

  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      resolve();
    });
  });
});

beforeEach(async () => {
  userA = await User.create({ name: 'Alice', email: `alice-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'pass123' });
  userB = await User.create({ name: 'Bob', email: `bob-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'pass123' });
  tokenA = jwt.sign({ id: userA._id.toString() }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ id: userB._id.toString() }, JWT_SECRET, { expiresIn: '1h' });
  conversation = await Conversation.create({ participants: [userA._id, userB._id] });
});

afterAll(async () => {
  if (io) await new Promise((r) => io.close(r));
  if (httpServer) await new Promise((r) => httpServer.close(r));
});

const connectClient = (token) =>
  new Promise((resolve, reject) => {
    const client = Client(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('Connection timeout'));
    }, 5000);
    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

const waitFor = (emitter, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

// The server emits io.emit('user:status', ...) on every connection.
// This broadcast can arrive at the same time as targeted relay events,
// causing Socket.io 4.x client to drop once()-only listeners.
// Drain these broadcasts before testing relay behavior.
const drainStatus = (client) =>
  new Promise((resolve) => {
    let done = false;
    const handler = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => { if (!done) { done = true; resolve(); } }, 300);
    client.once('user:status', handler);
  });

describe('WebRTC Socket Relay', () => {
  it('rejects connection without a token', (done) => {
    const client = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    });

    client.on('connect_error', (err) => {
      expect(err.message).toMatch(/Authentication error/);
      client.close();
      done();
    });
  });

  it('callUser relays incomingCall with correct caller name', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    await drainStatus(clientA);
    await drainStatus(clientB);

    const incoming = waitFor(clientB, 'incomingCall');

    clientA.emit('callUser', {
      userToCall: userB._id.toString(),
      signalData: { type: 'offer', sdp: 'fake-sdp' },
      from: userA._id.toString(),
      conversationId: conversation._id.toString(),
      callId: 'call-relay-1',
    });

    const data = await incoming;
    expect(data.signal).toEqual({ type: 'offer', sdp: 'fake-sdp' });
    expect(data.from).toBe(userA._id.toString());
    expect(data.callerName).toBe('Alice');

    clientA.close();
    clientB.close();
  });

  it('answerCall relays callAccepted back to caller', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    await drainStatus(clientA);
    await drainStatus(clientB);

    const incoming = waitFor(clientB, 'incomingCall');
    clientA.emit('callUser', {
      userToCall: userB._id.toString(),
      signalData: { type: 'offer', sdp: 'offer-sdp' },
      from: userA._id.toString(),
      conversationId: conversation._id.toString(),
      callId: 'call-relay-2',
    });
    await incoming;

    const accepted = waitFor(clientA, 'callAccepted');
    clientB.emit('answerCall', {
      to: userA._id.toString(),
      signal: { type: 'answer', sdp: 'answer-sdp' },
      callId: 'call-relay-2',
    });

    const data = await accepted;
    expect(data.signal).toEqual({ type: 'answer', sdp: 'answer-sdp' });

    clientA.close();
    clientB.close();
  });

  it('iceCandidate relays between both peers', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    await drainStatus(clientA);
    await drainStatus(clientB);

    const incoming = waitFor(clientB, 'incomingCall');
    clientA.emit('callUser', { userToCall: userB._id.toString(), signalData: { type: 'offer' }, conversationId: conversation._id.toString(), callId: 'call-ice-1' });
    await incoming;

    const candidateFromB = waitFor(clientA, 'iceCandidate');
    clientB.emit('iceCandidate', {
      to: userA._id.toString(),
      candidate: { candidate: 'candidate-1', sdpMid: '0' },
      callId: 'call-ice-1',
    });
    const data1 = await candidateFromB;
    expect(data1.candidate).toEqual({ candidate: 'candidate-1', sdpMid: '0' });

    const candidateFromA = waitFor(clientB, 'iceCandidate');
    clientA.emit('iceCandidate', {
      to: userB._id.toString(),
      candidate: { candidate: 'candidate-2', sdpMid: '0' },
      callId: 'call-ice-1',
    });
    const data2 = await candidateFromA;
    expect(data2.candidate).toEqual({ candidate: 'candidate-2', sdpMid: '0' });

    clientA.close();
    clientB.close();
  });

  it('endCall relays callEnded', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    await drainStatus(clientA);
    await drainStatus(clientB);

    const ended = waitFor(clientB, 'callEnded');
    const incoming = waitFor(clientB, 'incomingCall');
    clientA.emit('callUser', { userToCall: userB._id.toString(), signalData: { type: 'offer' }, conversationId: conversation._id.toString(), callId: 'call-end-1' });
    await incoming;
    clientA.emit('endCall', { to: userB._id.toString(), callId: 'call-end-1' });
    await ended;

    clientA.close();
    clientB.close();
  });

  it('events only reach the targeted user', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    const charlie = await User.create({ name: 'Charlie', email: `charlie-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'pass123' });
    const tokenC = jwt.sign({ id: charlie._id.toString() }, JWT_SECRET, { expiresIn: '1h' });
    const clientC = await connectClient(tokenC);
    await drainStatus(clientA);
    await drainStatus(clientB);
    await drainStatus(clientC);

    let cReceived = false;
    clientC.on('incomingCall', () => {
      cReceived = true;
    });

    const incomingB = waitFor(clientB, 'incomingCall');
    clientA.emit('callUser', {
      userToCall: userB._id.toString(),
      signalData: { type: 'offer', sdp: 'test' },
      from: userA._id.toString(),
      conversationId: conversation._id.toString(),
      callId: 'call-relay-3',
    });
    await incomingB;

    await new Promise((r) => setTimeout(r, 500));
    expect(cReceived).toBe(false);

    clientA.close();
    clientB.close();
    clientC.close();
  });

  it('persists one authorized call record without signaling data', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    await drainStatus(clientA);
    await drainStatus(clientB);
    const incoming = waitFor(clientB, 'incomingCall');
    clientA.emit('callUser', {
      userToCall: userB._id.toString(),
      signalData: { type: 'offer', sdp: 'never-store-this' },
      conversationId: conversation._id.toString(),
      callId: 'call-history-1',
    });
    await incoming;
    const updated = waitFor(clientB, 'call:updated');
    clientB.emit('endCall', { to: userA._id.toString(), callId: 'call-history-1', reason: 'rejected' });
    const event = await updated;
    const record = await Message.findOne({ 'call.callId': 'call-history-1' }).lean();
    expect(record.type).toBe('call');
    expect(record.call.outcome).toBe('rejected');
    expect(record.call.durationSeconds).toBe(0);
    expect(JSON.stringify(record)).not.toContain('never-store-this');
    expect(event._id).toBe(record._id.toString());
    clientA.close();
    clientB.close();
  });

  it('does not relay calls to a user outside the conversation', async () => {
    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);
    await drainStatus(clientA);
    await drainStatus(clientB);
    let relayed = false;
    clientB.on('incomingCall', () => { relayed = true; });
    clientA.emit('callUser', { userToCall: userB._id.toString(), signalData: { type: 'offer' }, conversationId: new mongoose.Types.ObjectId().toString(), callId: 'call-denied-1' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(relayed).toBe(false);
    expect(await Message.countDocuments({ 'call.callId': 'call-denied-1' })).toBe(0);
    clientA.close();
    clientB.close();
  });
});
