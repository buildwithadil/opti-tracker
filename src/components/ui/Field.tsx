import { Children, cloneElement, isValidElement, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if (!error) return
    // Optional sections must reveal invalid fields before form focus is moved.
    let details=ref.current?.closest('details')
    while (details) { details.open=true; details=details.parentElement?.closest('details') ?? null }
  },[error])
  return (
    <div ref={ref} className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">{label}</label>
      {Children.map(children,child=>error && isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) ? cloneElement(child,{ 'aria-invalid': true,'aria-describedby': `${id}-error` }) : child)}
      {error ? <p id={`${id}-error`} className="mt-1.5 text-xs text-red-700" role="alert">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-12 min-w-0 w-full rounded-xl border border-line bg-white px-3 text-base text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-700',
        className,
      )}
      {...props}
    />
  )
}
