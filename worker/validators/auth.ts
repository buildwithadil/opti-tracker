import { z } from 'zod'

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(12, 'Use a passphrase of at least 12 characters.').max(256)
export const setupSchema = z.object({
  name: z.string().trim().min(2).max(200), email, password,
  setupToken: z.string().min(16).max(256),
}).strict()
export const loginSchema = z.object({ email, password: z.string().min(1).max(256) }).strict()
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: password }).strict()
