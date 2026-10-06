import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Glasses, LogOut } from 'lucide-react'
import { ApiError, authApi, clearCsrfToken } from '../lib/api'
import { cn } from '../lib/utils'
import { primaryNavigation, type NavigationItem } from '../lib/navigation'
import { Button } from './ui/Button'
import { NewSaleLink } from './ui/ShopUI'

function NavigationLink({ item, mobile = false }: { item: NavigationItem; mobile?: boolean }) {
  const Icon = item.icon
  return <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(mobile ? 'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px]' : 'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-sm', isActive ? mobile ? 'font-semibold text-accent' : 'bg-accent-tint font-semibold text-accent' : 'text-muted hover:bg-paper')}><Icon className={cn('size-5 shrink-0', mobile && 'size-[19px]')} aria-hidden="true" /><span>{item.label}</span></NavLink>
}
export function AppShell() {
  const client = useQueryClient(), navigate = useNavigate()
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  const owner = session.data?.authenticated ? session.data : undefined
  const logout = useMutation({ mutationFn: async () => { try { await authApi.logout() } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error } }, onSuccess: async () => {
    await client.cancelQueries(); clearCsrfToken(); client.clear(); navigate('/login', { replace: true })
  } })
  const brand = <div className="flex min-w-0 items-center gap-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent text-white"><Glasses className="size-5" aria-hidden="true" /></span><div className="min-w-0"><p className="font-semibold tracking-tight">OptiDesk</p><p className="truncate text-xs text-muted">{owner?.shopName || 'Your optical shop'}</p></div></div>
  const signOut = <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" loading={logout.isPending} onClick={() => logout.mutate()} icon={<LogOut className="size-4" aria-hidden="true" />}>Sign out</Button>
  return <div className="app-shell min-h-screen bg-paper">
    <a href="#main-content" className="sr-only z-50 rounded-md bg-white px-4 py-3 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-white px-4 py-5 lg:flex">{brand}<div className="mt-9"><NewSaleLink className="floating-action w-full" /></div><nav aria-label="Primary navigation" className="mt-7 space-y-1">{primaryNavigation.map(item => <NavigationLink key={item.to} item={item} />)}</nav><div className="mt-auto border-t border-line pt-5"><p className="truncate text-sm font-medium">{owner?.name}</p><p className="mb-3 truncate text-xs text-muted">{owner?.email}</p>{signOut}</div></aside>
     <div className="app-content lg:pl-60">
       <header className="shop-topbar flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 lg:hidden">{brand}{signOut}</header>
      {import.meta.env.VITE_DEMO_MODE === 'true' ? <p className="demo-banner border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Demo workspace · use test customers and sales only</p> : null}
       {logout.isError ? <p role="alert" className="px-4 py-3 text-sm text-accent">{logout.error.message}</p> : null}
        <main id="main-content" tabIndex={-1} className="app-main mx-auto w-full max-w-6xl px-4 pb-[calc(112px_+_env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:px-10 lg:py-10"><Outlet /></main>
      </div>
      <nav aria-label="Mobile primary navigation" className="bottom-navigation fixed inset-x-0 bottom-0 z-30 lg:hidden">
       <div className="pointer-events-none absolute inset-x-0 bottom-[calc(64px_+_env(safe-area-inset-bottom))] flex justify-center"><NewSaleLink aria-label="New Sale" className="pointer-events-auto floating-action rounded-full px-5 shadow-lg" /></div>
       <div className="glass-bar grid grid-cols-4 border-x-0 border-b-0 px-2"><NavigationLink item={primaryNavigation[0]} mobile /><NavigationLink item={primaryNavigation[1]} mobile /><NavigationLink item={primaryNavigation[2]} mobile /><NavigationLink item={primaryNavigation[3]} mobile /></div>
      </nav>
  </div>
}
