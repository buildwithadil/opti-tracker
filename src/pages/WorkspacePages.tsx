import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

function FutureModulePage({ title, description, scope }: { title: string; description: string; scope: string }) {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Future module" title={title} description={description} />
      <Card>
        <CardHeader><CardTitle>Not available in Phase 6</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Administrator access, account security, customers, prescriptions, purchases and payments are available. This page remains a navigation destination, not an active business module.</p>
          <p>{scope} No records are loaded, and no sample data or editing controls are shown.</p>
          <Link to="/dashboard" className="inline-flex rounded-md font-medium text-ink underline underline-offset-4 hover:no-underline">Return to workspace readiness</Link>
        </CardContent>
      </Card>
    </div>
  )
}

export function PurchasesPage() {
  return <div className="space-y-7"><PageHeader eyebrow="Purchase management" title="Purchases" description="Choose an existing customer to record a purchase or view their purchase history." /><Card><CardHeader><CardTitle>Start from a customer profile</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-muted"><p>Open a customer profile to add multiple items, link a specific prescription and view original prices and totals. Saved purchases are immutable.</p><Link to="/customers" className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90">Choose customer</Link></CardContent></Card></div>
}

export function PrescriptionsPage() {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Prescription management" title="Prescriptions" description="Choose an existing customer to view prescription history or record a supplied spectacle prescription." />
      <Card>
        <CardHeader><CardTitle>Start from a customer profile</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Prescriptions belong to a customer. Open a profile from Customers to view every recorded version, add a prescription or revise a current one. Revisions preserve previous values in history.</p>
          <p>Archived customers’ histories remain readable. Restore the customer before adding or revising records. Purchases may link a specific prescription version from the customer profile.</p>
          <Link to="/customers" className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90">Choose customer</Link>
        </CardContent>
      </Card>
    </div>
  )
}

export function PaymentsPage() {
  return <div className="space-y-7"><PageHeader eyebrow="Payments and credit" title="Payments" description="Open an existing customer's purchase to record a payment or view payment history." /><Card><CardHeader><CardTitle>Start from a customer profile</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-muted"><p>Customer profiles show outstanding credit and purchase payment statuses. Open a purchase to record partial or full Cash, UPI or Card payments. Every payment remains a separate historical record.</p><Link to="/customers" className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90">Choose customer</Link></CardContent></Card></div>
}

export function ReportsPage() {
  return <FutureModulePage title="Reports" description="Operational reporting is planned for a later phase." scope="Reports and business metrics will be introduced after the underlying business modules are implemented." />
}
