import { ForbiddenException } from '@nestjs/common';

import { AiCoachController } from './ai-coach.controller';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import type {
  CoachChatDto,
  GeneratePlanDto,
} from '../../interfaces/ai-coach.interfaces';

const as = (email: string) =>
  ({ user: { id: 'u1', email, role: 'user', roles: ['user'] } }) as AuthRequest;

const OWNER = as('omrialt@gmail.com');
const OTHER = as('demo.client@example.com');

describe('AiCoachController — owner-only access', () => {
  const build = (enabled = true) => {
    const chat = {
      enabled,
      ask: jest.fn().mockResolvedValue({ answer: { text: 'ok' } }),
    };
    const generator = {
      enabled,
      generate: jest
        .fn()
        .mockResolvedValue({ plan: { title: 'p' }, droppedSlugs: [] }),
    };
    const plans = { create: jest.fn().mockResolvedValue({ _id: 'p1' }) };
    const controller = new AiCoachController(
      chat as never,
      generator as never,
      plans as never,
    );
    return { controller, chat, generator, plans };
  };

  it('reports both features on for the owner and off for anyone else', () => {
    const { controller } = build();
    expect(controller.status(OWNER)).toEqual({
      chat: true,
      planGeneration: true,
    });
    expect(controller.status(OTHER)).toEqual({
      chat: false,
      planGeneration: false,
    });
  });

  it('still reports off for the owner when no key is configured', () => {
    const { controller } = build(false);
    expect(controller.status(OWNER)).toEqual({
      chat: false,
      planGeneration: false,
    });
  });

  it('refuses chat with 403 and never reaches the model', async () => {
    const { controller, chat } = build();
    await expect(
      controller.ask({ question: 'hi' } as CoachChatDto, OTHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(chat.ask).not.toHaveBeenCalled();
  });

  it('refuses plan generation with 403 and saves nothing', async () => {
    const { controller, generator, plans } = build();
    await expect(
      controller.generatePlan({} as GeneratePlanDto, OTHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(plans.create).not.toHaveBeenCalled();
  });

  it('lets the owner through to both', async () => {
    const { controller, chat, generator } = build();
    await controller.ask({ question: 'hi' } as CoachChatDto, OWNER);
    await controller.generatePlan({} as GeneratePlanDto, OWNER);
    expect(chat.ask).toHaveBeenCalledTimes(1);
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });
});
