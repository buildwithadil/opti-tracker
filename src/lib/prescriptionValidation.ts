import { z } from 'zod'
import { prescriptionCreateSchema, prescriptionFieldsSchema, prescriptionRevisionSchema } from '../../shared/prescriptionValidation'

// The same form renders creation and replacement. The reason is absent for
// creation and present for revision; every clinical rule comes from the shared
// server schemas, including exact decimals and the date relationship.
export const prescriptionFormSchema = prescriptionFieldsSchema.extend({ revision_reason: z.string().optional() })
  .superRefine((input, context) => {
    const { revision_reason, ...fields } = input
    const result = revision_reason === undefined
      ? prescriptionCreateSchema.safeParse(fields)
      : prescriptionRevisionSchema.safeParse(input)
    if (!result.success) result.error.issues.forEach(issue => context.addIssue({ code: 'custom', path: issue.path, message: issue.message }))
  })

export type PrescriptionFormValues = z.input<typeof prescriptionFormSchema>
export type PrescriptionSaveValues = z.output<typeof prescriptionFormSchema>
