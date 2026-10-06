import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

export const actionClass = 'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 active:bg-accent/80'
export function ActionLink({ secondary, quiet, className, ...props }: LinkProps & { secondary?: boolean; quiet?: boolean }) {
  return <Link className={cn(quiet ? 'text-action' : actionClass, !quiet && secondary && 'border border-line bg-transparent text-ink hover:bg-line/40', className)} {...props} />
}
export function NewSaleLink({ customer, className, ...props }: Omit<LinkProps, 'to'> & { customer?: string; className?: string }) {
  return <ActionLink {...props} to={customer ? `/sales/new?customer=${customer}` : '/sales/new'} className={className}><Plus className="size-5" aria-hidden="true" />New Sale</ActionLink>
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="border-y border-line px-5 py-10 text-center"><h2 className="font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>{action ? <div className="mt-5">{action}</div> : null}</div>
}
export function Disclosure({ title, children, invalid=false, initiallyOpen=false, className='' }: { title: string; children: ReactNode; invalid?: boolean; initiallyOpen?: boolean; className?: string }) {
  const [expanded,setExpanded]=useState(initiallyOpen)
  return <details className={cn('border-y border-line py-3',className)} open={expanded || invalid} onToggle={event=>setExpanded(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{title}</summary><div className="space-y-4 pb-3 pt-2">{children}</div></details>
}
export type SheetConfirmation = { title: string; description: string; onCancel: () => void; onConfirm: () => void; pending?: boolean }
export function Sheet({ open, title, children, onClose, pending = false, confirmation }: { open: boolean; title: string; children: ReactNode; onClose: () => void; pending?: boolean; confirmation?: SheetConfirmation }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  const confirming = !!confirmation
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLElement>('[autofocus], input:not([type="hidden"]), select, textarea')?.focus()
    return () => { if (dialog.open) dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [open])
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>(confirming ? '[data-keep-editing]' : 'input:not([type="hidden"]), select, textarea')?.focus()
  }, [open, confirming])
  return <dialog ref={ref} className="shop-sheet" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (confirmation) confirmation.onCancel(); else if (!pending) onClose() }}>
    <div className="mb-5 flex items-center justify-between gap-3"><h2 id={id} className="text-xl font-semibold tracking-tight">{confirmation?.title ?? title}</h2>{!confirmation ? <Button variant="ghost" size="sm" disabled={pending} onClick={onClose} aria-label={`Close ${title}`}><X className="size-5" aria-hidden="true" /></Button> : null}</div>
    {/* Keep the draft mounted while confirming; one modal surface, no lost fields. */}
    <div hidden={confirming}>{children}</div>
    {confirmation ? <div><p className="text-sm leading-6 text-muted">{confirmation.description}</p><div className="mt-6 flex flex-wrap justify-end gap-2"><Button data-keep-editing variant="secondary" onClick={confirmation.onCancel}>Keep editing</Button><Button variant="danger" disabled={pending || confirmation.pending} onClick={confirmation.onConfirm}>Discard changes</Button></div></div> : null}
  </dialog>
}
export function Tabs({ tabs, value, onChange, label, panelId }: { tabs: string[]; value: string; onChange: (value: string) => void; label: string; panelId?: string }) {
  const id = useId()
  return <div role="tablist" aria-label={label} className="segmented-tabs flex min-w-0 gap-5 overflow-x-auto border-b border-line">{tabs.map((tab, index) => <button key={tab} id={`${id}-${tab}`} type="button" role="tab" aria-selected={value === tab} aria-controls={panelId} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)} onKeyDown={event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[next]); document.getElementById(`${id}-${tabs[next]}`)?.focus()
  }} className={cn('relative min-h-11 shrink-0 px-0.5 text-sm font-medium after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:transition-colors', value === tab ? 'text-ink after:bg-accent' : 'text-muted after:bg-transparent')}>{tab}</button>)}</div>
}
export function Pagination({ page, pagination, onPage, busy = false, label = 'Pagination' }: { page: number; pagination: { totalPages: number; total: number }; onPage: (page: number) => void; busy?: boolean; label?: string }) {
  if (pagination.totalPages <= 1) return null
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 py-3"><p className="text-sm text-muted">{pagination.total} records · Page {page} of {pagination.totalPages}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page-1)}><ChevronLeft className="size-4" aria-hidden="true" />Previous</Button><Button variant="secondary" size="sm" disabled={page >= Math.min(pagination.totalPages,10000) || busy} onClick={() => onPage(page+1)}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button></div></nav>
}
