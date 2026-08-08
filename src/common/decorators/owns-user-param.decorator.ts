import { SetMetadata } from '@nestjs/common';

export const OWNS_USER_PARAM_KEY = 'ownsUserParam';

export interface OwnsUserParamOptions {
  /**
   * Let a trainer with an accepted connection read this client's data.
   * Read-only by definition — the guard never extends it to writes.
   *
   * Defaults to true: every route currently carrying this decorator exposes
   * exactly the training, measurement and progress data a coach is supposed to
   * see. Set it to false on anything a trainer must not read even for their
   * own clients (account settings, tokens, billing).
   */
  allowTrainer?: boolean;
}

export interface OwnsUserParamMetadata extends OwnsUserParamOptions {
  param: string;
}

/**
 * Marks a route whose `:userId`-style path parameter must identify the caller.
 *
 * `@Roles(...)` answers "what kind of account is this?", which is not the same
 * question as "is this row yours?". Every route that reads or writes per-user
 * data by an id taken from the URL needs both, or any authenticated account can
 * swap the id and reach someone else's records.
 *
 * Enforced by `UserOwnershipGuard`; admins bypass it, and connected trainers
 * get read access unless `allowTrainer: false`.
 */
export const OwnsUserParam = (
  param = 'userId',
  options: OwnsUserParamOptions = {},
) =>
  SetMetadata<string, OwnsUserParamMetadata>(OWNS_USER_PARAM_KEY, {
    param,
    allowTrainer: options.allowTrainer ?? true,
  });
