const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '../.env' });

async function testConnection() {
  console.log('🔍 Testing MongoDB Atlas connection...');
  
  const atlasUri = process.env.MONGO_URI;
  
  if (!atlasUri) {
    console.error('❌ MONGO_URI not found in environment variables');
    return;
  }
  
  console.log(`🔗 Connection string: ${atlasUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
  
  try {
    console.log('⏳ Attempting to connect...');
    const connection = await mongoose.connect(atlasUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 5000,
    });
    
    console.log('✅ Successfully connected to MongoDB Atlas!');
    console.log(`📊 Connected to database: ${connection.connection.db?.databaseName}`);
    
    await mongoose.disconnect();
    console.log('🔐 Connection closed successfully');
    
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB Atlas:');
    console.error(`Error: ${error.message}`);
    console.error(`Error Code: ${error.codeName || 'Unknown'}`);
    
    // Try local connection as fallback
    console.log('\n🏠 Trying local MongoDB connection...');
    try {
      const localConnection = await mongoose.connect('mongodb://localhost:27017/fitai');
      console.log('✅ Successfully connected to local MongoDB!');
      await mongoose.disconnect();
    } catch (localError) {
      console.error('❌ Local MongoDB connection also failed:');
      console.error(localError.message);
    }
  }
}

testConnection().then(() => process.exit(0));