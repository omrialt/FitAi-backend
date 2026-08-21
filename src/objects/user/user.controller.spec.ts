import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserController } from './user.controller';
import type { UserService } from './user.service';
import type { AccountService } from '../account/account.service';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const SELF = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';

function requestFor(id: string, role: string): AuthRequest {
  return {
    user: { id, email: `${id}@example.com`, role, roles: [role] },
  } as AuthRequest;
}

describe('UserController', () => {
  let userService: { findOne: jest.Mock; update: jest.Mock };
  let accountService: { deleteAccount: jest.Mock };
  let controller: UserController;

  beforeEach(() => {
    userService = {
      findOne: jest.fn().mockResolvedValue({ _id: SELF }),
      update: jest.fn().mockResolvedValue({ _id: SELF }),
    };
    accountService = { deleteAccount: jest.fn().mockResolvedValue(undefined) };
    controller = new UserController(
      userService as unknown as UserService,
      accountService as unknown as AccountService,
    );
  });

  describe('/users/me', () => {
    it('reads the caller from the token, never from the path', async () => {
      await controller.findMe(requestFor(SELF, 'user'));
      expect(userService.findOne).toHaveBeenCalledWith(SELF);
    });

    it('writes to the caller, never to a literal "me" id', async () => {
      await controller.updateMe({ name: 'Omri' }, requestFor(SELF, 'user'));
      expect(userService.update).toHaveBeenCalledWith(SELF, { name: 'Omri' });
    });

    it('strips the fields a user must not set on themselves', async () => {
      await controller.updateMe(
        {
          name: 'Omri',
          role: 'admin',
          isActive: true,
          emailVerified: true,
          password: 'hunter2',
        } as never,
        requestFor(SELF, 'user'),
      );
      expect(userService.update).toHaveBeenCalledWith(SELF, { name: 'Omri' });
    });

    // An admin editing "me" is editing their own row, so self-service rules
    // still apply — the escalation path lives on PATCH /users/:id.
    it('strips them for an admin too', async () => {
      await controller.updateMe(
        { name: 'Omri', role: 'admin' } as never,
        requestFor(SELF, 'admin'),
      );
      expect(userService.update).toHaveBeenCalledWith(SELF, { name: 'Omri' });
    });

    it('leaves the caller-supplied DTO untouched', async () => {
      const dto = { name: 'Omri', role: 'admin' } as never;
      await controller.updateMe(dto, requestFor(SELF, 'user'));
      expect(dto).toEqual({ name: 'Omri', role: 'admin' });
    });
  });

  // Nest walks the prototype's own property names in declaration order and
  // registers routes as it goes, so a literal segment declared after a
  // parameterised one is unreachable — which is exactly how `/users/me`
  // became `:id = "me"`. Ordering is invisible at every call site, so it needs
  // a test of its own or the next edit can quietly undo the fix.
  it('declares the literal me routes before the parameterised ones', () => {
    const methods = Object.getOwnPropertyNames(UserController.prototype);
    const at = (name: string) => methods.indexOf(name);

    expect(at('findMe')).toBeGreaterThan(-1);
    expect(at('updateMe')).toBeGreaterThan(-1);
    expect(at('findMe')).toBeLessThan(at('findOne'));
    expect(at('updateMe')).toBeLessThan(at('update'));
  });

  describe(':id routes', () => {
    // The regression that made "me" a 500 rather than a 404: anything Mongo
    // cannot cast reached findById and blew up inside the driver.
    it.each(['me', 'profile', 'not-an-id'])(
      'answers 400 for the unusable id %p instead of reaching Mongo',
      (id) => {
        expect(() => controller.findOne(id)).toThrow(BadRequestException);
        expect(userService.findOne).not.toHaveBeenCalled();
      },
    );

    it('rejects a malformed id on PATCH before the ownership check', () => {
      expect(() =>
        controller.update('me', { name: 'x' }, requestFor(SELF, 'user')),
      ).toThrow(BadRequestException);
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed id on DELETE', () => {
      expect(() => controller.remove('me')).toThrow(BadRequestException);
      expect(accountService.deleteAccount).not.toHaveBeenCalled();
    });

    it('still refuses to let a user patch someone else', () => {
      expect(() =>
        controller.update(OTHER, { name: 'x' }, requestFor(SELF, 'user')),
      ).toThrow(ForbiddenException);
    });

    it('still lets an admin patch anyone, privileged fields included', async () => {
      await controller.update(
        OTHER,
        { role: 'trainer' } as never,
        requestFor(SELF, 'admin'),
      );
      expect(userService.update).toHaveBeenCalledWith(OTHER, {
        role: 'trainer',
      });
    });

    it('still strips privileged fields when a user patches their own id', async () => {
      await controller.update(
        SELF,
        { name: 'Omri', role: 'admin' } as never,
        requestFor(SELF, 'user'),
      );
      expect(userService.update).toHaveBeenCalledWith(SELF, { name: 'Omri' });
    });
  });
});
