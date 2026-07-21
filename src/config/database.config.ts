import { Logger } from '@nestjs/common';
import { MongooseModuleOptions } from '@nestjs/mongoose';

export const getDatabaseConfig = (): MongooseModuleOptions => {
  const mongoUri = process.env.MONGO_URI!;

  // Credentials are masked before logging
  new Logger('DatabaseConfig').log(
    `MongoDB URI: ${mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`,
  );

  // On serverless, each warm container holds its own pool and many containers
  // can exist at once, so an unbounded default pool multiplies across them and
  // exhausts the Atlas connection limit. Cap it small; a single container
  // handles one request at a time anyway.
  const isServerless = !!process.env.VERCEL;

  return {
    uri: mongoUri,
    // Connection timeout settings
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    ...(isServerless
      ? {
          maxPoolSize: 5,
          minPoolSize: 0,
          // Drop idle sockets quickly so frozen containers stop holding
          // connections open against the cluster limit.
          maxIdleTimeMS: 10000,
        }
      : {}),
  };
};
