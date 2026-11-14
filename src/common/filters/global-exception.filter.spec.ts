import {
  ArgumentsHost,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * The filter is the only thing between a thrown exception and the client, so
 * anything it does not copy across simply does not exist as far as the
 * frontend is concerned.
 */
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
  });

  /** The body the filter wrote. */
  const body = (): Record<string, unknown> => {
    const calls = json.mock.calls as Record<string, unknown>[][];
    return calls[0][0];
  };

  // The regression this guards: login answers an unverified account with
  // code EMAIL_NOT_VERIFIED so the client can offer "resend" rather than
  // "wrong password". The filter used to copy only `message` and `error`, so
  // the code was dropped and the client had nothing to branch on but an
  // English string that translation is free to change.
  it('passes a machine-readable code through to the client', () => {
    filter.catch(
      new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before signing in',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(body()).toMatchObject({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address before signing in',
    });
  });

  it('omits the code entirely when the exception carries none', () => {
    filter.catch(new NotFoundException('Plan not found'), host);

    expect(body()).not.toHaveProperty('code');
    expect(body()).toMatchObject({
      statusCode: 404,
      message: 'Plan not found',
    });
  });

  // SEC-07: an unexpected error's message is internal and stays in the log.
  it('reports an unknown error as a generic 500', () => {
    filter.catch(new Error('Cast to ObjectId failed at /var/task/x'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({
      message: 'Internal server error',
      details: null,
    });
    expect(JSON.stringify(body())).not.toContain('ObjectId');
  });

  it('keeps the message of a deliberate 5xx HttpException', () => {
    filter.catch(new ServiceUnavailableException('AI is not configured'), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(body()).toMatchObject({ message: 'AI is not configured' });
  });
});
