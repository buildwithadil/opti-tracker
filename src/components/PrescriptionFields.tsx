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
  return <div className="space-y-5"><div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2" aria-label="Optical measurements">
    <span /><p className="text-center text-sm font-semibold">OD · Right</p><p className="text-center text-sm font-semibold">OS · Left</p>
    {(['sphere','cylinder','axis','addition'] as const).map((measurement,index) => <div className="contents" key={measurement}><span className="text-sm font-medium">{['SPH','CYL','AXIS','ADD'][index]}</span>{(['right','left'] as const).map(eye => <div key={eye} className="min-w-0">{input(`${eye}_${measurement}`,`${eye === 'right' ? 'Right' : 'Left'} ${['SPH (D)','CYL (D)','AXIS (°)','ADD (D)'][index]}`,'text',measurement === 'axis' ? 'numeric' : 'text')}</div>)}</div>)}
  </div><p className="text-xs leading-5 text-muted">Copy signed powers exactly. Blank means unknown, not zero. AXIS is 0–180°. Enter only supplied PD measurements; distance, near and monocular values are not calculated from each other.</p>
    <div className="grid grid-cols-2 gap-3">{input('distance_pd','Distance PD (mm)','text','decimal')}{input('near_pd','Near PD (mm)','text','decimal')}</div>
    {input('prescribed_on','Prescription date','date')}
    <Disclosure title="More prescription details" initiallyOpen={revision} invalid={!!errors.expires_on || !!errors.right_pd || !!errors.left_pd || !!errors.prescriber_name || !!errors.notes}>
      {input('expires_on','Expiry / recheck date','date')}<div className="grid grid-cols-2 gap-3">{input('right_pd','Right monocular PD (mm)','text','decimal')}{input('left_pd','Left monocular PD (mm)','text','decimal')}</div>{input('prescriber_name','Prescriber name')}<Field id="prescription-notes" label="Prescription notes" error={errors.notes?.message}><textarea id="prescription-notes" className="min-h-24 w-full rounded-xl border border-line p-3" maxLength={2000} aria-invalid={!!errors.notes} aria-describedby={errors.notes ? 'prescription-notes-error' : undefined} {...form.register('notes')} /></Field>
    </Disclosure>{revision ? input('revision_reason','Revision reason') : null}
  </div>
}
