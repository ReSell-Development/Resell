const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`[DB] MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[DB] Connection Error: ${error.message}`);
    if (process.env.NODE_ENV !== 'test') process.exit(1);
    throw error;
  }
};

module.exports = connectDB;
