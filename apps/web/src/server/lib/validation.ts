import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});

export const registerSchema = z.object({
  name: z.string().min(1, 'Name required'),
  username: z.string().min(2, 'Username must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['TEAM_MEMBER', 'CLIENT']).optional(),
});

export const forgotPasswordSchema = z.object({
  /** Email address, username or employee ID */
  email: z.string().trim().min(1, 'Enter your email address or employee ID'),
});

const STRONG_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = 'The password must be at least 8 characters and contain both letters and numbers.';

export const changePasswordSchema = z
  .object({
    current_password: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.'),
    password: z.string({ error: PASSWORD_MESSAGE }).regex(STRONG_PASSWORD, PASSWORD_MESSAGE),
    password_confirmation: z.string({ error: 'The password confirmation does not match.' }),
  })
  .superRefine((data, ctx) => {
    if (data.password === data.current_password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'The new password must be different from your current password.' });
    }
    if (data.password_confirmation !== data.password) {
      ctx.addIssue({ code: 'custom', path: ['password_confirmation'], message: 'The password confirmation does not match.' });
    }
  });

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({ message: msg });
    }
    req.body = result.data;
    next();
  };
}
