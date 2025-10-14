import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

export const generateUUID = (): string => uuidv4();

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 10;
  const salt: string = await bcrypt.genSalt(saltRounds);
  const hashed: string = await bcrypt.hash(password, salt);

  return hashed;
};

export const comparePasswords = async (
  plain: string,
  hashedPassword: string,
): Promise<boolean> => {
  const result: boolean = await bcrypt.compare(plain, hashedPassword);

  return result;
};
