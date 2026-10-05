import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../lib/utils'

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-28 items-center justify-center gap-3 border-y border-line bg-transparent p-6', className)} role="status">
      <LoaderCircle className="size-5 animate-spin text-muted" aria-hidden="true" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  )
}

export function ErrorState({
  title = 'Unable to load this page',
  description,
  onRetry,
  className,
}: {
  title?: string
  description: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('border-y border-line bg-transparent px-6 py-8 text-center', className)} role="alert">
      <AlertCircle className="mx-auto mb-3 size-5 text-muted" aria-hidden="true" />
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {onRetry ? (
        <Button className="mt-5" size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" aria-hidden="true" />} onClick={onRetry}>Try again</Button>
      ) : null}
    </div>
  )
}
