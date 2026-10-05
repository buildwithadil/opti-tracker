import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3 sm:items-end">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-2 text-sm font-medium text-muted">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink [overflow-wrap:anywhere]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
