import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import type { Prescription } from '../../shared/prescriptions'
import { PrescriptionHistory, PrescriptionStatus } from '../components/PrescriptionHistory'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerDate, customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { prescriptionDate, prescriptionErrorMessage, prescriptionKeys, prescriptionMeasurement, prescriptionsApi, prescriptionTypeLabel } from '../lib/prescriptions'

function EyeDetails({ record, eye }: { record: Prescription; eye: 'right' | 'left' }) {
  const label = eye === 'right' ? 'Right' : 'Left'
  return <div className="rounded-md border border-line p-4">
    <h3 className="mb-4 text-sm font-semibold text-ink">{label} eye ({eye === 'right' ? 'OD' : 'OS'})</h3>
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-4 text-sm">
      <dt className="text-muted">{label} SPH (D)</dt><dd className="font-medium text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record[`${eye}_sphere`], ' D')}</dd>
      <dt className="text-muted">{label} CYL (D)</dt><dd className="font-medium text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record[`${eye}_cylinder`], ' D')}</dd>
      <dt className="text-muted">{label} AXIS (°)</dt><dd className="font-medium text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record[`${eye}_axis`], '°')}</dd>
      <dt className="text-muted">{label} ADD (D)</dt><dd className="font-medium text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record[`${eye}_addition`], ' D')}</dd>
    </dl>
  </div>
}

