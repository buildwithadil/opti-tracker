import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="mt-1.5 text-xs text-red-700" role="alert">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-700',
        className,
      )}
      {...props}
    />
  )
}
