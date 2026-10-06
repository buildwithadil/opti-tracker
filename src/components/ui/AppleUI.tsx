import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Section({ title, action, children, className, ...props }: HTMLAttributes<HTMLElement> & { title?: string; action?: ReactNode }) {
  return (
    <section className={cn('space-y-3', className)} {...props}>
      {title || action ? <div className="flex items-center justify-between gap-4"><h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>{action}</div> : null}
      {children}
    </section>
  )
}

export function List({ children, className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('hairline-list border-y border-line bg-white', className)} {...props}>{children}</ul>
}

export function ListRow({ children, className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn('touch-row px-4 sm:px-5', className)} {...props}>{children}</li>
}

export function GlassBar({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass-bar', className)} {...props}>{children}</div>
}

export function StatusText({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-sm text-muted', className)} {...props}>{children}</span>
}
