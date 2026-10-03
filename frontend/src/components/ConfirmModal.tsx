import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'default' | 'success';
  onConfirm: () => void;
  onCancel: () => void;
  isConfirmDisabled?: boolean;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
  onConfirm,
  onCancel,
  isConfirmDisabled = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: 'bg-loss/10 text-loss border-loss/20',
    warning: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    info: 'bg-primary/10 text-primary border-primary/20',
    default: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-profit/10 text-profit border-profit/20',
  };

  const buttonStyles = {
    danger: 'bg-loss hover:bg-loss/90 text-white',
    warning: 'bg-yellow-500 hover:bg-yellow-500/90 text-black',
    info: 'bg-primary hover:bg-primary/90 text-white',
    default: 'bg-primary hover:bg-primary/90 text-white',
    success: 'bg-profit hover:bg-profit/90 text-white',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader className={`border-b ${variantStyles[variant]}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">{message}</p>
        </CardContent>
        <CardFooter className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button 
            className={buttonStyles[variant]} 
            onClick={onConfirm}
            disabled={isConfirmDisabled}
          >
            {confirmText}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
