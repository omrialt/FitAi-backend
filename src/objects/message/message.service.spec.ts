import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MessageService } from './message.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

const TRAINER = new Types.ObjectId().toString();
const CLIENT = new Types.ObjectId().toString();
const STRANGER = new Types.ObjectId().toString();

function findChain(value: unknown) {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
}

describe('MessageService', () => {
  let service: MessageService;
  let messageModel: {
    create: jest.Mock;
    find: jest.Mock;
    updateMany: jest.Mock;
    countDocuments: jest.Mock;
    aggregate: jest.Mock;
  };
  let userModel: { find: jest.Mock };
  let trainerAccess: {
    isAcceptedTrainerOf: jest.Mock;
    listAcceptedPairs: jest.Mock;
  };

  /**
   * The connection graph for a test, as it really is: a directed edge means
   * "the first user is the accepted trainer of the second".
   */
  function connections(edges: [string, string][]) {
    trainerAccess.isAcceptedTrainerOf.mockImplementation(
      (trainerId: string, clientId: string) =>
        Promise.resolve(
          edges.some(([t, c]) => t === trainerId && c === clientId),
        ),
    );
    trainerAccess.listAcceptedPairs.mockImplementation((userId: string) =>
      Promise.resolve(
        edges
          .filter(([t, c]) => t === userId || c === userId)
          .map(([trainerId, clientId]) => ({ trainerId, clientId })),
      ),
    );
  }

  beforeEach(async () => {
    messageModel = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      find: jest.fn().mockReturnValue(findChain([])),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    userModel = { find: jest.fn().mockReturnValue(findChain([])) };
    trainerAccess = {
      isAcceptedTrainerOf: jest.fn().mockResolvedValue(false),
      listAcceptedPairs: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: getModelToken('Message'), useValue: messageModel },
        { provide: getModelToken('User'), useValue: userModel },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(MessageService);
  });

  /**
   * Both directions, every time. Checking only that the gate blocks would miss
   * a gate that blocks too much — which is the failure that leaves a feature
   * looking unbuilt from one of the two seats that needs it.
   */
  describe('who may write to whom', () => {
    it('lets a trainer write to their own client', async () => {
      connections([[TRAINER, CLIENT]]);

      await service.send(TRAINER, CLIENT, 'Good session today');

      const [doc] = messageModel.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(String(doc.trainerId)).toBe(TRAINER);
      expect(String(doc.clientId)).toBe(CLIENT);
      expect(String(doc.senderId)).toBe(TRAINER);
      expect(doc.readAt).toBeNull();
    });

    it('lets that client write back, into the same pair', async () => {
      connections([[TRAINER, CLIENT]]);

      await service.send(CLIENT, TRAINER, 'My knee still hurts');

      const [doc] = messageModel.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      // Same thread, opposite sender — not a second conversation.
      expect(String(doc.trainerId)).toBe(TRAINER);
      expect(String(doc.clientId)).toBe(CLIENT);
      expect(String(doc.senderId)).toBe(CLIENT);
    });

    it("refuses a trainer writing to someone else's client", async () => {
      connections([[STRANGER, CLIENT]]);

      await expect(service.send(TRAINER, CLIENT, 'hello')).rejects.toThrow(
        ForbiddenException,
      );
      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('refuses a client writing to an arbitrary user', async () => {
      connections([[TRAINER, CLIENT]]);

      await expect(service.send(CLIENT, STRANGER, 'hello')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses both directions once the connection is revoked', async () => {
      connections([]); // revoke() flipped the status, so no accepted edge

      await expect(service.send(TRAINER, CLIENT, 'hi')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.send(CLIENT, TRAINER, 'hi')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a message to yourself', async () => {
      connections([[TRAINER, CLIENT]]);

      await expect(
        service.send(TRAINER, TRAINER, 'note to self'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a malformed id without letting it reach Mongo', async () => {
      connections([[TRAINER, CLIENT]]);

      await expect(service.send(TRAINER, 'not-an-id', 'hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(trainerAccess.isAcceptedTrainerOf).not.toHaveBeenCalled();
    });

    /**
     * Two people who coach each other resolve to one pair whoever is asking.
     * If resolution depended on the caller they would each write into their
     * own thread and see half the conversation.
     */
    it('puts mutual coaches in one thread, not two', async () => {
      connections([
        [TRAINER, CLIENT],
        [CLIENT, TRAINER],
      ]);

      await service.send(TRAINER, CLIENT, 'a');
      await service.send(CLIENT, TRAINER, 'b');

      const pairs = messageModel.create.mock.calls.map(
        ([doc]: [Record<string, unknown>]) =>
          `${String(doc.trainerId)}:${String(doc.clientId)}`,
      );
      expect(pairs[0]).toBe(pairs[1]);
    });
  });

  describe('reading a thread', () => {
    it('returns the newest messages in reading order', async () => {
      connections([[TRAINER, CLIENT]]);
      messageModel.find.mockReturnValue(
        // The query sorts newest-first; the service flips it back.
        findChain([{ body: 'third' }, { body: 'second' }, { body: 'first' }]),
      );

      const thread = await service.getThread(TRAINER, CLIENT);

      expect(
        thread.map((m) => (m as unknown as { body: string }).body),
      ).toEqual(['first', 'second', 'third']);
    });

    it('filters by `after` for polling', async () => {
      connections([[TRAINER, CLIENT]]);
      const after = '2026-09-20T10:00:00.000Z';

      await service.getThread(TRAINER, CLIENT, after);

      const [filter] = messageModel.find.mock.calls[0] as [
        { createdAt?: { $gt: Date } },
      ];
      expect(filter.createdAt?.$gt).toEqual(new Date(after));
    });

    it('rejects an `after` that is not a date', async () => {
      connections([[TRAINER, CLIENT]]);

      await expect(
        service.getThread(TRAINER, CLIENT, 'yesterday'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a thread between two users who are not connected', async () => {
      connections([]);

      await expect(service.getThread(TRAINER, CLIENT)).rejects.toThrow(
        ForbiddenException,
      );
      expect(messageModel.find).not.toHaveBeenCalled();
    });
  });

  describe('read state', () => {
    it("marks only the other party's messages, never your own", async () => {
      connections([[TRAINER, CLIENT]]);

      await service.markRead(TRAINER, CLIENT);

      const [filter] = messageModel.updateMany.mock.calls[0] as [
        { senderId: { $ne: Types.ObjectId }; readAt: null },
      ];
      expect(String(filter.senderId.$ne)).toBe(TRAINER);
      // Already-read messages are left alone, so `readAt` keeps the first
      // time it was seen rather than the last time the thread was opened.
      expect(filter.readAt).toBeNull();
    });

    it('counts unread only inside live connections', async () => {
      connections([[TRAINER, CLIENT]]);
      messageModel.countDocuments.mockResolvedValue(4);

      await expect(service.unreadCount(CLIENT)).resolves.toEqual({ unread: 4 });

      const [filter] = messageModel.countDocuments.mock.calls[0] as [
        { $or: { trainerId: Types.ObjectId; clientId: Types.ObjectId }[] },
      ];
      expect(filter.$or).toHaveLength(1);
      expect(String(filter.$or[0].trainerId)).toBe(TRAINER);
    });

    it('is zero, without a query, for someone with no connections', async () => {
      connections([]);

      await expect(service.unreadCount(STRANGER)).resolves.toEqual({
        unread: 0,
      });
      expect(messageModel.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('thread list', () => {
    it('lists a connected client nobody has written to yet', async () => {
      connections([[TRAINER, CLIENT]]);
      userModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(CLIENT),
            fullName: 'Dana Client',
            email: 'dana@example.com',
          },
        ]),
      );

      const threads = await service.listThreads(TRAINER);

      expect(threads).toHaveLength(1);
      expect(threads[0].userId).toBe(CLIENT);
      expect(threads[0].callerIsTrainer).toBe(true);
      // An empty conversation is a conversation waiting to start, not an
      // absent one — otherwise a new client has nowhere to be written to.
      expect(threads[0].lastMessage).toBeNull();
      expect(threads[0].unread).toBe(0);
    });

    it('shows the client their trainer, from the other side of the same pair', async () => {
      connections([[TRAINER, CLIENT]]);
      userModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(TRAINER),
            fullName: 'Omri Coach',
            email: 'coach@example.com',
          },
        ]),
      );

      const threads = await service.listThreads(CLIENT);

      expect(threads[0].userId).toBe(TRAINER);
      expect(threads[0].callerIsTrainer).toBe(false);
    });

    it('sorts unread threads above quiet ones', async () => {
      const second = new Types.ObjectId().toString();
      connections([
        [TRAINER, CLIENT],
        [TRAINER, second],
      ]);
      userModel.find.mockReturnValue(
        findChain([
          { _id: new Types.ObjectId(CLIENT), fullName: 'Quiet' },
          { _id: new Types.ObjectId(second), fullName: 'Waiting' },
        ]),
      );
      messageModel.aggregate.mockResolvedValue([
        {
          _id: {
            trainerId: new Types.ObjectId(TRAINER),
            clientId: new Types.ObjectId(second),
          },
          lastBody: 'when do we train?',
          lastAt: new Date(),
          lastSenderId: new Types.ObjectId(second),
          unread: 2,
        },
      ]);

      const threads = await service.listThreads(TRAINER);

      expect(threads[0].fullName).toBe('Waiting');
      expect(threads[0].unread).toBe(2);
      expect(threads[0].lastMessage?.fromMe).toBe(false);
    });

    it('is empty for a user with no accepted connections', async () => {
      connections([]);

      await expect(service.listThreads(STRANGER)).resolves.toEqual([]);
      expect(messageModel.aggregate).not.toHaveBeenCalled();
    });
  });
});
