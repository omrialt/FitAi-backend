import { ForbiddenException } from '@nestjs/common';

import { AiReviewController } from './ai-review.controller';
import { AiReviewScheduler } from './ai-review.scheduler';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const as = (email: string) =>
  ({ user: { id: 'u1', email, role: 'user', roles: ['user'] } }) as AuthRequest;

const OWNER = as('omrialt@gmail.com');
const OTHER = as('demo.client@example.com');

describe('AiReviewController — owner-only access', () => {
  const fullStatus = {
    enabled: true,
    model: 'claude-haiku-5-5',
    lastError: 'transport',
    tokensUsed: 1234,
  };

  const build = () => {
    const reviews = {
      enabled: true,
      reviewUser: jest.fn().mockResolvedValue(true),
    };
    const anthropic = { status: fullStatus };
    const controller = new AiReviewController(
      reviews as never,
      anthropic as never,
    );
    return { controller, reviews };
  };

  it('gives the owner the full status', () => {
    expect(build().controller.status(OWNER)).toBe(fullStatus);
  });

  it('gives anyone else only enabled:false, with no diagnostics', () => {
    expect(build().controller.status(OTHER)).toEqual({ enabled: false });
  });

  it('refuses a manual review with 403 and never reaches the model', async () => {
    const { controller, reviews } = build();
    await expect(controller.reviewMe(OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reviews.reviewUser).not.toHaveBeenCalled();
  });

  it('lets the owner trigger a review', async () => {
    const { controller, reviews } = build();
    await expect(controller.reviewMe(OWNER)).resolves.toEqual({
      created: true,
    });
    expect(reviews.reviewUser).toHaveBeenCalledWith('u1');
  });
});

describe('AiReviewScheduler — owner-only access', () => {
  const users: Record<string, { email: string; isActive?: boolean }> = {
    a: { email: 'omrialt@gmail.com' },
    b: { email: 'demo.client@example.com' },
    c: { email: 'demo.trainer@example.com' },
  };

  it('reviews only allowlisted users out of everyone who trained', async () => {
    const reviews = {
      enabled: true,
      reviewUser: jest.fn().mockResolvedValue(true),
    };
    const sessionModel = {
      distinct: () => ({ exec: () => Promise.resolve(['a', 'b', 'c']) }),
    };
    const userModel = {
      findById: (id: string) => {
        const link = {
          select: () => link,
          lean: () => link,
          exec: () => Promise.resolve(users[id]),
        };
        return link;
      },
    };

    const scheduler = new AiReviewScheduler(
      reviews as never,
      sessionModel as never,
      userModel as never,
    );
    await scheduler.run();

    expect(reviews.reviewUser).toHaveBeenCalledTimes(1);
    expect(reviews.reviewUser).toHaveBeenCalledWith('a', 'omrialt@gmail.com');
  });
});
