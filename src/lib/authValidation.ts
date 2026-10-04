import { z } from 'zod'

export const newPasswordSchema = z.string()
  .min(12, 'Use at least 12 characters.')
  .max(256, 'Use no more than 256 characters.')
