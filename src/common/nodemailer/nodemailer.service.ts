import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { NODEMAILER_TRANSPORT } from './nodemailer.provider';

/**
 * Transactional email.
 *
 * This used to send exactly one message — password reset — which left the
 * product with no way to prove an address belongs to the person who typed it,
 * and no way to tell a client that a trainer had invited them. The templates
 * below share one shell so the wording stays consistent and a change to the
 * frame is a single edit.
 */
@Injectable()
export class NodemailerService {
  private readonly logger = new Logger(NodemailerService.name);

  constructor(
    @Inject(NODEMAILER_TRANSPORT)
    private readonly transporter: Transporter,
  ) {}

  /** Send a password reset email. */
  async sendResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = this.frontendLink('/reset-password', { token });

    await this.send({
      to: email,
      subject: 'Reset your FitAi password',
      html: this.shell(
        'Reset your password',
        `<p>You asked to reset your FitAi password.</p>
         ${this.button(resetUrl, 'Choose a new password')}
         <p>The link is valid for one hour. If you did not ask for this, ignore this email — nothing has changed.</p>`,
      ),
    });
  }

  /**
   * Confirm ownership of an address. Sent on registration and again on
   * request, so a link that expired or never arrived is recoverable without
   * support.
   */
  async sendVerificationEmail(
    email: string,
    token: string,
    fullName?: string,
  ): Promise<void> {
    const verifyUrl = this.frontendLink('/verify-email', { token });

    await this.send({
      to: email,
      subject: 'Confirm your FitAi email address',
      html: this.shell(
        `Welcome${fullName ? `, ${this.escape(fullName)}` : ''}`,
        `<p>Confirm this address to finish setting up your FitAi account.</p>
         ${this.button(verifyUrl, 'Confirm my email')}
         <p>The link is valid for 24 hours. If you did not create a FitAi account, ignore this email.</p>`,
      ),
    });
  }

  /** Sent once, right after the address is confirmed. */
  async sendWelcomeEmail(email: string, fullName?: string): Promise<void> {
    await this.send({
      to: email,
      subject: 'Your FitAi account is ready',
      html: this.shell(
        `You're all set${fullName ? `, ${this.escape(fullName)}` : ''}`,
        `<p>Your email is confirmed. From here you can build a training plan, log measurements and follow your progress over time.</p>
         ${this.button(this.frontendLink('/'), 'Open FitAi')}`,
      ),
    });
  }

  /**
   * Tell a client that a trainer invited them. Without it the invite is only
   * discoverable by a badge inside the app, which the client has no reason to
   * open.
   */
  async sendTrainerInviteEmail(
    email: string,
    trainerName: string,
    clientName?: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `${trainerName} invited you to connect on FitAi`,
      html: this.shell(
        'A trainer wants to connect',
        `<p>Hi${clientName ? ` ${this.escape(clientName)}` : ''}, <strong>${this.escape(trainerName)}</strong> invited you to connect on FitAi.</p>
         <p>Accepting lets them see your training plans, measurements and progress so they can coach you. You can end the connection at any time.</p>
         ${this.button(this.frontendLink('/profile'), 'Review the invitation')}`,
      ),
    });
  }

  // ─── internals ────────────────────────────────────────────────

  private async send(options: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      ...options,
    });
    this.logger.debug(`Sent "${options.subject}"`);
  }

  private frontendLink(
    path: string,
    query: Record<string, string> = {},
  ): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    const search = new URLSearchParams(query).toString();
    return `${base}${path}${search ? `?${search}` : ''}`;
  }

  private button(href: string, label: string): string {
    return `<p style="margin:24px 0">
      <a href="${href}" style="background:#4338CA;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">${label}</a>
    </p>
    <p style="font-size:12px;color:#6b7280">Or paste this into your browser:<br>${href}</p>`;
  }

  private shell(heading: string, body: string): string {
    return `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#15161C;line-height:1.6;max-width:560px">
      <h2 style="margin:0 0 16px;font-size:20px">${heading}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #D6D8E1;margin:28px 0">
      <p style="font-size:12px;color:#7C8091">FitAi — training, nutrition and progress in one place.</p>
    </div>`;
  }

  /** User-supplied names land inside HTML; escape them rather than trust them. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
