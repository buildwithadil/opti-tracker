import { Children, cloneElement, isValidElement, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Field({ id, label, hint, error, children, labelHidden = false }: { id: string; label: string; hint?: string; error?: string; children: ReactNode; labelHidden?: boolean }) {
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if (!error) return
    // Optional sections must reveal invalid fields before form focus is moved.
    let details=ref.current?.closest('details')
    while (details) { details.open=true; details=details.parentElement?.closest('details') ?? null }
  },[error])
  return (
    <div ref={ref} className="min-w-0">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'mb-1.5 block text-[13px] font-medium text-ink'}>{label}</label>
      {Children.map(children,child=>error && isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) ? cloneElement(child,{ 'aria-invalid': true,'aria-describedby': `${id}-error` }) : child)}
      {error ? <p id={`${id}-error`} className="mt-1.5 text-xs text-accent" role="alert">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 min-w-0 w-full rounded-[10px] border border-line bg-white px-3 text-base text-ink shadow-none placeholder:text-subtle transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-accent',
        className,
      )}
      {...props}
    />
  )
}
