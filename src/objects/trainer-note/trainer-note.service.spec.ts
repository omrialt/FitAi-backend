import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TrainerNoteService } from './trainer-note.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

const TRAINER = new Types.ObjectId().toString();
const OTHER_TRAINER = new Types.ObjectId().toString();
const CLIENT = new Types.ObjectId().toString();

function chain(value: unknown) {
  const c = { lean: () => c, exec: () => Promise.resolve(value) };
  return c;
}

describe('TrainerNoteService', () => {
  let service: TrainerNoteService;
  let noteModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let trainerAccess: { isAcceptedTrainerOf: jest.Mock };

  beforeEach(async () => {
    noteModel = {
      findOne: jest.fn().mockReturnValue(chain(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(chain({ body: 'saved' })),
    };
    trainerAccess = { isAcceptedTrainerOf: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerNoteService,
        { provide: getModelToken('TrainerNote'), useValue: noteModel },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(TrainerNoteService);
  });

  it('reads the note keyed on the caller, not on anything they sent', async () => {
    await service.get(TRAINER, CLIENT);

    const [filter] = noteModel.findOne.mock.calls[0] as [
      { trainerId: Types.ObjectId; clientId: Types.ObjectId },
    ];
    expect(String(filter.trainerId)).toBe(TRAINER);
    expect(String(filter.clientId)).toBe(CLIENT);
  });

  it('returns null rather than inventing an empty note', async () => {
    await expect(service.get(TRAINER, CLIENT)).resolves.toBeNull();
  });

  it('upserts, because the first save is also an edit', async () => {
    await service.save(TRAINER, CLIENT, 'knee rehab, 3 weeks');

    const [, update, options] = noteModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: { body: string } },
      { upsert: boolean },
    ];
    expect(update.$set.body).toBe('knee rehab, 3 weeks');
    expect(options.upsert).toBe(true);
  });

  /**
   * The property the whole collection exists for. A client asking for the note
   * about themselves is refused — they are not the trainer of the pair, and no
   * route hands them the other side of it either.
   */
  it('refuses a client reading the note written about them', async () => {
    trainerAccess.isAcceptedTrainerOf.mockImplementation(
      (trainerId: string, clientId: string) =>
        Promise.resolve(trainerId === TRAINER && clientId === CLIENT),
    );

    await expect(service.get(CLIENT, TRAINER)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.get(CLIENT, CLIENT)).rejects.toThrow(
      ForbiddenException,
    );
    expect(noteModel.findOne).not.toHaveBeenCalled();
  });

  it("refuses another trainer's notebook", async () => {
    trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);

    await expect(service.get(OTHER_TRAINER, CLIENT)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.save(OTHER_TRAINER, CLIENT, 'prying')).rejects.toThrow(
      ForbiddenException,
    );
    expect(noteModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses once the connection ends, and never writes', async () => {
    trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);

    await expect(
      service.save(TRAINER, CLIENT, 'still coaching?'),
    ).rejects.toThrow(ForbiddenException);
    expect(noteModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a malformed id before it reaches Mongo', async () => {
    await expect(service.get(TRAINER, 'not-an-id')).rejects.toThrow(
      ForbiddenException,
    );
    expect(trainerAccess.isAcceptedTrainerOf).not.toHaveBeenCalled();
  });
});
