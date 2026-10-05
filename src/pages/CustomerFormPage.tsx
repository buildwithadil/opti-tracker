import { useCallback, useEffect, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import type { Customer, CustomerInput } from '../../shared/customers'
import { formatIndianMobile } from '../../shared/phone'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { Field, TextInput } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerSchema, type CustomerFormValues } from '../lib/customerValidation'
import { customerErrorMessage, customerFieldErrors, customerKeys, customersApi } from '../lib/customers'

export function CustomerCreatePage() {
  return <CustomerForm />
}

export function CustomerEditPage() {
  const { uuid = '' } = useParams()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  if (customer.isPending) return <LoadingState label="Loading customer details…" />
  if (customer.isError) {
    return (
      <div className="space-y-5">
        <Link to="/customers" className="text-sm font-medium text-ink underline underline-offset-4">Back to customers</Link>
        <ErrorState title={customer.error instanceof ApiError && customer.error.status === 404 ? 'Customer not found' : 'Customer could not be loaded'} description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} />
      </div>
    )
  }
  return <CustomerForm key={customer.data.uuid} customer={customer.data} />
}

function CustomerForm({ customer }: { customer?: Customer }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submissionLock = useRef(false)
  const saved = useRef(false)
  const errorFocus = useRef<'name' | 'phone' | null>(null)
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: customer?.name ?? '', phone: customer ? formatIndianMobile(customer.normalized_phone) : '' },
  })
  const saveCustomer = useMutation({
    mutationFn: (values: CustomerInput) => customer ? customersApi.update(customer.uuid, values) : customersApi.create(values),
    onSuccess: async (result) => {
      queryClient.setQueryData(customerKeys.detail(result.uuid), result)
      await queryClient.invalidateQueries({ queryKey: customerKeys.all })
      saved.current = true
      form.reset({ name: result.name, phone: formatIndianMobile(result.normalized_phone) })
      navigate(`/customers/${result.uuid}`, { replace: true, state: { customerNotice: customer ? 'Customer details saved.' : 'Customer created.' } })
    },
    onError: (error) => {
      const errors = customerFieldErrors(error)
      errors.forEach(({ field, message }) => form.setError(field, { type: 'server', message }))
      errorFocus.current = errors[0]?.field ?? null
    },
  })
  const pending = form.formState.isSubmitting || saveCustomer.isPending
  // onError runs before RHF and the mutation finish. A disabled input cannot
  // receive focus, so wait for the fieldset to re-enable after the failed save.
  useEffect(() => {
    if (!pending && errorFocus.current) {
      form.setFocus(errorFocus.current)
      errorFocus.current = null
    }
  }, [pending, saveCustomer.error, form])
  const shouldWarn = form.formState.isDirty || pending
  const blocker = useBlocker(() => !saved.current && shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!saved.current && shouldWarn) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [shouldWarn]))
  const errors = form.formState.errors
  const cancelPath = customer ? `/customers/${customer.uuid}` : '/customers'

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Customer" title={customer ? 'Edit customer' : 'Add Customer'} description={customer ? 'Keep their name and phone number up to date.' : 'Save a name and phone number to get started.'} />
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{customer ? 'Customer details' : 'Contact details'}</CardTitle></CardHeader>
        <CardContent>
          {customer?.archived_at ? <p className="mb-5 rounded-md border border-line bg-paper p-3 text-sm leading-6 text-muted">This customer is archived. You can update contact details here; saving does not restore the profile.</p> : null}
          <form
            className="space-y-5"
            noValidate
            aria-label={customer ? 'Edit customer details' : 'New customer details'}
            onSubmit={(event) => {
              void form.handleSubmit(async (values) => {
                if (submissionLock.current) return
                submissionLock.current = true
                saveCustomer.reset()
                try {
                  await saveCustomer.mutateAsync(values)
                } catch {
                  // Field errors and the mutation alert retain the form for correction.
                } finally {
                  submissionLock.current = false
                }
              })(event)
            }}
          >
            <fieldset className="space-y-5 disabled:opacity-70" disabled={pending}>
              <legend className="sr-only">Customer contact information</legend>
              <Field id="customer-name" label="Full name" error={errors.name?.message}>
                <TextInput id="customer-name" autoComplete="name" maxLength={200} aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'customer-name-error' : 'customer-name-hint'} {...form.register('name')} />
              </Field>
              <Field id="customer-phone" label="Mobile number" error={errors.phone?.message}>
                <TextInput id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} aria-required="true" aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'customer-phone-error' : 'customer-phone-hint'} {...form.register('phone')} />
              </Field>
              {saveCustomer.isError ? <p className="text-sm leading-6 text-red-700" role="alert">{customerErrorMessage(saveCustomer.error)}</p> : null}
              <div className="flex flex-wrap gap-3 border-t border-line pt-5">
                <Button type="submit" loading={pending} disabled={!!customer && !form.formState.isDirty}>{customer ? 'Save changes' : 'Save customer'}</Button>
                <Button variant="secondary" disabled={pending} onClick={() => navigate(cancelPath)}>Cancel</Button>
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <ConfirmationDialog
        open={blocker.state === 'blocked'}
        title={pending ? 'Save in progress' : 'Discard unsaved changes?'}
        description={pending ? 'Wait for the customer save to finish before leaving this page.' : 'Your changes have not been saved. Leaving this page will discard them.'}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        danger
        pending={pending}
        onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }}
        onConfirm={() => { if (blocker.state === 'blocked' && !pending) blocker.proceed() }}
      />
    </div>
  )
}
