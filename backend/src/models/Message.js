const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: function requiredContent() {
        return this.type !== 'call' && !(this.attachments && this.attachments.length);
      },
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    attachments: [
      {
        url: { type: String, required: true },
        publicId: { type: String },
        type: { type: String, enum: ['image'], default: 'image' },
      },
    ],
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    type: {
      type: String,
      enum: ['text', 'image', 'system', 'call'],
      default: 'text',
    },
    // Signalling is deliberately never persisted. This is only the durable
    // call-history metadata needed to render the chat timeline.
    call: {
      callId: { type: String, index: true },
      outcome: {
        type: String,
        enum: ['outgoing', 'incoming', 'missed', 'rejected', 'cancelled', 'completed'],
      },
      durationSeconds: { type: Number, min: 0, default: 0 },
      startedAt: Date,
      endedAt: Date,
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ 'call.callId': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Message', messageSchema);
