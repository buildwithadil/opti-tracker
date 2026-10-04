import { z } from 'zod'
import { normalizeIndianMobile } from '../../shared/phone'

export const customerSchema = z.object({
  name: z.string()
    .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), 'The name must not contain control characters.')
    .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
    .pipe(z.string().min(1, 'Enter the full name.').max(200, 'Use at most 200 characters for the name.')),
  phone: z.string().max(32, 'Use at most 32 characters for the mobile number.')
    .transform((value, context) => {
      try {
        return normalizeIndianMobile(value)
      } catch (error) {
        context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Enter a valid Indian mobile number.' })
        return z.NEVER
      }
    }),
}).strict()

export type CustomerFormValues = z.input<typeof customerSchema>
