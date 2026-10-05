import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Menu, X } from 'lucide-react'
import { ApiError, authApi, clearCsrfToken } from '../lib/api'
import { cn } from '../lib/utils'
import { primaryNavigation, utilityNavigation, type NavigationItem } from '../lib/navigation'
import { Button } from './ui/Button'

function Brand({ shopName }: { shopName?: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-base font-semibold text-ink">OptiDesk</span>
      <span className="mt-1 block truncate text-xs text-muted">{shopName || 'Administrator workspace'}</span>
    </div>
  )
}

function SidebarLink({ item, onNavigate }: { item: NavigationItem; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        isActive ? 'bg-paper font-semibold text-ink' : 'text-muted hover:bg-paper hover:text-ink',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  )
}

function SidebarContent({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  const administrator = session.data?.authenticated ? session.data : undefined
  const logout = useMutation({
    mutationFn: async () => {
      try {
        await authApi.logout()
      } catch (error) {
        // An expired session is already signed out; still remove its cached data.
        if (!(error instanceof ApiError && error.status === 401)) throw error
      }
    },
    onSuccess: async () => {
      await queryClient.cancelQueries()
      clearCsrfToken()
      queryClient.clear()
      onNavigate?.()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="flex h-full flex-col">
      <div className={cn('px-5 py-6', mobile && 'pr-14')}><Brand shopName={administrator?.shopName} /></div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={mobile ? 'Mobile primary navigation' : 'Primary navigation'}>
        <div className="space-y-1">{primaryNavigation.map((item) => <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />)}</div>
        <div className="mt-5 border-t border-line pt-4">{utilityNavigation.map((item) => <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />)}</div>
      </nav>
      <div className="border-t border-line px-5 py-4">
        <p className="truncate text-sm font-medium text-ink">{administrator?.name || 'Administrator'}</p>
        <p className="mt-1 truncate text-xs text-muted">{administrator?.email}</p>
        <Button className="mt-3 w-full justify-start" variant="ghost" size="sm" icon={<LogOut className="size-4" aria-hidden="true" />} loading={logout.isPending} onClick={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
        {logout.isError ? <p className="mt-2 text-xs leading-5 text-red-700" role="alert">{logout.error instanceof Error ? logout.error.message : 'Sign out failed. Please try again.'}</p> : null}
      </div>
    </div>
  )
}

export function AppShell() {
  const location = useLocation()
  const [mobilePath, setMobilePath] = useState<string | null>(null)
  const mobileOpen = mobilePath === location.pathname
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (mobileOpen && !dialog.open) dialog.showModal()
    if (!mobileOpen && dialog.open) {
      dialog.close()
      openButtonRef.current?.focus({ preventScroll: true })
    }
  }, [mobileOpen])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (desktop.matches) dialogRef.current?.close()
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const closeMobile = () => setMobilePath(null)

  return (
    <div className="app-shell min-h-screen bg-paper">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-white px-4 py-3 text-sm text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-line bg-white lg:block"><SidebarContent /></aside>
      {/* Native modal dialogs make the background inert, contain keyboard focus,
          support Escape, and restore focus to the navigation trigger. */}
      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        className="mobile-navigation fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(85vw,300px)] max-w-none border-0 border-r border-line bg-white p-0 text-ink"
        aria-labelledby="mobile-navigation-title"
        onCancel={closeMobile}
        onClose={closeMobile}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeMobile()
        }}
      >
        <h2 id="mobile-navigation-title" className="sr-only">Workspace navigation</h2>
        <button type="button" autoFocus className="absolute right-3 top-4 flex size-9 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink" onClick={closeMobile} aria-label="Close navigation">
          <X className="size-5" aria-hidden="true" />
        </button>
        {mobileOpen ? <SidebarContent mobile onNavigate={closeMobile} /> : null}
      </dialog>
      <div className="app-content lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white px-4 sm:px-6 lg:hidden">
          <Brand />
          <button ref={openButtonRef} type="button" className="flex size-10 items-center justify-center rounded-md text-ink hover:bg-paper" onClick={() => setMobilePath(location.pathname)} aria-label="Open navigation" aria-haspopup="dialog" aria-controls="mobile-navigation" aria-expanded={mobileOpen}>
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </header>
        <main id="main-content" tabIndex={-1} className="app-main mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10"><Outlet /></main>
      </div>
    </div>
  )
}
