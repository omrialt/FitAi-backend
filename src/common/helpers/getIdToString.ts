import { ObjectId } from 'mongodb';
export function getIdString(Id: unknown): string {
  if (Id instanceof ObjectId) return Id.toString();
  if (typeof Id === 'string') return Id;
  throw new Error('Invalid userId format');
}
