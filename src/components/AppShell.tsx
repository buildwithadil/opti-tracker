import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Glasses, LogOut, Plus } from 'lucide-react'
import { ApiError, authApi, clearCsrfToken } from '../lib/api'
import { cn } from '../lib/utils'
import { primaryNavigation, type NavigationItem } from '../lib/navigation'
import { Button } from './ui/Button'
import { NewSaleLink } from './ui/ShopUI'

function NavigationLink({ item, mobile = false }: { item: NavigationItem; mobile?: boolean }) {
  const Icon = item.icon
  return <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(mobile ? 'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs' : 'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm', isActive ? 'bg-accent/8 font-semibold text-accent' : 'text-muted hover:bg-paper')}><Icon className="size-5 shrink-0" aria-hidden="true" /><span>{item.label}</span></NavLink>
}
export function AppShell() {
  const client = useQueryClient(), navigate = useNavigate()
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  const owner = session.data?.authenticated ? session.data : undefined
  const logout = useMutation({ mutationFn: async () => { try { await authApi.logout() } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error } }, onSuccess: async () => {
    await client.cancelQueries(); clearCsrfToken(); client.clear(); navigate('/login', { replace: true })
  } })
  const brand = <div className="flex min-w-0 items-center gap-2.5"><Glasses className="size-7 shrink-0 text-accent" aria-hidden="true" /><div className="min-w-0"><p className="font-semibold tracking-tight">OptiDesk</p><p className="truncate text-xs text-muted">{owner?.shopName || 'Your optical shop'}</p></div></div>
  const signOut = <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()} icon={<LogOut className="size-4" aria-hidden="true" />}>Sign out</Button>
  return <div className="app-shell min-h-screen bg-paper">
    <a href="#main-content" className="sr-only z-50 rounded-md bg-white px-4 py-3 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
    <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-white p-5 lg:flex">{brand}<div className="mt-8"><NewSaleLink className="w-full" /></div><nav aria-label="Primary navigation" className="mt-6 space-y-2">{primaryNavigation.map(item => <NavigationLink key={item.to} item={item} />)}</nav><div className="mt-auto border-t border-line pt-5"><p className="truncate text-sm font-medium">{owner?.name}</p><p className="mb-3 truncate text-xs text-muted">{owner?.email}</p>{signOut}</div></aside>
    <div className="app-content lg:pl-56">
      <header className="shop-topbar flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 lg:hidden">{brand}{signOut}</header>
      {import.meta.env.VITE_DEMO_MODE === 'true' ? <p className="demo-banner border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Demo workspace · use test customers and sales only</p> : null}
      {logout.isError ? <p role="alert" className="px-4 py-3 text-sm text-red-700">{logout.error.message}</p> : null}
      <main id="main-content" tabIndex={-1} className="app-main mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(100px_+_env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8"><Outlet /></main>
    </div>
    <nav aria-label="Mobile primary navigation" className="bottom-navigation fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white lg:hidden">
      {primaryNavigation.slice(0,2).map(item => <NavigationLink key={item.to} item={item} mobile />)}
      <NavLink to="/sales/new" aria-label="New Sale" className="flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold text-accent"><span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-white"><Plus className="size-6" aria-hidden="true" /></span><span>New Sale</span></NavLink>
      {primaryNavigation.slice(2).map(item => <NavigationLink key={item.to} item={item} mobile />)}
    </nav>
  </div>
}
