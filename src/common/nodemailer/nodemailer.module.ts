import { Module } from '@nestjs/common';
import { nodemailerProvider } from './nodemailer.provider';
import { NodemailerService } from './nodemailer.service';

@Module({
  providers: [nodemailerProvider, NodemailerService],
  exports: [NodemailerService],
})
export class NodemailerModule {}
