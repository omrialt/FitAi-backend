import { FoodController } from './food.controller';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import type { ParseFoodDto } from '../../interfaces/food.interfaces';

const as = (email: string) =>
  ({ user: { id: 'u1', email, role: 'user', roles: ['user'] } }) as AuthRequest;

const OWNER = as('omrialt@gmail.com');
const OTHER = as('demo.client@example.com');

describe('FoodController — owner-only parsing', () => {
  const build = () => {
    const foods = {
      searchAvailable: true,
      parseAvailable: true,
      parse: jest.fn().mockResolvedValue({ items: [{}], available: true }),
    };
    return { controller: new FoodController(foods as never), foods };
  };

  it('keeps search open to everyone and parse to the owner only', () => {
    const { controller } = build();
    expect(controller.status(OWNER)).toEqual({ search: true, parse: true });
    expect(controller.status(OTHER)).toEqual({ search: true, parse: false });
  });

  it('answers anyone else as "not available" without a model call', async () => {
    const { controller, foods } = build();
    await expect(
      Promise.resolve(
        controller.parse({ text: 'eggs' } as ParseFoodDto, OTHER),
      ),
    ).resolves.toEqual({ items: [], available: false });
    expect(foods.parse).not.toHaveBeenCalled();
  });

  it('parses for the owner', async () => {
    const { controller, foods } = build();
    await controller.parse({ text: 'eggs' } as ParseFoodDto, OWNER);
    expect(foods.parse).toHaveBeenCalledWith('eggs');
  });
});
