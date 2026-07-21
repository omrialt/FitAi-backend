import { Logger } from '@nestjs/common';
import { MongooseModuleOptions } from '@nestjs/mongoose';

export const getDatabaseConfig = (): MongooseModuleOptions => {
  const mongoUri = process.env.MONGO_URI!;

  // Credentials are masked before logging
  new Logger('DatabaseConfig').log(
    `MongoDB URI: ${mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`,
  );

  return {
    uri: mongoUri,
    // Connection timeout settings
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };
};
