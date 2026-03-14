import { BadRequestException } from '@nestjs/common';
import { SortOrder } from 'mongoose';
import { ZodSchema } from 'zod';
import { MongooseError } from '../interfaces/mongo.interfaces';

/**
 * Builds a sort query object for MongoDB from sort field and order
 * @param sort - Field name to sort by
 * @param order - Sort order ('asc' or 'desc')
 * @returns MongoDB sort query object or undefined
 */
export function buildSortQuery(
  sort?: string,
  order: 'asc' | 'desc' = 'asc',
): { [key: string]: SortOrder } | undefined {
  if (!sort) return undefined;
  return { [sort]: order === 'asc' ? 1 : -1 };
}

/**
 * Validates data against a Zod schema
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated data
 * @throws BadRequestException if validation fails
 */
export function validateData<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException(
      result.error.errors.map((e) => e.message).join(', '),
    );
  }
  return result.data;
}

/**
 * Handles MongoDB/Mongoose errors and converts them to appropriate NestJS exceptions
 * @param error - Error to handle
 * @throws BadRequestException for cast errors or duplicate key errors
 * @throws Original error if not a handled MongoDB error
 */
export function handleMongoError(error: unknown): never {
  if (error instanceof Error) {
    const mongoError = error as MongooseError;
    if (mongoError.name === 'CastError') {
      throw new BadRequestException('Invalid ID format');
    }
    if (mongoError.code === 11000) {
      throw new BadRequestException(
        'Resource with this unique field already exists',
      );
    }
  }
  throw error;
}
