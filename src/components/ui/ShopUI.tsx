import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

export const actionClass = 'inline-flex min-h-12 max-w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90'
export function ActionLink({ secondary, className, ...props }: LinkProps & { secondary?: boolean }) {
  return <Link className={cn(actionClass, secondary && 'border border-line bg-white text-ink hover:bg-paper', className)} {...props} />
}
export function NewSaleLink({ customer, className }: { customer?: string; className?: string }) {
  return <ActionLink to={customer ? `/sales/new?customer=${customer}` : '/sales/new'} className={className}><Plus className="size-5" aria-hidden="true" />New Sale</ActionLink>
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-white px-5 py-9 text-center"><h2 className="font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>{action ? <div className="mt-5">{action}</div> : null}</div>
}
export function Disclosure({ title, children, invalid=false, initiallyOpen=false, className='' }: { title: string; children: ReactNode; invalid?: boolean; initiallyOpen?: boolean; className?: string }) {
  const [expanded,setExpanded]=useState(initiallyOpen)
  return <details className={cn('rounded-xl border border-line p-4',className)} open={expanded || invalid} onToggle={event=>setExpanded(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer text-sm font-semibold">{title}</summary><div className="mt-4 space-y-4">{children}</div></details>
}
export function Sheet({ open, title, children, onClose, pending = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; pending?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLElement>('[autofocus], input:not([type="hidden"]), select, textarea')?.focus()
    return () => { if (dialog.open) dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [open])
  return <dialog ref={ref} className="shop-sheet" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!pending) onClose() }}>
    <div className="mb-5 flex items-center justify-between gap-3"><h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2><Button variant="ghost" disabled={pending} onClick={onClose} aria-label={`Close ${title}`}><X className="size-5" aria-hidden="true" /></Button></div>{children}
  </dialog>
}
export function Tabs({ tabs, value, onChange, label, panelId }: { tabs: string[]; value: string; onChange: (value: string) => void; label: string; panelId?: string }) {
  const id = useId()
  return <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 rounded-xl bg-line/60 p-1">{tabs.map((tab, index) => <button key={tab} id={`${id}-${tab}`} type="button" role="tab" aria-selected={value === tab} aria-controls={panelId} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)} onKeyDown={event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[next]); document.getElementById(`${id}-${tabs[next]}`)?.focus()
  }} className={cn('min-h-11 min-w-0 flex-1 rounded-lg px-1 text-sm font-medium', value === tab ? 'bg-white text-ink shadow-sm' : 'text-muted')}>{tab}</button>)}</div>
}
export function Pagination({ page, pagination, onPage, busy = false, label = 'Pagination' }: { page: number; pagination: { totalPages: number; total: number }; onPage: (page: number) => void; busy?: boolean; label?: string }) {
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 py-3"><p className="text-sm text-muted">{pagination.total} records · Page {page} of {pagination.totalPages}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page-1)}><ChevronLeft className="size-4" aria-hidden="true" />Previous</Button><Button variant="secondary" size="sm" disabled={page >= Math.min(pagination.totalPages,10000) || busy} onClick={() => onPage(page+1)}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button></div></nav>
}
