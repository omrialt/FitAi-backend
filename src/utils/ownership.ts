import { ForbiddenException } from '@nestjs/common';

/** The subset of `req.user` needed to make an access decision. */
export interface Requester {
  id: string;
  role: string;
}

/**
 * Normalize anything Mongoose might hand back for a reference field.
 *
 * The same field is a raw ObjectId on a lean document, a string when it was
 * just assigned, and a populated sub-document after `.populate()`. Comparing
 * without normalizing silently fails open on whichever shape wasn't expected,
 * so every ownership check funnels through here.
 */
export function toIdString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const candidate = value as {
    toHexString?: () => string;
    _id?: unknown;
  };

  // Check the ObjectId form FIRST. bson's ObjectId exposes an `_id` getter that
  // returns the ObjectId itself, so recursing on `_id` before this would spin
  // until the stack blows — which is exactly what a populated reference did.
  if (typeof candidate.toHexString === 'function') {
    return candidate.toHexString();
  }
  // A populated sub-document: unwrap one level, guarding against the same
  // self-reference trap for any other type that pulls the same trick.
  if (candidate._id != null && candidate._id !== value) {
    return toIdString(candidate._id);
  }
  // An object shape we don't recognise. Return null rather than stringifying it
  // into '[object Object]': every comparison here decides access, so an
  // unidentifiable reference must fail closed, not produce a value that could
  // accidentally match.
  return null;
}

/** True when the requester owns the record, or is an admin. */
export function isOwnerOrAdmin(
  ownerId: unknown,
  requester: Requester,
): boolean {
  if (requester.role === 'admin') return true;
  const owner = toIdString(ownerId);
  return owner != null && owner === requester.id;
}

/**
 * Throw unless the requester owns the record (or is an admin).
 *
 * Deliberately raises 403 rather than 404: the caller already had to know a
 * valid id to get here, so hiding existence buys nothing and a distinct status
 * makes the denial obvious in logs.
 */
export function assertOwnerOrAdmin(
  ownerId: unknown,
  requester: Requester,
  resource = 'record',
): void {
  if (!isOwnerOrAdmin(ownerId, requester)) {
    throw new ForbiddenException(`You do not have access to this ${resource}`);
  }
}

/** True when the requester appears anywhere in a list of user references. */
export function isInUserList(list: unknown, requesterId: string): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((entry) => toIdString(entry) === requesterId);
}
