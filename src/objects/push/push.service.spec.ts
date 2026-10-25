import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PushService } from './push.service';

const sendEachForMulticast = jest.fn();
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'fitai-push' })),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast })),
}));

const USER = new Types.ObjectId().toHexString();

function lean<T>(value: T) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}

describe('PushService', () => {
  let service: PushService;
  let tokenModel: {
    find: jest.Mock;
    updateOne: jest.Mock;
    deleteOne: jest.Mock;
    deleteMany: jest.Mock;
  };
  let userModel: { findById: jest.Mock; updateOne: jest.Mock };
  const payload = { title: 'New message', body: 'hi', to: '/messages' };

  async function build(serviceAccount: string | undefined) {
    if (serviceAccount === undefined)
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;

    tokenModel = {
      find: jest.fn(() => lean([{ token: 'tok-1' }, { token: 'tok-2' }])),
      updateOne: jest.fn(() => Promise.resolve()),
      deleteOne: jest.fn(() => Promise.resolve()),
      deleteMany: jest.fn(() => Promise.resolve()),
    };
    userModel = {
      findById: jest.fn(() =>
        lean({ notificationPrefs: { messages: true, plans: false } }),
      ),
      updateOne: jest.fn(() => Promise.resolve()),
    };
    const module = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: getModelToken('DeviceToken'), useValue: tokenModel },
        { provide: getModelToken('User'), useValue: userModel },
      ],
    }).compile();
    service = module.get(PushService);
  }

  beforeEach(() => {
    sendEachForMulticast.mockReset().mockResolvedValue({
      successCount: 2,
      responses: [{ success: true }, { success: true }],
    });
  });

  afterAll(() => delete process.env.FIREBASE_SERVICE_ACCOUNT);

  it('sends nothing until Firebase is configured', async () => {
    await build(undefined);

    await expect(service.sendToUser(USER, 'messages', payload)).resolves.toBe(
      0,
    );
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("sends to every one of the user's phones, with the app link", async () => {
    await build('{"project_id":"fitai"}');

    await expect(service.sendToUser(USER, 'messages', payload)).resolves.toBe(
      2,
    );
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['tok-1', 'tok-2'],
        notification: { title: 'New message', body: 'hi' },
        data: { url: 'com.fitai.app://open?to=/messages' },
      }),
    );
  });

  it('respects a kind the user switched off', async () => {
    await build('{"project_id":"fitai"}');

    await expect(service.sendToUser(USER, 'plans', payload)).resolves.toBe(0);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('forgets tokens Google says will never work again', async () => {
    await build('{"project_id":"fitai"}');
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
    });

    await service.sendToUser(USER, 'messages', payload);

    expect(tokenModel.deleteMany).toHaveBeenCalledWith({
      token: { $in: ['tok-2'] },
    });
  });

  // A message is saved before its push; the push must never undo it.
  it('never throws, even when FCM does', async () => {
    await build('{"project_id":"fitai"}');
    sendEachForMulticast.mockRejectedValue(new Error('FCM down'));

    await expect(service.sendToUser(USER, 'messages', payload)).resolves.toBe(
      0,
    );
  });

  it('moves a phone to whoever signs in on it', async () => {
    await build(undefined);

    await service.register(USER, 'tok-9');

    expect(tokenModel.updateOne).toHaveBeenCalledWith(
      { token: 'tok-9' },
      {
        $set: expect.objectContaining({
          userId: new Types.ObjectId(USER),
          platform: 'android',
        }) as unknown,
      },
      { upsert: true },
    );
  });

  it('fills missing preferences with "on"', async () => {
    await build(undefined);

    await expect(service.getPrefs(USER)).resolves.toEqual({
      messages: true,
      plans: false,
      connections: true,
    });
  });
});
