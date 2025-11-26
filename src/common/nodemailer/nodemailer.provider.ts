/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Provider } from '@nestjs/common';

export const NODEMAILER_TRANSPORT = 'NODEMAILER_TRANSPORT';

export const nodemailerProvider: Provider = {
  provide: NODEMAILER_TRANSPORT,
  useFactory: (): Transporter => {
    return nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  },
};