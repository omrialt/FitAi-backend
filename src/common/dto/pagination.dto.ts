import { z } from 'zod';

export const paginationSchema = z
  .object({
    page: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .transform((data) => ({
    page: data.page ? Number(data.page) : 1,
    limit: data.limit ? Number(data.limit) : 10,
    sort: data.sort,
    order: data.order,
  }))
  .refine((data) => data.page >= 1, {
    message: 'Page must be at least 1',
    path: ['page'],
  })
  .refine((data) => data.limit >= 1 && data.limit <= 10000, {
    message: 'Limit must be between 1 and 10000',
    path: ['limit'],
  });

export type PaginationDto = z.infer<typeof paginationSchema>;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
