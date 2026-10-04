import { useCallback, useEffect, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import type { Customer } from '../../shared/customers'
import type { Prescription } from '../../shared/prescriptions'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { prescriptionFormSchema, type PrescriptionFormValues, type PrescriptionSaveValues } from '../lib/prescriptionValidation'
import { prescriptionErrorMessage, prescriptionFieldErrors, prescriptionKeys, prescriptionsApi, type PrescriptionFieldName } from '../lib/prescriptions'

export function PrescriptionCreatePage() {
  return <PrescriptionFormRoute revision={false} />
}

export function PrescriptionRevisePage() {
  return <PrescriptionFormRoute revision />
}

function PrescriptionFormRoute({ revision }: { revision: boolean }) {
  const { uuid = '', prescriptionUuid = '' } = useParams()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const prescription = useQuery({
    queryKey: prescriptionKeys.detail(uuid, prescriptionUuid),
    queryFn: ({ signal }) => prescriptionsApi.detail(uuid, prescriptionUuid, signal),
    enabled: revision && customer.isSuccess,
    retry: false,
  })
  const backPath = revision ? `/customers/${uuid}/prescriptions/${prescriptionUuid}` : `/customers/${uuid}`
  const backLink = <Link to={backPath} className="text-sm font-medium text-ink underline underline-offset-4">{revision ? 'Back to prescription' : 'Back to customer'}</Link>
  if (customer.isPending || (revision && customer.isSuccess && prescription.isPending)) return <LoadingState label="Loading prescription form…" />
  if (customer.isError) return <div className="space-y-5"><Link to="/customers" className="text-sm font-medium text-ink underline underline-offset-4">Back to customers</Link><ErrorState title={customer.error instanceof ApiError && customer.error.status === 404 ? 'Customer not found' : 'Customer could not be loaded'} description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} /></div>
  if (revision && prescription.isError) return <div className="space-y-5"><Link to={`/customers/${uuid}`} className="text-sm font-medium text-ink underline underline-offset-4">Back to customer</Link><ErrorState title={prescription.error instanceof ApiError && prescription.error.status === 404 ? 'Prescription not found' : 'Prescription could not be loaded'} description={prescriptionErrorMessage(prescription.error)} onRetry={() => void prescription.refetch()} /></div>
  if (customer.data.archived_at || (revision && prescription.data?.status !== 'current') || (revision && prescription.data?.prescription_type !== 'spectacle')) {
    const description = customer.data.archived_at
      ? 'This customer is archived. History remains readable, but you must restore the customer before adding or revising prescriptions.'
      : prescription.data?.prescription_type !== 'spectacle'
        ? 'This legacy prescription is readable, but only spectacle prescriptions can be revised in this phase.'
        : 'Only a current prescription can be revised. Previous and archived versions are preserved as read-only history.'
    return <div className="space-y-5">{backLink}<PageHeader eyebrow="Prescription management" title={revision ? 'Prescription cannot be revised' : 'Prescription cannot be added'} description={description} /></div>
  }
  return <PrescriptionForm key={`${uuid}:${revision ? prescriptionUuid : 'new'}`} customer={customer.data} prescription={revision ? prescription.data : undefined} />
}

function localToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function defaultValues(prescription?: Prescription): PrescriptionFormValues {
  return {
    prescribed_on: prescription ? prescription.prescribed_on ?? '' : localToday(),
    expires_on: prescription?.expires_on ?? '',
    right_sphere: prescription?.right_sphere ?? '', right_cylinder: prescription?.right_cylinder ?? '',
    right_axis: prescription?.right_axis ?? '', right_addition: prescription?.right_addition ?? '',
    left_sphere: prescription?.left_sphere ?? '', left_cylinder: prescription?.left_cylinder ?? '',
    left_axis: prescription?.left_axis ?? '', left_addition: prescription?.left_addition ?? '',
    distance_pd: prescription?.distance_pd ?? '', near_pd: prescription?.near_pd ?? '',
    right_pd: prescription?.right_pd ?? '', left_pd: prescription?.left_pd ?? '',
    prescriber_name: prescription?.prescriber_name ?? '', notes: prescription?.notes ?? '',
    ...(prescription ? { revision_reason: '' } : {}),
  }
}

