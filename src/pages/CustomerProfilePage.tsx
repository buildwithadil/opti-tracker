import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Pencil, RotateCcw } from 'lucide-react'
import { formatIndianMobile } from '../../shared/phone'
import { PrescriptionHistory } from '../components/PrescriptionHistory'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerDate, customerErrorMessage, customerKeys, customersApi } from '../lib/customers'
import { CustomerStatus } from './CustomersPage'

type CustomerAction = 'archive' | 'restore'

export function CustomerProfilePage() {
  const { uuid = '' } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const actionLock = useRef(false)
  const [confirmation, setConfirmation] = useState<CustomerAction | null>(null)
  const [notice, setNotice] = useState('')
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const changeStatus = useMutation({
    mutationFn: (action: CustomerAction) => action === 'archive' ? customersApi.archive(uuid) : customersApi.restore(uuid),
    onSuccess: async (result, action) => {
      queryClient.setQueryData(customerKeys.detail(uuid), result)
      await queryClient.invalidateQueries({ queryKey: customerKeys.all })
      setConfirmation(null)
      setNotice(action === 'archive' ? 'Customer archived. The profile is still available.' : 'Customer restored to the active list.')
    },
  })
  const routeNotice = typeof location.state?.customerNotice === 'string' ? location.state.customerNotice : ''

  if (customer.isPending) return <LoadingState label="Loading customer profile…" />
  if (customer.isError) {
    return (
      <div className="space-y-5">
        <Link to="/customers" className="text-sm font-medium text-ink underline underline-offset-4">Back to customers</Link>
        <ErrorState title={customer.error instanceof ApiError && customer.error.status === 404 ? 'Customer not found' : 'Customer profile could not be loaded'} description={customerErrorMessage(customer.error)} onRetry={() => void customer.refetch()} />
      </div>
    )
  }
  const record = customer.data
  const archived = !!record.archived_at

  return (
    <div className="space-y-7">
      <Link to="/customers" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden="true" />Back to customers</Link>
      <PageHeader
        eyebrow="Customer profile"
        title={record.name}
        description="Contact details, profile status and recorded prescription history. Purchase management is not available yet."
        actions={
          <>
            <Link to={`/customers/${record.uuid}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-paper"><Pencil className="size-4" aria-hidden="true" />Edit customer</Link>
            <Button variant="secondary" disabled={changeStatus.isPending} icon={archived ? <RotateCcw className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />} onClick={() => { changeStatus.reset(); setConfirmation(archived ? 'restore' : 'archive') }}>{archived ? 'Restore customer' : 'Archive customer'}</Button>
          </>
        }
      />
      {notice || routeNotice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-ink" role="status">{notice || routeNotice}</p> : null}
      <Card>
        <CardHeader><CardTitle>Customer details</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-5 text-sm sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-5 sm:space-y-0">
            <dt className="text-muted">Full name</dt><dd className="font-medium text-ink [overflow-wrap:anywhere]">{record.name}</dd>
            <dt className="text-muted">Mobile number</dt><dd className="font-medium text-ink"><a className="rounded-sm underline underline-offset-4 hover:no-underline" href={`tel:${record.normalized_phone}`}>{formatIndianMobile(record.normalized_phone)}</a></dd>
            <dt className="text-muted">Status</dt><dd><CustomerStatus archived={archived} /></dd>
            <dt className="text-muted">Registration date</dt><dd className="text-ink"><time dateTime={record.created_at}>{customerDate(record.created_at, true)}</time></dd>
            <dt className="text-muted">Last updated</dt><dd className="text-ink"><time dateTime={record.updated_at}>{customerDate(record.updated_at, true)}</time></dd>
            {record.archived_at ? <><dt className="text-muted">Archived</dt><dd className="text-ink"><time dateTime={record.archived_at}>{customerDate(record.archived_at, true)}</time></dd></> : null}
          </dl>
          {archived ? <p className="mt-6 border-t border-line pt-5 text-sm leading-6 text-muted">This customer is archived and excluded from the active list. The record has not been deleted. You may edit details or restore it when needed.</p> : null}
        </CardContent>
      </Card>
      <PrescriptionHistory key={record.uuid} customer={record} />
      <Card>
        <CardHeader><CardTitle>Purchase history</CardTitle></CardHeader>
        <CardContent><p className="text-sm leading-6 text-muted">Not available in Phase 3. Purchase records will appear here when the purchase module is implemented. No purchase history or totals are loaded.</p></CardContent>
      </Card>
      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation === 'restore' ? 'Restore customer?' : 'Archive customer?'}
        description={confirmation === 'restore' ? 'This customer will return to the active list. If another active customer uses this mobile number, edit this archived profile’s number before restoring.' : 'This customer will be removed from the active list. The profile is preserved, and you can restore it later. This does not delete any records.'}
        confirmLabel={confirmation === 'restore' ? 'Restore customer' : 'Archive customer'}
        danger={confirmation === 'archive'}
        pending={changeStatus.isPending}
        error={changeStatus.isError ? customerErrorMessage(changeStatus.error) : undefined}
        onCancel={() => { if (!changeStatus.isPending) setConfirmation(null) }}
        onConfirm={() => {
          if (!confirmation || actionLock.current) return
          actionLock.current = true
          changeStatus.mutate(confirmation, { onSettled: () => { actionLock.current = false } })
        }}
      />
    </div>
  )
}
