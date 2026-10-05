import { z } from 'zod'
import { purchaseCreateSchema, purchaseItemSchema } from '../../shared/purchaseValidation'

const item = z.object({
  ...purchaseItemSchema.shape,
  quantity: z.string().regex(/^[1-9][0-9]*$/u, 'Use a positive whole-number quantity.').transform(Number),
}).strict()
export const purchaseFormSchema = z.object({
  ...purchaseCreateSchema.shape,
  prescription_uuid: z.string().transform(value => value || null),
  items: z.array(item).min(1, 'Add at least one purchase item.').max(100, 'A purchase may contain at most 100 items.'),
}).strict().transform((value, context) => {
  const result = purchaseCreateSchema.safeParse(value)
  if (result.success) return result.data
  result.error.issues.forEach(issue => context.addIssue({ code: 'custom', path: issue.path, message: issue.message }))
  return z.NEVER
})
export type PurchaseFormValues = z.input<typeof purchaseFormSchema>
export type PurchaseSaveValues = z.output<typeof purchaseFormSchema>
