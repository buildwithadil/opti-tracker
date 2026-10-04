import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Customer } from '../../shared/customers'
import type { Prescription } from '../../shared/prescriptions'
import { prescriptionDate, prescriptionErrorMessage, prescriptionEyeSummary, prescriptionKeys, prescriptionsApi, prescriptionTypeLabel } from '../lib/prescriptions'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { ErrorState, LoadingState } from './ui/States'

export function PrescriptionStatus({ status }: { status: Prescription['status'] }) {
  return <span className="inline-flex rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-medium text-muted">{status === 'current' ? 'Current' : status === 'superseded' ? 'Superseded' : 'Archived'}</span>
}

export function PrescriptionHistory({ customer, prescription }: { customer: Customer; prescription?: Prescription }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const query = { page, pageSize }
  const history = useQuery({
    queryKey: prescription ? prescriptionKeys.history(customer.uuid, prescription.uuid, query) : prescriptionKeys.list(customer.uuid, query),
    queryFn: ({ signal }) => prescription
      ? prescriptionsApi.history(customer.uuid, prescription.uuid, query, signal)
      : prescriptionsApi.list(customer.uuid, query, signal),
    retry: false,
  })
  const pagination = history.data?.pagination
  const lastPage = Math.min(pagination?.totalPages ?? 1, 10_000)
  const title = prescription ? 'Revision history' : 'Prescription history'

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {!prescription && !customer.archived_at ? <Link to={`/customers/${customer.uuid}/prescriptions/new`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90"><Plus className="size-4" aria-hidden="true" />Add prescription</Link> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-6 text-muted">{prescription ? 'Every version in this prescription’s chain is preserved. Open a version to see its original recorded values.' : 'All recorded prescriptions and their revisions, newest prescription date first. Blank measurements are unknown, not zero.'}</p>
        {customer.archived_at ? <p className="rounded-md border border-line bg-paper p-3 text-sm leading-6 text-muted">This customer is archived. Prescription history remains readable; restore the customer before adding or revising a prescription.</p> : null}
        {history.isPending ? <LoadingState label={prescription ? 'Loading revision history…' : 'Loading prescriptions…'} /> : null}
        {history.isError ? <ErrorState title="Prescription history could not be loaded" description={prescriptionErrorMessage(history.error)} onRetry={() => void history.refetch()} /> : null}
        {history.isSuccess ? (
          <>
            {history.data.prescriptions.length ? <ul className="divide-y divide-line" aria-label={title}>
              {history.data.prescriptions.map(record => (
                <li key={record.uuid} className="space-y-3 py-5 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">Prescription date: {record.prescribed_on ? <time dateTime={record.prescribed_on}>{prescriptionDate(record.prescribed_on)}</time> : 'Unknown'}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{prescriptionTypeLabel(record.prescription_type)} · Version {record.revision_number}{record.uuid === prescription?.uuid ? ' · Viewing this version' : ''}</p>
                    </div>
                    <PrescriptionStatus status={record.status} />
                  </div>
                  <dl className="space-y-2 text-sm leading-6 sm:grid sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-2 sm:space-y-0">
                    <dt className="font-medium text-ink">Right eye (OD)</dt><dd className="text-muted [overflow-wrap:anywhere]">{prescriptionEyeSummary(record, 'right')}</dd>
                    <dt className="font-medium text-ink">Left eye (OS)</dt><dd className="text-muted [overflow-wrap:anywhere]">{prescriptionEyeSummary(record, 'left')}</dd>
                  </dl>
                  {record.revision_reason ? <p className="text-sm leading-6 text-muted [overflow-wrap:anywhere]">Revision reason: {record.revision_reason}</p> : null}
                  <Link to={`/customers/${customer.uuid}/prescriptions/${record.uuid}`} className="inline-flex rounded-sm text-sm font-medium text-ink underline underline-offset-4 hover:no-underline" aria-label={`View prescription details, version ${record.revision_number}, ${prescriptionDate(record.prescribed_on)}`}>View prescription details</Link>
                </li>
              ))}
            </ul> : <div className="rounded-md border border-line bg-paper px-4 py-8 text-center">
              <h3 className="text-base font-semibold text-ink">No prescriptions yet</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{customer.archived_at ? 'There are no recorded prescriptions for this archived customer.' : 'Add a prescription from the supplied clinical record. No sample values are shown.'}</p>
            </div>}
            <nav className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" aria-label={prescription ? 'Revision history pagination' : 'Prescription history pagination'}>
              <p className="text-xs leading-5 text-muted" role="status">{pagination?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pagination.total)} of ${pagination.total} versions` : '0 versions'} · Page {page} of {pagination?.totalPages ?? 1}</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted">Per page <select className="ml-1 h-9 rounded-md border border-line bg-white px-2 text-sm text-ink" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>
                  <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
                </select></label>
                <Button size="sm" variant="secondary" disabled={page <= 1 || history.isFetching} onClick={() => setPage(value => value - 1)} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= lastPage || history.isFetching} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button>
              </div>
            </nav>
            {(pagination?.totalPages ?? 1) > 10_000 ? <p className="text-xs leading-5 text-muted">Up to 10,000 pages are available. Choose 50 versions per page to access more history.</p> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