export function PrescriptionDetailPage() {
  const { uuid = '', prescriptionUuid = '' } = useParams()
  const location = useLocation()
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const prescription = useQuery({
    queryKey: prescriptionKeys.detail(uuid, prescriptionUuid),
    queryFn: ({ signal }) => prescriptionsApi.detail(uuid, prescriptionUuid, signal),
    enabled: customer.isSuccess,
    retry: false,
  })
  if (customer.isPending || (customer.isSuccess && prescription.isPending)) return <LoadingState label="Loading prescription details…" />
  if (customer.isError) return <div className="space-y-5"><Link to="/customers" className="text-sm font-medium text-ink underline underline-offset-4">Back to customers</Link><ErrorState title={customer.error instanceof ApiError && customer.error.status === 404 ? 'Customer not found' : 'Customer could not be loaded'} description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} /></div>
  if (prescription.isError) return <div className="space-y-5"><Link to={`/customers/${uuid}`} className="text-sm font-medium text-ink underline underline-offset-4">Back to customer</Link><ErrorState title={prescription.error instanceof ApiError && prescription.error.status === 404 ? 'Prescription not found' : 'Prescription could not be loaded'} description={prescriptionErrorMessage(prescription.error)} onRetry={() => void prescription.refetch()} /></div>
  if (!prescription.data) return <LoadingState label="Loading prescription details…" />
  const record = prescription.data
  const customerRecord = customer.data
  const path = `/customers/${uuid}/prescriptions`
  const canRevise = !customerRecord.archived_at && record.status === 'current' && record.prescription_type === 'spectacle'
  const notice = typeof location.state?.prescriptionNotice === 'string' ? location.state.prescriptionNotice : ''

  return (
    <div className="space-y-7 [overflow-wrap:anywhere]">
      <Link to={`/customers/${uuid}`} className="text-sm font-medium text-ink underline underline-offset-4">Back to customer</Link>
      <PageHeader eyebrow={`Prescription · ${customerRecord.name}`} title="Prescription details" description={`Version ${record.revision_number} · ${prescriptionTypeLabel(record.prescription_type)}. Each saved version preserves its recorded values.`} actions={canRevise ? <Link to={`${path}/${record.uuid}/revise`} className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90">Revise prescription</Link> : undefined} />
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-ink" role="status">{notice}</p> : null}
      {customerRecord.archived_at ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm leading-6 text-muted">This customer is archived. Prescriptions remain readable, but cannot be added or revised until the customer is restored.</p> : null}
      {record.prescription_type !== 'spectacle' ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm leading-6 text-muted">This is a legacy {record.prescription_type === 'contact_lens' ? 'contact lens' : 'other'} record. Its original values are preserved; revisions for this prescription type are not supported in this phase.</p> : null}
      <Card>
        <CardHeader><CardTitle>Recorded prescription</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <dl className="space-y-4 text-sm sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4 sm:space-y-0">
            <dt className="text-muted">Status</dt><dd><PrescriptionStatus status={record.status} /></dd>
            <dt className="text-muted">Version</dt><dd className="text-ink">{record.revision_number}</dd>
            <dt className="text-muted">Prescription type</dt><dd className="text-ink">{prescriptionTypeLabel(record.prescription_type)}</dd>
            <dt className="text-muted">Prescription date</dt><dd className="text-ink">{record.prescribed_on ? <time dateTime={record.prescribed_on}>{prescriptionDate(record.prescribed_on)}</time> : 'Unknown'}</dd>
            <dt className="text-muted">Expiry / recheck date</dt><dd className="text-ink">{record.expires_on ? <time dateTime={record.expires_on}>{prescriptionDate(record.expires_on)}</time> : 'Unknown'}</dd>
            <dt className="text-muted">Prescriber name</dt><dd className="text-ink [overflow-wrap:anywhere]">{record.prescriber_name ?? 'Unknown'}</dd>
            <dt className="text-muted">Recorded at</dt><dd className="text-ink"><time dateTime={record.created_at}>{customerDate(record.created_at, true)}</time></dd>
            <dt className="text-muted">Version last updated</dt><dd className="text-ink"><time dateTime={record.updated_at}>{customerDate(record.updated_at, true)}</time></dd>
            {record.superseded_at ? <><dt className="text-muted">Superseded at</dt><dd className="text-ink"><time dateTime={record.superseded_at}>{customerDate(record.superseded_at, true)}</time></dd></> : null}
            {record.revision_reason ? <><dt className="text-muted">Revision reason</dt><dd className="text-ink [overflow-wrap:anywhere]">{record.revision_reason}</dd></> : null}
          </dl>
          <div className="grid gap-5 md:grid-cols-2"><EyeDetails record={record} eye="right" /><EyeDetails record={record} eye="left" /></div>
          <p className="text-xs leading-5 text-muted">Blank source measurements are shown as unknown. Values are not interpreted, transposed, or calculated.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Pupillary distance (PD)</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-4 text-sm sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4 sm:space-y-0">
            <dt className="text-muted">Distance PD (mm)</dt><dd className="text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record.distance_pd, ' mm')}</dd>
            <dt className="text-muted">Near PD (mm)</dt><dd className="text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record.near_pd, ' mm')}</dd>
            <dt className="text-muted">Right monocular PD (mm)</dt><dd className="text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record.right_pd, ' mm')}</dd>
            <dt className="text-muted">Left monocular PD (mm)</dt><dd className="text-ink [overflow-wrap:anywhere]">{prescriptionMeasurement(record.left_pd, ' mm')}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Prescription notes</CardTitle></CardHeader>
        <CardContent><p className="whitespace-pre-wrap text-sm leading-6 text-muted [overflow-wrap:anywhere]">{record.notes ?? 'No prescription notes recorded.'}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Version links</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-muted">A revision creates a replacement record. Previous values are never overwritten.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
            {record.supersedes_uuid ? <Link to={`${path}/${record.supersedes_uuid}`} className="font-medium text-ink underline underline-offset-4">View previous version</Link> : <span className="text-muted">This is the original version.</span>}
            {record.superseded_by_uuid ? <Link to={`${path}/${record.superseded_by_uuid}`} className="font-medium text-ink underline underline-offset-4">View replacement version</Link> : null}
            {record.root_uuid !== record.uuid ? <Link to={`${path}/${record.root_uuid}`} className="font-medium text-ink underline underline-offset-4">View original prescription</Link> : null}
          </div>
        </CardContent>
      </Card>
      <PrescriptionHistory key={`${uuid}:${record.root_uuid}`} customer={customerRecord} prescription={record} />
    </div>
  )
}
