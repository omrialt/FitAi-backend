import { ObjectId } from 'mongodb';
import { Types } from 'mongoose';
import { ForbiddenException } from '@nestjs/common';
import {
  assertOwnerOrAdmin,
  isInUserList,
  isOwnerOrAdmin,
  toIdString,
  type Requester,
} from './ownership';

const OWNER = new ObjectId();
const OTHER = new ObjectId();

const owner: Requester = { id: OWNER.toHexString(), role: 'user' };
const other: Requester = { id: OTHER.toHexString(), role: 'user' };
const admin: Requester = { id: OTHER.toHexString(), role: 'admin' };

describe('toIdString', () => {
  it('passes a string through unchanged', () => {
    expect(toIdString(OWNER.toHexString())).toBe(OWNER.toHexString());
  });

  it('converts a raw ObjectId', () => {
    expect(toIdString(OWNER)).toBe(OWNER.toHexString());
  });

  it('converts a mongoose ObjectId', () => {
    const mongooseId = new Types.ObjectId();
    expect(toIdString(mongooseId)).toBe(mongooseId.toHexString());
  });

  // Regression: ObjectId exposes an `_id` getter that returns itself, so an
  // implementation unwrapping `_id` before recognising ObjectId recurses until
  // the stack blows. That showed up as a 500 "Maximum call stack size
  // exceeded" on every route that populated a user reference. The self-
  // referencing object is built explicitly here so the guarantee holds
  // regardless of which bson build is installed.
  it('terminates on a self-referencing _id', () => {
    const selfRef: Record<string, unknown> = { toHexString: () => 'deadbeef' };
    selfRef._id = selfRef;
    expect(toIdString(selfRef)).toBe('deadbeef');

    const noHex: Record<string, unknown> = {};
    noHex._id = noHex;
    expect(() => toIdString(noHex)).not.toThrow();
  });

  it('unwraps a populated sub-document', () => {
    const populated = { _id: OWNER, fullName: 'Demo', email: 'd@example.test' };
    expect(toIdString(populated)).toBe(OWNER.toHexString());
  });

  it('returns null for nullish input', () => {
    expect(toIdString(null)).toBeNull();
    expect(toIdString(undefined)).toBeNull();
  });
});

describe('isOwnerOrAdmin', () => {
  it('accepts the owner in every reference shape', () => {
    expect(isOwnerOrAdmin(OWNER, owner)).toBe(true);
    expect(isOwnerOrAdmin(OWNER.toHexString(), owner)).toBe(true);
    expect(isOwnerOrAdmin({ _id: OWNER }, owner)).toBe(true);
  });

  it('rejects a different user', () => {
    expect(isOwnerOrAdmin(OWNER, other)).toBe(false);
  });

  it('lets an admin through regardless of owner', () => {
    expect(isOwnerOrAdmin(OWNER, admin)).toBe(true);
  });

  it('fails closed when the owner is missing', () => {
    expect(isOwnerOrAdmin(null, other)).toBe(false);
    expect(isOwnerOrAdmin(undefined, other)).toBe(false);
  });
});

describe('assertOwnerOrAdmin', () => {
  it('throws Forbidden for a non-owner', () => {
    expect(() => assertOwnerOrAdmin(OWNER, other, 'measurement')).toThrow(
      ForbiddenException,
    );
  });

  it('stays silent for the owner', () => {
    expect(() => assertOwnerOrAdmin(OWNER, owner)).not.toThrow();
  });
});

describe('isInUserList', () => {
  it('finds the user across mixed reference shapes', () => {
    expect(isInUserList([OTHER, OWNER], owner.id)).toBe(true);
    expect(isInUserList([{ _id: OWNER }], owner.id)).toBe(true);
    expect(isInUserList([OWNER.toHexString()], owner.id)).toBe(true);
  });

  it('returns false for a miss or a non-array', () => {
    expect(isInUserList([OTHER], owner.id)).toBe(false);
    expect(isInUserList(undefined, owner.id)).toBe(false);
  });
});
