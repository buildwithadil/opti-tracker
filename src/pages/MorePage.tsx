import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { ActionLink } from '../components/ui/ShopUI'
import { ShopPaymentHistory } from '../components/ShopPaymentHistory'

export function MorePage() {
  return <div className="space-y-8"><PageHeader title="More" /><ul className="hairline-list border-y border-line bg-white">{[['Reports','Sales, collections and exports','/reports'],['Payment history','Every received payment','/payments/history'],['Prescriptions','Optical records','/prescriptions'],['Settings','Shop information and security','/settings']].map(([title,description,to]) => <li key={to}><Link to={to} className="touch-row flex items-center gap-3 px-5"><span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="text-sm text-muted">{description}</span></span><ChevronRight className="size-5 text-muted" aria-hidden="true" /></Link></li>)}</ul></div>
}
export function PaymentHistoryPage() { return <div className="space-y-5"><PageHeader title="Payment history" description="Recent collections across all customers and dates." actions={<ActionLink to="/receive-payment">Receive Payment</ActionLink>} /><ShopPaymentHistory /></div> }
