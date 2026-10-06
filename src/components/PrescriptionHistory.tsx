import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Customer } from '../../shared/customers'
import type { Prescription } from '../../shared/prescriptions'
import { prescriptionDate, prescriptionErrorMessage, prescriptionEyeSummary, prescriptionKeys, prescriptionsApi, prescriptionTypeLabel } from '../lib/prescriptions'
import { Button } from './ui/Button'
import { ErrorState, LoadingState } from './ui/States'

export function PrescriptionStatus({ status }: { status: Prescription['status'] }) {
  return <span className={`text-xs font-medium ${status === 'current' ? 'text-accent' : 'text-muted'}`}>{status === 'current' ? 'Current' : status === 'superseded' ? 'Superseded' : 'Archived'}</span>
}

export function PrescriptionHistory({ customer, prescription }: { customer: Customer; prescription?: Prescription }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const query = { page, pageSize }
  const history = useQuery({
    queryKey: prescription ? prescriptionKeys.history(customer.uuid, prescription.uuid, query) : prescriptionKeys.list(customer.uuid, query),
    queryFn: ({ signal }) => prescription ? prescriptionsApi.history(customer.uuid, prescription.uuid, query, signal) : prescriptionsApi.list(customer.uuid, query, signal),
    retry: false,
  })
  const pagination = history.data?.pagination
  const lastPage = Math.min(pagination?.totalPages ?? 1, 10_000)
  const title = prescription ? 'Revision history' : 'Prescription history'

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[19px] font-semibold">{title}</h2>{!prescription && !customer.archived_at ? <Link to={`/customers/${customer.uuid}/prescriptions/new`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white"><Plus className="size-4" aria-hidden="true" />Add prescription</Link> : null}</div>
    {customer.archived_at ? <p className="border-y border-line py-3 text-sm text-muted">This customer is archived. History remains readable.</p> : null}
    {history.isPending ? <LoadingState label={prescription ? 'Loading revision history…' : 'Loading prescriptions…'} /> : null}
    {history.isError ? <ErrorState title="Prescription history could not be loaded" description={prescriptionErrorMessage(history.error)} onRetry={() => void history.refetch()} /> : null}
    {history.isSuccess ? <>
      {history.data.prescriptions.length ? <ul className="hairline-list border-y border-line bg-white" aria-label={title}>{history.data.prescriptions.map(record => <li key={record.uuid} className="space-y-4 px-4 py-5 sm:px-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{record.prescribed_on ? <time dateTime={record.prescribed_on}>{prescriptionDate(record.prescribed_on)}</time> : 'Unknown date'}</p><p className="mt-1 text-sm text-muted">{prescriptionTypeLabel(record.prescription_type)} · Version {record.revision_number}</p></div><PrescriptionStatus status={record.status} /></div><dl className="space-y-2 text-sm sm:grid sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-3 sm:space-y-0"><dt className="font-medium">Right eye (OD)</dt><dd className="text-muted [overflow-wrap:anywhere]">{prescriptionEyeSummary(record, 'right')}</dd><dt className="font-medium">Left eye (OS)</dt><dd className="text-muted [overflow-wrap:anywhere]">{prescriptionEyeSummary(record, 'left')}</dd></dl>{record.revision_reason ? <p className="text-sm text-muted [overflow-wrap:anywhere]">Revision reason: {record.revision_reason}</p> : null}<Link to={`/customers/${customer.uuid}/prescriptions/${record.uuid}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline" aria-label={`View prescription details, version ${record.revision_number}, ${prescriptionDate(record.prescribed_on)}`}>View details</Link></li>)}</ul> : <div className="border-y border-line px-4 py-8 text-center"><h3 className="font-semibold">No prescriptions yet</h3><p className="mt-2 text-sm text-muted">Add a prescription when the customer has one.</p></div>}
      <nav className="flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label={prescription ? 'Revision history pagination' : 'Prescription history pagination'}><p className="text-xs text-muted" role="status">{pagination?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pagination.total)} of ${pagination.total} versions` : '0 versions'} · Page {page} of {pagination?.totalPages ?? 1}</p><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-muted">Per page <select className="ml-1 h-9 rounded-[8px] border border-line bg-white px-2 text-sm text-ink" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label><Button size="sm" variant="secondary" disabled={page <= 1 || history.isFetching} onClick={() => setPage(value => value - 1)} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= lastPage || history.isFetching} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button></div></nav>
    </> : null}
  </section>
}
