import { Button } from './button';
import { ErrorSummary } from './error-summary';
import { Modal } from './modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  cancelLabel = 'Quay lại',
  confirmLabel = 'Xác nhận',
  description,
  destructive = false,
  error,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <Modal
      description={description}
      footer={
        <>
          <Button disabled={loading} onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            loading={loading}
            onClick={onConfirm}
            variant={destructive ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      size="sm"
      title={title}
    >
      {error ? <ErrorSummary message={error} /> : null}
    </Modal>
  );
}
