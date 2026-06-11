import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.MAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendOtp(toEmail, otp) {
  await transporter.sendMail({
    from:    process.env.MAIL_FROM || 'Tourism App',
    to:      toEmail,
    subject: 'Your OTP Code',
    html: `
      <h2>Your One-Time Password</h2>
      <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
      <h1 style="letter-spacing: 8px;">${otp}</h1>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  });
}

export default { sendOtp };