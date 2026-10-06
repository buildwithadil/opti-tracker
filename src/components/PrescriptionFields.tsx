import type { UseFormReturn } from 'react-hook-form'
import type { PrescriptionFormValues, PrescriptionSaveValues } from '../lib/prescriptionValidation'
import type { PrescriptionFieldName } from '../lib/prescriptions'
import { Field, TextInput } from './ui/Field'
import { Disclosure } from './ui/ShopUI'

export function PrescriptionFields({ form,revision = false }: { form: UseFormReturn<PrescriptionFormValues,unknown,PrescriptionSaveValues>; revision?: boolean }) {
  const errors=form.formState.errors
  const input=(name: PrescriptionFieldName,label: string,type = 'text',inputMode: 'text'|'numeric'|'decimal' = 'text') => {
    const id=`prescription-${name}`
    return <Field id={id} label={label} error={errors[name]?.message}><TextInput id={id} type={type} inputMode={inputMode} autoComplete="off" maxLength={name==='prescriber_name' ? 200 : name==='revision_reason' ? 500 : undefined} aria-required={name==='prescribed_on' || name==='revision_reason' || undefined} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${id}-error` : undefined} {...form.register(name)} /></Field>
  }
  return <div className="space-y-5"><div className="overflow-hidden border-y border-line" aria-label="Optical measurements"><div className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-line bg-paper/70 px-3 py-3"><span /><p className="text-center text-xs font-semibold text-muted">OD · Right eye</p><p className="text-center text-xs font-semibold text-muted">OS · Left eye</p></div><div className="space-y-4 px-3 py-4">{(['sphere','cylinder','axis'] as const).map((measurement,index) => <div className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-3" key={measurement}><span className="pb-3 text-xs font-semibold text-muted">{['SPH','CYL','AXIS'][index]}</span>{(['right','left'] as const).map(eye => <div key={eye} className="min-w-0">{input(`${eye}_${measurement}`,`${eye === 'right' ? 'Right' : 'Left'} ${['SPH (D)','CYL (D)','AXIS (°)'][index]}`,'text',measurement === 'axis' ? 'numeric' : 'text')}</div>)}</div>)}</div></div><p className="text-xs leading-5 text-muted">Copy signed powers exactly. Blank means unknown, not zero. AXIS is 0–180°. Nothing is calculated.</p>
    {input('prescribed_on','Prescription date','date')}
    <Disclosure title="More prescription details" initiallyOpen={revision} invalid={!!errors.expires_on || !!errors.right_addition || !!errors.left_addition || !!errors.distance_pd || !!errors.near_pd || !!errors.right_pd || !!errors.left_pd || !!errors.prescriber_name || !!errors.notes}>
      <div className="grid grid-cols-2 gap-3">{input('right_addition','Right ADD (D)')}{input('left_addition','Left ADD (D)')}</div>{input('expires_on','Expiry / recheck date','date')}<div className="grid grid-cols-2 gap-3">{input('distance_pd','Distance PD (mm)','text','decimal')}{input('near_pd','Near PD (mm)','text','decimal')}</div><div className="grid grid-cols-2 gap-3">{input('right_pd','Right monocular PD (mm)','text','decimal')}{input('left_pd','Left monocular PD (mm)','text','decimal')}</div>{input('prescriber_name','Prescriber name')}<Field id="prescription-notes" label="Prescription notes" error={errors.notes?.message}><textarea id="prescription-notes" className="min-h-24 w-full rounded-[10px] border border-line bg-white p-3" maxLength={2000} aria-invalid={!!errors.notes} aria-describedby={errors.notes ? 'prescription-notes-error' : undefined} {...form.register('notes')} /></Field>
    </Disclosure>{revision ? input('revision_reason','Revision reason') : null}
  </div>
}
