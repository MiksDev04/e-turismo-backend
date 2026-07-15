import { BrevoClient } from '@getbrevo/brevo';

const hasBrevoConfig = !!process.env.BREVO_API_KEY;

const brevoClient = hasBrevoConfig ? new BrevoClient({ apiKey: process.env.BREVO_API_KEY }) : null;

if (!hasBrevoConfig) {
  console.warn('BREVO_API_KEY not set. Emails will be skipped.');
} else {
  console.log('Brevo mailer configured.');
}

const defaultSender = {
  email: process.env.BREVO_FROM_EMAIL || process.env.MAIL_USER || 'noreply@example.com',
  name:  process.env.BREVO_FROM_NAME || 'San Pablo City Tourism Office',
};

async function sendOtp(toEmail, otp) {
  if (!brevoClient) {
    throw new Error('Email service not configured (BREVO_API_KEY missing)');
  }
  try {
    await brevoClient.transactionalEmails.sendTransacEmail({
      htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>OTP Verification</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;">

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
          <tr>
            <td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

                <tr>
                  <td style="background-color:#0077b6;padding:28px 40px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#cce7f5;letter-spacing:1.5px;text-transform:uppercase;">
                      Official Communication
                    </p>
                    <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">
                      San Pablo City Tourism Office
                    </h1>
                    <p style="margin:4px 0 0;color:#90cde8;font-size:13px;">
                      Tourism Record Management System
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:36px 40px 28px;">
                    <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">
                      Verification Code Request
                    </h2>
                    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
                      We received a request to verify your identity on the
                      <strong>San Pablo City Tourism Record Management System</strong>.
                      Use the one-time password below to proceed.
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding:20px 0;">
                          <div style="display:inline-block;background-color:#f0f8ff;border:2px dashed #0077b6;border-radius:8px;padding:16px 40px;">
                            <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">
                              Your OTP Code
                            </p>
                            <p style="margin:0;font-size:36px;font-weight:700;letter-spacing:12px;color:#0077b6;">
                              ${otp}
                            </p>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0 0 8px;font-size:13px;color:#e05c00;font-weight:600;text-align:center;">
                      This code expires in <strong>10 minutes</strong>.
                    </p>
                    <p style="margin:16px 0 0;font-size:13px;color:#888;line-height:1.6;text-align:center;">
                      If you did not request this code, you can safely ignore this email.<br/>
                      Do not share this code with anyone.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 40px;">
                    <hr style="border:none;border-top:1px solid #eee;margin:0;"/>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 40px 28px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.8;">
                      This is an automated message from the<br/>
                      <strong style="color:#555;">San Pablo City Tourism Office</strong><br/>
                      San Pablo City, Laguna, Philippines<br/>
                      Please do not reply to this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

      </body>
      </html>
    `,
      sender:  defaultSender,
      subject: 'Your Verification Code – San Pablo City Tourism Office',
      to:      [{ email: toEmail }],
    });
    console.log(`[MAIL] OTP sent successfully to ${toEmail}`);
  } catch (err) {
    console.error(`[MAIL ERROR] Failed to send OTP to ${toEmail}:`, err.response?.body || err.message);
    throw err;
  }
}

async function sendSystemMessage(toEmail, subject, content, messageType = 'general') {
  if (!brevoClient) {
    throw new Error('Email service not configured (BREVO_API_KEY missing)');
  }
  const typeLabel = messageType.charAt(0).toUpperCase() + messageType.slice(1);

  try {
    await brevoClient.transactionalEmails.sendTransacEmail({
      htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>New Message</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
          <tr>
            <td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                <tr>
                  <td style="background-color:#0077b6;padding:28px 40px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#cce7f5;letter-spacing:1.5px;text-transform:uppercase;">
                      ${typeLabel} Notice
                    </p>
                    <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">
                      San Pablo City Tourism Office
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 20px 28px;">
                    <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">
                      ${subject}
                    </h2>
                    <div style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;white-space: pre-wrap;">
                      ${content}
                    </div>

                  </td>
                </tr>
                <tr>
                  <td style="padding:0 40px;">
                    <hr style="border:none;border-top:1px solid #eee;margin:0;"/>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 40px 28px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.8;">
                      This is an automated notification from the<br/>
                      <strong style="color:#555;">San Pablo City Tourism Office</strong><br/>
                      San Pablo City, Laguna, Philippines
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
      sender:  defaultSender,
      subject: `${subject} – San Pablo City Tourism Office`,
      to:      [{ email: toEmail }],
    });
    console.log(`[MAIL] System message sent to ${toEmail}`);
  } catch (err) {
    console.error(`[MAIL ERROR] Failed to send system message to ${toEmail}:`, err.response?.body || err.message);
    throw err;
  }
}

async function sendEmailConfirmation(toEmail, confirmationUrl, options = {}) {
  if (!brevoClient) {
    throw new Error('Email service not configured (BREVO_API_KEY missing)');
  }

  const subject = options.subject || 'Confirm Your Email – San Pablo City Tourism Office';
  const label = options.label || 'Email Change Request';
  const heading = options.heading || 'Confirm Your New Email Address';
  const body = options.body || 'You recently requested to change the email address associated with your <strong>San Pablo City Tourism Record Management System</strong> account. Click the button below to confirm this email address.';
  const buttonLabel = options.buttonLabel || 'Confirm Email Address';

  try {
    await brevoClient.transactionalEmails.sendTransacEmail({
      htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>${heading}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;">

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
          <tr>
            <td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

                <tr>
                  <td style="background-color:#0077b6;padding:28px 40px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#cce7f5;letter-spacing:1.5px;text-transform:uppercase;">
                      ${label}
                    </p>
                    <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">
                      San Pablo City Tourism Office
                    </h1>
                    <p style="margin:4px 0 0;color:#90cde8;font-size:13px;">
                      Tourism Record Management System
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:36px 40px 28px;">
                    <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">
                      ${heading}
                    </h2>
                    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
                      ${body}
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding:20px 0;">
                          <a href="${confirmationUrl}"
                             style="display:inline-block;background-color:#0077b6;color:#ffffff;
                                    text-decoration:none;padding:14px 36px;border-radius:6px;
                                    font-size:16px;font-weight:700;letter-spacing:0.5px;">
                            ${buttonLabel}
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:16px 0 0;font-size:13px;color:#888;line-height:1.6;text-align:center;">
                      If the button above does not work, copy and paste this link into your browser:<br/>
                      <a href="${confirmationUrl}" style="color:#0077b6;word-break:break-all;">${confirmationUrl}</a>
                    </p>

                    <p style="margin:16px 0 0;font-size:13px;color:#e05c00;font-weight:600;text-align:center;">
                      This link expires in <strong>24 hours</strong>.
                    </p>
                    <p style="margin:16px 0 0;font-size:13px;color:#888;line-height:1.6;text-align:center;">
                      If you did not request this, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 40px;">
                    <hr style="border:none;border-top:1px solid #eee;margin:0;"/>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 40px 28px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.8;">
                      This is an automated message from the<br/>
                      <strong style="color:#555;">San Pablo City Tourism Office</strong><br/>
                      San Pablo City, Laguna, Philippines<br/>
                      Please do not reply to this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

      </body>
      </html>
    `,
      sender:  defaultSender,
      subject,
      to:      [{ email: toEmail }],
    });
    console.log(`[MAIL] Confirmation email sent to ${toEmail}`);
  } catch (err) {
    console.error(`[MAIL ERROR] Failed to send confirmation email to ${toEmail}:`, err.response?.body || err.message);
    throw err;
  }
}

export default { sendOtp, sendSystemMessage, sendEmailConfirmation };
