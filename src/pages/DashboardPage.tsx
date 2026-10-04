import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import { primaryNavigation } from '../lib/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

export function DashboardPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  const administrator = session.data?.authenticated ? session.data : undefined

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Phase 2" title="Workspace readiness" description="Administrator access and customer management are available. Purchases, prescriptions, payments, and reports remain planned for later phases." />
      <Card>
        <CardHeader><CardTitle>Administrator access is ready</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>You are signed in{administrator ? ` as ${administrator.name}` : ''}{administrator?.shopName ? ` to ${administrator.shopName}` : ''}.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>One-time administrator setup and email/password sign in.</li>
            <li>Secure sessions, sign out, and password changes.</li>
            <li>Read-only shop and administrator identity.</li>
          </ul>
          <Link className="inline-flex rounded-md font-medium text-ink underline underline-offset-4 hover:no-underline" to="/settings">Open account settings</Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Customer management is ready</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted">
          <p>Search customer records, create profiles, update contact details, and archive or restore customers. Profiles show real contact information and dates, not sample records or financial metrics.</p>
          <Link className="inline-flex rounded-md font-medium text-ink underline underline-offset-4 hover:no-underline" to="/customers">Open customers</Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Future business modules</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted">These routes are included for navigation only. They do not request unavailable business APIs, display sample data, or offer record-editing forms.</p>
          <ul className="divide-y divide-line">
            {primaryNavigation.filter((item) => item.to !== '/dashboard' && item.to !== '/customers').map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-3 text-sm font-medium text-ink hover:bg-paper">
                  <span>{item.label}</span><span className="text-xs font-normal text-muted">Planned · not available in Phase 2</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
