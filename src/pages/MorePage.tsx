import { BarChart3, ChevronRight, FileText, Settings, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink } from '../components/ui/ShopUI'
import { ShopPaymentHistory } from '../components/ShopPaymentHistory'

export function MorePage() {
  return <div className="space-y-5"><PageHeader title="More" description="History, reports and your shop settings." /><ul className="divide-y divide-line rounded-2xl border border-line bg-white">{[['Reports','Sales, collections and CSV exports','/reports',BarChart3],['Payment history','Every received payment','/payments/history',Wallet],['Prescriptions','Find a customer’s optical records','/prescriptions',FileText],['Settings','Shop information and account security','/settings',Settings]].map(([title,description,to,Icon])=>{ const Symbol=Icon as typeof BarChart3; return <li key={String(to)}><Link to={String(to)} className="flex min-h-20 items-center gap-3 p-4"><Symbol className="size-5 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block font-semibold">{String(title)}</span><span className="text-sm text-muted">{String(description)}</span></span><ChevronRight className="size-5" aria-hidden="true" /></Link></li> })}</ul></div>
}
export function PaymentHistoryPage() { return <div className="space-y-5"><PageHeader title="Payment history" description="Recent collections across all customers and dates." actions={<ActionLink to="/receive-payment">Receive Payment</ActionLink>} /><ShopPaymentHistory /></div> }
