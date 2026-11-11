import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { RootController } from './root.controller';

describe('RootController', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RootController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers GET / instead of a 404 that reads as an outage', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.body).toEqual({
      name: 'FitAi API',
      status: 'running',
      health: '/health',
    });
  });

  it('leaves unknown paths as 404', async () => {
    await request(app.getHttpServer()).get('/no-such-path').expect(404);
  });
});
