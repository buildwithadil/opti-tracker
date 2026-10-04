import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

function FutureModulePage({ title, description, scope }: { title: string; description: string; scope: string }) {
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Future module" title={title} description={description} />
      <Card>
        <CardHeader><CardTitle>Not available in Phase 1</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Phase 1 provides administrator access and account security only. This page is a navigation destination, not an active business module.</p>
          <p>{scope} No records are loaded, and no sample data or editing controls are shown.</p>
          <Link to="/dashboard" className="inline-flex rounded-md font-medium text-ink underline underline-offset-4 hover:no-underline">Return to workspace readiness</Link>
        </CardContent>
      </Card>
    </div>
  )
}

export function CustomersPage() {
  return <FutureModulePage title="Customers" description="Customer management is planned for a later phase." scope="Customer profiles and search will be introduced when the customer module is implemented." />
}

export function PurchasesPage() {
  return <FutureModulePage title="Purchases" description="Purchase management is planned for a later phase." scope="Purchase records and transaction workflows will be introduced when the purchase module is implemented." />
}

export function PrescriptionsPage() {
  return <FutureModulePage title="Prescriptions" description="Prescription management is planned for a later phase." scope="Prescription records and clinical workflows will be introduced when the prescription module is implemented." />
}

export function PaymentsPage() {
  return <FutureModulePage title="Payments" description="Payment management is planned for a later phase." scope="Payment records and transaction tracking will be introduced when the payment module is implemented." />
}

export function ReportsPage() {
  return <FutureModulePage title="Reports" description="Operational reporting is planned for a later phase." scope="Reports and business metrics will be introduced after the underlying business modules are implemented." />
}
