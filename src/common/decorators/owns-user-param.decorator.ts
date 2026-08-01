import { SetMetadata } from '@nestjs/common';

export const OWNS_USER_PARAM_KEY = 'ownsUserParam';

/**
 * Marks a route whose `:userId`-style path parameter must identify the caller.
 *
 * `@Roles(...)` answers "what kind of account is this?", which is not the same
 * question as "is this row yours?". Every route that reads or writes per-user
 * data by an id taken from the URL needs both, or any authenticated account can
 * swap the id and reach someone else's records.
 *
 * Enforced by `UserOwnershipGuard`; admins bypass it.
 */
export const OwnsUserParam = (param = 'userId') =>
  SetMetadata(OWNS_USER_PARAM_KEY, param);
