import { Test, TestingModule } from '@nestjs/testing';

import { AlertService } from './alert.service';
import { NodemailerService } from '../nodemailer/nodemailer.service';

describe('AlertService', () => {
  let service: AlertService;
  let mailer: { sendOperationalAlert: jest.Mock };

  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    mailer = { sendOperationalAlert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        { provide: NodemailerService, useValue: mailer },
      ],
    }).compile();

    service = module.get(AlertService);
    process.env.ALERT_EMAIL = 'ops@example.com';
    process.env.ALERT_COOLDOWN_MS = '60000';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const alert = (fingerprint = 'test:one') => ({
    fingerprint,
    subject: 'Something broke',
    detail: { path: '/x' },
  });

  it('emails the configured recipient', async () => {
    await service.raise(alert());

    expect(mailer.sendOperationalAlert).toHaveBeenCalledWith(
      'ops@example.com',
      'Something broke',
      { path: '/x' },
    );
  });

  it('does nothing but log when no recipient is configured', async () => {
    delete process.env.ALERT_EMAIL;

    await service.raise(alert());

    expect(mailer.sendOperationalAlert).not.toHaveBeenCalled();
  });

  // A bad deploy can throw the same error thousands of times a minute. One
  // mail about it is useful; a thousand is an outage of its own.
  it('suppresses a repeat of the same alert within the cooldown', async () => {
    await service.raise(alert());
    await service.raise(alert());
    await service.raise(alert());

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(1);
  });

  it('still sends a different alert during another alert cooldown', async () => {
    await service.raise(alert('test:one'));
    await service.raise(alert('test:two'));

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(2);
  });

  it('sends again once the cooldown has elapsed', async () => {
    process.env.ALERT_COOLDOWN_MS = '10';

    await service.raise(alert());
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.raise(alert());

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(2);
  });

  // Alerting runs inside the error path. If it throws, it replaces the
  // original failure with its own — the worst possible time to add a bug.
  it('never throws when delivery fails', async () => {
    mailer.sendOperationalAlert.mockRejectedValue(new Error('smtp down'));

    await expect(service.raise(alert())).resolves.toBeUndefined();
  });
});
