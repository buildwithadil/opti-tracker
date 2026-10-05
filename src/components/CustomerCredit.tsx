import { useQuery } from '@tanstack/react-query'
import { paymentErrorMessage, paymentKeys, paymentsApi } from '../lib/payments'
import { purchaseMoney } from '../lib/purchases'
import { ErrorState, LoadingState } from './ui/States'

export function CustomerCredit({ customerUuid }: { customerUuid: string }) {
  const credit = useQuery({ queryKey: paymentKeys.credit(customerUuid), queryFn: ({ signal }) => paymentsApi.credit(customerUuid, signal), retry: false })
  return credit.isPending ? <LoadingState label="Loading customer outstanding balance…" /> : credit.isError ? <ErrorState title="Outstanding credit could not be loaded" description={paymentErrorMessage(credit.error)} onRetry={() => void credit.refetch()} /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink" data-testid="customer-outstanding">{purchaseMoney(credit.data.outstanding_paise)}</p>
}
