import { Button, Modal } from './ui'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  )
}
