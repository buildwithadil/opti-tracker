import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export function ConfirmationDialog({
  open, title, description, confirmLabel, cancelLabel = 'Cancel', danger = false,
  pending = false, error, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  pending?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const id = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog m-auto w-[calc(100%_-_2rem)] max-w-md rounded-lg border border-line bg-white p-6 text-ink shadow-lg"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
      <div id={`${id}-description`} className="mt-3 text-sm leading-6 text-muted">{description}</div>
      {error ? <p className="mt-4 text-sm leading-6 text-red-700" role="alert">{error}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button autoFocus variant="secondary" disabled={pending} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  )
}