function PrescriptionForm({ customer, prescription }: { customer: Customer; prescription?: Prescription }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submissionLock = useRef(false)
  const saved = useRef(false)
  const errorFocus = useRef<PrescriptionFieldName | null>(null)
  const form = useForm<PrescriptionFormValues, unknown, PrescriptionSaveValues>({
    resolver: zodResolver(prescriptionFormSchema), defaultValues: defaultValues(prescription),
  })
  const savePrescription = useMutation({
    mutationFn: (values: PrescriptionSaveValues) => {
      const { revision_reason, ...fields } = values
      return prescription
        ? prescriptionsApi.revise(customer.uuid, prescription.uuid, { ...fields, revision_reason: revision_reason ?? '' })
        : prescriptionsApi.create(customer.uuid, fields)
    },
    onSuccess: async result => {
      // Refresh inactive old details/history too: a cached previous version must
      // show its derived superseded status as soon as the replacement is saved.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prescriptionKeys.customer(customer.uuid), refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: customerKeys.detail(customer.uuid) }),
      ])
      // Seed the new detail after invalidation, so an unmounted new query is
      // never refetched before it has a registered query function.
      queryClient.setQueryData(prescriptionKeys.detail(customer.uuid, result.uuid), result)
      saved.current = true
      form.reset({ ...defaultValues(result), revision_reason: prescription ? '' : undefined })
      navigate(`/customers/${customer.uuid}/prescriptions/${result.uuid}`, { replace: true, state: { prescriptionNotice: prescription ? 'Revision saved. The previous version and its original values are preserved.' : 'Prescription saved.' } })
    },
    onError: error => {
      const errors = prescriptionFieldErrors(error)
      errors.forEach(({ field, message }) => form.setError(field, { type: 'server', message }))
      errorFocus.current = errors[0]?.field ?? null
    },
  })
  const pending = form.formState.isSubmitting || savePrescription.isPending
  // Server errors arrive while inputs are disabled. Defer focus until the
  // mutation and RHF finish, matching the Phase 2 customer form convention.
  useEffect(() => {
    if (!pending && errorFocus.current) {
      form.setFocus(errorFocus.current)
      errorFocus.current = null
    }
  }, [pending, savePrescription.error, form])
  const shouldWarn = form.formState.isDirty || pending
  const blocker = useBlocker(() => !saved.current && shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!saved.current && shouldWarn) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [shouldWarn]))
  const errors = form.formState.errors
  const cancelPath = prescription ? `/customers/${customer.uuid}/prescriptions/${prescription.uuid}` : `/customers/${customer.uuid}`
  const input = (name: PrescriptionFieldName, label: string, options: { type?: 'text' | 'date'; inputMode?: 'text' | 'decimal' | 'numeric'; hint?: string; maxLength?: number; required?: boolean } = {}) => {
    const id = `prescription-${name}`
    return <Field key={name} id={id} label={label} error={errors[name]?.message} hint={options.hint}>
      <TextInput id={id} type={options.type ?? 'text'} inputMode={options.inputMode} maxLength={options.maxLength} autoComplete="off" aria-required={options.required || undefined} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${id}-error` : options.hint ? `${id}-hint` : undefined} {...form.register(name)} />
    </Field>
  }

  return (
    <div className="space-y-7 [overflow-wrap:anywhere]">
      <Link to={cancelPath} className="text-sm font-medium text-ink underline underline-offset-4">{prescription ? 'Back to prescription' : 'Back to customer'}</Link>
      <PageHeader eyebrow={`Prescription · ${customer.name}`} title={prescription ? 'Revise prescription' : 'Add prescription'} description={prescription ? `Create a replacement for version ${prescription.revision_number}. The previous values remain unchanged and available in history.` : 'Transcribe a supplied spectacle prescription. Leave unknown measurements blank; nothing is calculated or inferred.'} />
      <Card className="max-w-4xl">
        <CardHeader><CardTitle>{prescription ? 'Replacement prescription' : 'New spectacle prescription'}</CardTitle></CardHeader>
        <CardContent>
          {prescription ? <p className="mb-5 rounded-md border border-line bg-paper p-3 text-sm leading-6 text-muted">Saving a revision creates a new version, not an edit to this record. Enter a reason for the replacement. Legacy incomplete or noncanonical values must be transcribed into valid fields before saving.</p> : null}
          <form className="space-y-6" noValidate aria-label={prescription ? 'Revise prescription' : 'New prescription'} onSubmit={event => {
            void form.handleSubmit(async values => {
              if (submissionLock.current) return
              submissionLock.current = true
              savePrescription.reset()
              try { await savePrescription.mutateAsync(values) }
              catch { /* Retain values, field errors, and the server alert for correction. */ }
              finally { submissionLock.current = false }
            })(event)
          }}>
            <fieldset disabled={pending} className="space-y-6 disabled:opacity-70">
              <legend className="sr-only">Prescription values for {customer.name}</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                {input('prescribed_on', 'Prescription date', { type: 'date', required: true, hint: 'Required. Use the date on the supplied prescription.' })}
                {input('expires_on', 'Expiry / recheck date', { type: 'date', hint: 'Optional. Leave blank if not supplied.' })}
              </div>
              <p className="text-sm leading-6 text-muted">OD is the right eye; OS is the left eye. SPH, CYL and ADD are signed diopters (D). Copy plus or minus exactly. AXIS is optional, in degrees (0–180). Blank means unknown, not zero.</p>
              <div className="grid gap-6 md:grid-cols-2">
                {(['right', 'left'] as const).map(eye => {
                  const label = eye === 'right' ? 'Right' : 'Left'
                  return <fieldset key={eye} className="min-w-0 rounded-md border border-line p-4">
                    <legend className="px-1 text-sm font-semibold text-ink">{label} eye ({eye === 'right' ? 'OD' : 'OS'})</legend>
                    <div className="grid gap-5 sm:grid-cols-2">
                      {input(`${eye}_sphere`, `${label} SPH (D)`, { inputMode: 'text', hint: 'Signed value, e.g. -1.25 or +0.50.' })}
                      {input(`${eye}_cylinder`, `${label} CYL (D)`, { inputMode: 'text', hint: 'Optional signed value.' })}
                      {input(`${eye}_axis`, `${label} AXIS (°)`, { inputMode: 'numeric', hint: 'Optional whole number, 0–180.' })}
                      {input(`${eye}_addition`, `${label} ADD (D)`, { inputMode: 'text', hint: 'Optional signed value.' })}
                    </div>
                  </fieldset>
                })}
              </div>
              <fieldset className="rounded-md border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink">Pupillary distance (PD)</legend>
                <p className="mb-5 text-sm leading-6 text-muted">Optional dispensing measurements in millimetres. Enter only supplied values; total, near and monocular PDs are not calculated from each other.</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {input('distance_pd', 'Distance PD (mm)', { inputMode: 'decimal', hint: 'Optional positive measurement.' })}
                  {input('near_pd', 'Near PD (mm)', { inputMode: 'decimal', hint: 'Optional positive measurement.' })}
                  {input('right_pd', 'Right monocular PD (mm)', { inputMode: 'decimal', hint: 'Optional positive measurement.' })}
                  {input('left_pd', 'Left monocular PD (mm)', { inputMode: 'decimal', hint: 'Optional positive measurement.' })}
                </div>
              </fieldset>
              {input('prescriber_name', 'Prescriber name', { maxLength: 200, hint: 'Optional. Up to 200 characters.' })}
              <Field id="prescription-notes" label="Prescription notes" error={errors.notes?.message} hint="Optional. Up to 2,000 characters; line breaks are allowed.">
                <textarea id="prescription-notes" className="min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink aria-invalid:border-red-700" maxLength={2000} autoComplete="off" aria-invalid={!!errors.notes} aria-describedby={errors.notes ? 'prescription-notes-error' : 'prescription-notes-hint'} {...form.register('notes')} />
              </Field>
              {prescription ? input('revision_reason', 'Revision reason', { required: true, maxLength: 500, hint: 'Required. Explain why this replacement is being recorded (up to 500 characters).' }) : null}
              {savePrescription.isError ? <p className="text-sm leading-6 text-red-700" role="alert">{prescriptionErrorMessage(savePrescription.error)}</p> : null}
              <div className="flex flex-wrap gap-3 border-t border-line pt-5">
                <Button type="submit" loading={pending} disabled={!!prescription && !form.formState.isDirty}>{prescription ? 'Save revision' : 'Save prescription'}</Button>
                <Button variant="secondary" disabled={pending} onClick={() => navigate(cancelPath)}>Cancel</Button>
              </div>
            </fieldset>
          </form>
          <p className="mt-5 text-xs leading-5 text-muted">Values are recorded as entered, with at most two decimal places for powers and PDs. There is no strength recommendation, transposition, rounding, or inferred measurement.</p>
        </CardContent>
      </Card>
      <ConfirmationDialog open={blocker.state === 'blocked'} title={pending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending ? 'Wait for the prescription save to finish before leaving this page.' : 'Your changes have not been saved. Leaving this page will discard them.'} confirmLabel="Discard changes" cancelLabel="Keep editing" danger pending={pending} onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (blocker.state === 'blocked' && !pending) blocker.proceed() }} />
    </div>
  )
}
