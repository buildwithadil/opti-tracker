import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Prescription } from '../../shared/prescriptions'
import { prescriptionDefaults, prescriptionFormSchema, type PrescriptionFormValues, type PrescriptionSaveValues } from '../lib/prescriptionValidation'
import { prescriptionErrorMessage, prescriptionFieldErrors, prescriptionKeys, prescriptionsApi, type PrescriptionFieldName } from '../lib/prescriptions'
import { ApiError } from '../lib/api'
import { Button } from './ui/Button'
import { PrescriptionFields } from './PrescriptionFields'

export function InlinePrescription({ customer,onSaved,onDirtyChange,onPendingChange,onReview }: { customer: string; onSaved: (prescription: Prescription) => void; onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean)=>void; onReview: ()=>void }) {
  const client=useQueryClient(), lock=useRef(false), focus=useRef<PrescriptionFieldName|null>(null)
  const [uncertain,setUncertain]=useState(false)
  const form=useForm<PrescriptionFormValues,unknown,PrescriptionSaveValues>({ resolver: zodResolver(prescriptionFormSchema),defaultValues: prescriptionDefaults() })
  const save=useMutation({ mutationFn: (input: PrescriptionSaveValues) => { const fields={ ...input }; delete fields.revision_reason; return prescriptionsApi.create(customer,fields) },onSuccess: async record => { form.reset(); client.setQueryData(prescriptionKeys.detail(customer,record.uuid),record); await client.invalidateQueries({ queryKey: prescriptionKeys.customer(customer) }); onSaved(record) },onError: error => { const fields=prescriptionFieldErrors(error); fields.forEach(field=>form.setError(field.field,{ message: field.message })); focus.current=fields[0]?.field ?? null; setUncertain(!(error instanceof ApiError) || error.status===0 || error.status>=500) } })
  const pending=save.isPending || form.formState.isSubmitting
  useEffect(() => { onDirtyChange(form.formState.isDirty || pending) },[form.formState.isDirty,pending,onDirtyChange])
  useEffect(()=>{ onPendingChange(pending); return ()=>onPendingChange(false) },[pending,onPendingChange])
  useEffect(()=>{ if (!pending && focus.current) { form.setFocus(focus.current); focus.current=null } },[pending,save.error,form])
  return <form noValidate aria-label="New prescription in sale" onSubmit={event => { void form.handleSubmit(async values => { if (lock.current || uncertain) return; lock.current=true; try { await save.mutateAsync(values) } catch { /* Preserve input; do not automatically create another prescription. */ } finally { lock.current=false } })(event) }} className="space-y-5"><fieldset disabled={pending || uncertain}><PrescriptionFields form={form} /></fieldset>{save.isError ? <p role="alert" className="text-sm text-red-700">{prescriptionErrorMessage(save.error)} If the connection was interrupted, check prescription choices before saving again.</p> : null}<Button type="submit" loading={pending} disabled={uncertain} className="w-full">Save prescription & Continue</Button>{uncertain ? <Button variant="secondary" className="w-full" onClick={onReview}>Check saved prescriptions</Button> : null}</form>
}
