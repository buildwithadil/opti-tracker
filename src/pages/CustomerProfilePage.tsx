import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArrowLeft, Pencil, RotateCcw } from 'lucide-react'
import { formatIndianMobile } from '../../shared/phone'
import { PrescriptionHistory } from '../components/PrescriptionHistory'
import { PurchaseHistory } from '../components/PurchaseHistory'
import { CustomerCredit } from '../components/CustomerCredit'
import { ShopPaymentHistory } from '../components/ShopPaymentHistory'
import { ActionLink, NewSaleLink, Tabs } from '../components/ui/ShopUI'
import { refreshShop } from '../lib/shop'
import { Button } from '../components/ui/Button'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/States'
import { ApiError } from '../lib/api'
import { customerDate, customerErrorMessage, customerKeys, customersApi } from '../lib/customers'

type CustomerAction = 'archive' | 'restore'

export function CustomerProfilePage() {
  const { uuid = '' } = useParams()
  const location = useLocation()
  const [params,setParams]=useSearchParams()
  const tabs=['Overview','Sales','Prescriptions','Payments']
  const tab=tabs.find(value=>value.toLowerCase()===params.get('tab')) ?? 'Overview'
  const queryClient = useQueryClient()
  const actionLock = useRef(false)
  const [confirmation, setConfirmation] = useState<CustomerAction | null>(null)
  const [notice, setNotice] = useState('')
  const customer = useQuery({ queryKey: customerKeys.detail(uuid), queryFn: ({ signal }) => customersApi.detail(uuid, signal), retry: false })
  const changeStatus = useMutation({
    mutationFn: (action: CustomerAction) => action === 'archive' ? customersApi.archive(uuid) : customersApi.restore(uuid),
    onSuccess: async (result, action) => {
      queryClient.setQueryData(customerKeys.detail(uuid), result)
      await refreshShop(queryClient)
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
    <div className="space-y-8">
      <Link to="/customers" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden="true" />Back to customers</Link>
      <PageHeader eyebrow="Customer" title={record.name} description={formatIndianMobile(record.normalized_phone)} />
      {notice || routeNotice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-ink" role="status">{notice || routeNotice}</p> : null}
      {!archived ? <div className="flex flex-wrap gap-2"><NewSaleLink customer={record.uuid} /><ActionLink secondary to={`/receive-payment?customer=${record.uuid}`}>Receive payment</ActionLink></div> : null}
      <div className="flex flex-wrap items-center gap-4 border-y border-line py-4">{archived ? <span className="text-sm text-muted">Archived</span> : null}<Link to={`/customers/${record.uuid}/edit`} className="text-sm font-medium text-accent underline-offset-4 hover:underline"><Pencil className="mr-1 inline size-4" aria-hidden="true" />Edit customer</Link><Button variant="ghost" size="sm" disabled={changeStatus.isPending} icon={archived ? <RotateCcw className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />} onClick={() => { changeStatus.reset(); setConfirmation(archived ? 'restore' : 'archive') }}>{archived ? 'Restore customer' : 'Archive customer'}</Button></div>
      <section aria-label="Customer overview" className="border-y border-line py-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted">Outstanding</p><CustomerCredit key={`credit:${record.uuid}`} customerUuid={record.uuid} /></div><div className="text-right text-sm text-muted"><p>Last activity</p><p className="mt-1 text-ink"><time dateTime={record.updated_at}>{customerDate(record.updated_at)}</time></p></div></div></section>
      <Tabs tabs={tabs} value={tab} label="Customer sections" panelId="customer-panel" onChange={value=>setParams({ tab: value.toLowerCase() },{ replace: true })} />
      <section id="customer-panel" role="tabpanel" aria-label={tab} tabIndex={0} className="space-y-5">
       {tab==='Overview' ? <section className="space-y-4"><h2 className="text-[19px] font-semibold">Overview</h2><dl className="border-y border-line py-4 text-sm"><div className="flex items-center justify-between gap-4 py-2"><dt className="text-muted">Name</dt><dd className="font-medium text-right [overflow-wrap:anywhere]">{record.name}</dd></div><div className="flex items-center justify-between gap-4 py-2"><dt className="text-muted">Mobile</dt><dd className="font-medium text-right"><a className="underline underline-offset-4 hover:no-underline" href={`tel:${record.normalized_phone}`}>{formatIndianMobile(record.normalized_phone)}</a></dd></div></dl>{archived ? <p className="text-sm text-muted">This customer is archived. Restore them before starting a sale or receiving payment.</p> : null}</section> : tab==='Prescriptions' ? <PrescriptionHistory key={record.uuid} customer={record} /> : tab==='Sales' ? <PurchaseHistory key={`purchases:${record.uuid}`} customer={record} /> : <ShopPaymentHistory key={`payments:${record.uuid}`} customer={record.uuid} />}
      </section>
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
