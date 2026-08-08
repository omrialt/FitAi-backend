import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserOwnershipGuard } from './ownership.guard';
import type { TrainerAccessService } from '../trainer-access/trainer-access.service';
import type { OwnsUserParamMetadata } from '../decorators/owns-user-param.decorator';

const OWNER = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const TRAINER = '507f1f77bcf86cd799439013';

function contextFor(
  user: { id?: string; role?: string },
  params: Record<string, string>,
  method = 'GET',
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params, method }) }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('UserOwnershipGuard', () => {
  let reflector: { get: jest.Mock };
  let trainerAccess: { isAcceptedTrainerOf: jest.Mock };
  let guard: UserOwnershipGuard;

  const rule = (over: Partial<OwnsUserParamMetadata> = {}) => ({
    param: 'userId',
    allowTrainer: true,
    ...over,
  });

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(rule()) };
    trainerAccess = { isAcceptedTrainerOf: jest.fn().mockResolvedValue(false) };
    guard = new UserOwnershipGuard(
      reflector as unknown as Reflector,
      trainerAccess as unknown as TrainerAccessService,
    );
  });

  it('lets an undecorated route through untouched', async () => {
    reflector.get.mockReturnValue(undefined);
    await expect(
      guard.canActivate(
        contextFor({ id: OWNER, role: 'user' }, { userId: OTHER }),
      ),
    ).resolves.toBe(true);
    expect(trainerAccess.isAcceptedTrainerOf).not.toHaveBeenCalled();
  });

  it('allows a user to reach their own id', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: OWNER, role: 'user' }, { userId: OWNER }),
      ),
    ).resolves.toBe(true);
  });

  it('denies a user reaching someone else', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: OWNER, role: 'user' }, { userId: OTHER }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets admins cross user boundaries', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: OWNER, role: 'admin' }, { userId: OTHER }),
      ),
    ).resolves.toBe(true);
  });

  describe('trainer access', () => {
    it('allows reading a client who accepted the connection', async () => {
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
      await expect(
        guard.canActivate(
          contextFor({ id: TRAINER, role: 'trainer' }, { userId: OWNER }),
        ),
      ).resolves.toBe(true);
      expect(trainerAccess.isAcceptedTrainerOf).toHaveBeenCalledWith(
        TRAINER,
        OWNER,
      );
    });

    it('denies a trainer with no accepted connection', async () => {
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);
      await expect(
        guard.canActivate(
          contextFor({ id: TRAINER, role: 'trainer' }, { userId: OWNER }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Read access is the grant; a coach must not overwrite a client's records.
    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      'denies %s even for a connected client',
      async (method) => {
        trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
        await expect(
          guard.canActivate(
            contextFor(
              { id: TRAINER, role: 'trainer' },
              { userId: OWNER },
              method,
            ),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('honours allowTrainer: false on sensitive routes', async () => {
      reflector.get.mockReturnValue(rule({ allowTrainer: false }));
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
      await expect(
        guard.canActivate(
          contextFor({ id: TRAINER, role: 'trainer' }, { userId: OWNER }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainerAccess.isAcceptedTrainerOf).not.toHaveBeenCalled();
    });

    it('does not grant a plain user the trainer shortcut', async () => {
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
      await expect(
        guard.canActivate(
          contextFor({ id: OTHER, role: 'user' }, { userId: OWNER }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('rejects an unauthenticated request', async () => {
    await expect(
      guard.canActivate(contextFor({}, { userId: OWNER })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
