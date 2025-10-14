import { MongooseModuleOptions } from '@nestjs/mongoose';

export const databaseConfig = (): MongooseModuleOptions => ({
  uri: process.env.MONGO_URI || 'mongodb://localhost:27017/fitai',
});
