import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainerNoteSchema } from './trainer-note.schema';
import { TrainerNoteService } from './trainer-note.service';
import { TrainerNoteController } from './trainer-note.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'TrainerNote', schema: TrainerNoteSchema },
    ]),
  ],
  controllers: [TrainerNoteController],
  providers: [TrainerNoteService],
  exports: [TrainerNoteService],
})
export class TrainerNoteModule {}
