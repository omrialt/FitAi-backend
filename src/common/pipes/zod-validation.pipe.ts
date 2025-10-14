import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, z } from 'zod';

@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform {
  constructor(private schema: ZodSchema<T>) {}

  transform(value: unknown): z.infer<typeof this.schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.errors.map((error) => ({
          field: error.path.join('.'),
          message: error.message,
        })),
      });
    }

    return result.data;
  }
}
