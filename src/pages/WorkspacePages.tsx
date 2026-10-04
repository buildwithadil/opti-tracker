import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

function FutureModulePage({ title, description, scope }: { title: string; description: string; scope: string }) {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Future module" title={title} description={description} />
      <Card>
        <CardHeader><CardTitle>Not available in Phase 3</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Administrator access, account security, customer management and prescriptions are available. This page remains a navigation destination, not an active business module.</p>
          <p>{scope} No records are loaded, and no sample data or editing controls are shown.</p>
          <Link to="/dashboard" className="inline-flex rounded-md font-medium text-ink underline underline-offset-4 hover:no-underline">Return to workspace readiness</Link>
        </CardContent>
      </Card>
    </div>
  )
}

export function PurchasesPage() {
  return <FutureModulePage title="Purchases" description="Purchase management is planned for a later phase." scope="Purchase records and transaction workflows will be introduced when the purchase module is implemented." />
}

export function PrescriptionsPage() {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Prescription management" title="Prescriptions" description="Choose an existing customer to view prescription history or record a supplied spectacle prescription." />
      <Card>
        <CardHeader><CardTitle>Start from a customer profile</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Prescriptions belong to a customer. Open a profile from Customers to view every recorded version, add a prescription or revise a current one. Revisions preserve previous values in history.</p>
          <p>Archived customers’ histories remain readable. Restore the customer before adding or revising records. Purchases and dispensing workflows are not available in this phase.</p>
          <Link to="/customers" className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90">Choose customer</Link>
        </CardContent>
      </Card>
    </div>
  )
}

export function PaymentsPage() {
  return <FutureModulePage title="Payments" description="Payment management is planned for a later phase." scope="Payment records and transaction tracking will be introduced when the payment module is implemented." />
}

export function ReportsPage() {
  return <FutureModulePage title="Reports" description="Operational reporting is planned for a later phase." scope="Reports and business metrics will be introduced after the underlying business modules are implemented." />
}
