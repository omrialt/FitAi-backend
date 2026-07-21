/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Inject, Injectable } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { NODEMAILER_TRANSPORT } from './nodemailer.provider';

@Injectable()
export class NodemailerService {
  constructor(
    @Inject(NODEMAILER_TRANSPORT)
    private readonly transporter: Transporter,
  ) {}

  /**
   * Send a password reset email
   * @param email Recipient's email address
   * @param token Password reset token
   */
  async sendResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Reset your password',
      html: `<p>You requested a password reset.</p>
             <p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
             <p>If you did not request this, please ignore this email.</p>`,
    };

    await this.transporter.sendMail(mailOptions);
  }
}
