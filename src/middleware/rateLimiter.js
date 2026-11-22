/**
 * Rate limiters for auth-sensitive, abuse-prone endpoints.
 * Keys on IP + email (or user id) so one attacker cannot lock out a whole
 * shared/NAT IP, and a valid user is not blocked by someone else's attempts.
 */
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

const tooManyAttempts = (req, res) =>
  res.status(429).json({ message: 'Too many attempts. Please try again later.' });

/**
 * Key for OTP routes: one bucket per IP + identity.
 * Falls back to the posted email for unauthenticated routes; authenticated
 * routes key on the user id so one account's attempts cannot exhaust a
 * shared/NAT IP for everybody else.
 */
const ipAndEmailKey = (req) =>
  `${ipKeyGenerator(req.ip)}:${
    req.user?.id ? `user:${req.user.id}` : (req.body?.email || '').toLowerCase()
  }`;

/** Limits how many OTPs can be requested for a given email. */
export const otpRequestLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  keyGenerator: ipAndEmailKey,
  handler: tooManyAttempts,
});

/** Limits how many times a 6-digit OTP can be guessed/brute-forced. */
export const otpVerifyLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  keyGenerator: ipAndEmailKey,
  handler: tooManyAttempts,
});

/**
 * Limits authenticated actions (e.g. change-password).
 * Must be mounted after auth.authenticate so req.user is set.
 */
export const authedActionLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  keyGenerator: (req) => req.user.id,
  handler: tooManyAttempts,
});

/**
 * Key for login: one bucket per IP + posted username.
 * Keyed on the username (not a user id) since no session exists yet.
 * Trimmed the same way the login handler trims it, so "juan" and "juan "
 * cannot be used to get separate buckets for the same account.
 */
const ipAndUsernameKey = (req) =>
  `${ipKeyGenerator(req.ip)}:${String(
    req.body?.username || req.body?.email || ''
  ).trim().toLowerCase()}`;

/**
 * Limits password guessing / brute force on POST /login.
 *
 * Only *wrong credentials* (401) are counted. Successful logins, pending /
 * rejected accounts (403), missing profiles (404) and server errors (5xx) do
 * not consume the budget, and neither do the app's background re-auth calls
 * once they have succeeded. This is what stops a user who typed the correct
 * password from being told "Too many attempts".
 */
export const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  keyGenerator: ipAndUsernameKey,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  handler: tooManyAttempts,
});
