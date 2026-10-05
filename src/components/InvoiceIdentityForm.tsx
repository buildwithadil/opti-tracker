import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { InvoiceIdentity } from '../../shared/invoices'
import { invoiceIdentitySchema, type InvoiceIdentityInput } from '../../shared/invoiceValidation'
import { invoiceErrorMessage, invoiceKeys, invoicesApi } from '../lib/invoices'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field, TextInput } from './ui/Field'
import { ErrorState, LoadingState } from './ui/States'
import { ConfirmationDialog } from './ui/ConfirmationDialog'

export function InvoiceIdentityForm() {
  const [notice, setNotice] = useState('')
  const identity = useQuery({ queryKey: invoiceKeys.identity, queryFn: ({ signal }) => invoicesApi.identity(signal), retry: false })
  return <Card className="max-w-3xl"><CardHeader><CardTitle>Invoice business information</CardTitle></CardHeader><CardContent>
    {notice ? <p role="status" className="mb-5 text-sm text-ink">{notice}</p> : null}
    {identity.isPending ? <LoadingState label="Loading invoice business information…" /> : identity.isError ? <ErrorState description={invoiceErrorMessage(identity.error)} onRetry={() => void identity.refetch()} /> : <IdentityForm key={identity.data.updated_at} identity={identity.data} onSaved={() => setNotice('Invoice business information saved.')} />}
  </CardContent></Card>
}
function IdentityForm({ identity, onSaved }: { identity: InvoiceIdentity; onSaved: () => void }) {
  const client = useQueryClient(), lock = useRef(false)
  const form = useForm<InvoiceIdentityInput>({ resolver: zodResolver(invoiceIdentitySchema), defaultValues: { ...identity, gstin: identity.gstin ?? '' } })
  const save = useMutation({ mutationFn: invoicesApi.updateIdentity, onSuccess: async result => {
    form.reset({ ...result, gstin: result.gstin ?? '' })
    onSaved()
    client.setQueryData(invoiceKeys.identity, result)
    await Promise.all([client.invalidateQueries({ queryKey: ['shop-identity'] }), client.invalidateQueries({ queryKey: ['session'] })])
  } })
  const pending = form.formState.isSubmitting || save.isPending
  const shouldWarn = form.formState.isDirty || pending
  const blocker = useBlocker(() => shouldWarn)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => { if (shouldWarn) { event.preventDefault(); event.returnValue = '' } }, [shouldWarn]))
  const errors = form.formState.errors
  return <><p className="mb-5 text-sm leading-6 text-muted">These existing shop fields are copied into new invoices. Already issued invoices keep their original business information.</p>
    <form className="max-w-xl space-y-4" aria-label="Invoice business information" noValidate onSubmit={event => { void form.handleSubmit(async values => { if (lock.current) return; lock.current = true; try { await save.mutateAsync(values) } catch { /* Retain the draft. */ } finally { lock.current = false } })(event) }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-70"><legend className="sr-only">Invoice business fields</legend>
        <Field id="invoice-shop-name" label="Shop name" error={errors.shop_name?.message}><TextInput id="invoice-shop-name" maxLength={200} aria-required="true" aria-invalid={!!errors.shop_name} {...form.register('shop_name')} /></Field>
        <Field id="invoice-shop-address" label="Shop address" error={errors.address?.message}><textarea id="invoice-shop-address" className="min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" maxLength={2000} aria-required="true" aria-invalid={!!errors.address} {...form.register('address')} /></Field>
        <Field id="invoice-shop-contact" label="Shop contact number" error={errors.contact_number?.message}><TextInput id="invoice-shop-contact" type="tel" maxLength={32} aria-required="true" aria-invalid={!!errors.contact_number} {...form.register('contact_number')} /></Field>
        <Field id="invoice-shop-gstin" label="GSTIN" error={errors.gstin?.message} hint="Optional. Enter the shop's actual registration number only."><TextInput id="invoice-shop-gstin" maxLength={15} aria-invalid={!!errors.gstin} {...form.register('gstin')} /></Field>
      </fieldset>
      {save.isError ? <p role="alert" className="text-sm text-red-700">{invoiceErrorMessage(save.error)}</p> : null}
        <Button type="submit" loading={pending}>Save invoice business information</Button>
    </form>
    <ConfirmationDialog open={blocker.state === 'blocked'} title={pending ? 'Save in progress' : 'Discard unsaved changes?'} description={pending ? 'Wait for the business information save to finish.' : 'Your business information changes have not been saved.'} confirmLabel="Discard changes" cancelLabel="Keep editing" pending={pending} danger onCancel={() => { if (blocker.state === 'blocked') blocker.reset() }} onConfirm={() => { if (blocker.state === 'blocked' && !pending) blocker.proceed() }} />
  </>
}
