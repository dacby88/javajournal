import { useState } from 'react';
import { Camera, Check, Download, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toPng } from 'html-to-image';

interface SnapshotButtonProps {
  targetRef: React.RefObject<HTMLElement | null>;
}

export function SnapshotButton({ targetRef }: SnapshotButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const captureSnapshot = async () => {
    if (!targetRef.current) return;

    setIsCapturing(true);
    try {
      const target = targetRef.current;
      
      // Use the visible viewport width (what's actually shown in browser)
      // This ensures we capture exactly what the user sees
      const width = window.innerWidth;
      const height = target.scrollHeight;

      const dataUrl = await toPng(target, {
        quality: 0.95,
        backgroundColor: '#1a1a1a',
        width: width,
        height: height,
        cacheBust: true,
        pixelRatio: window.devicePixelRatio || 1,
        style: {
          width: `${width}px`,
          transform: 'none',
          transformOrigin: 'top left',
        },
      });
      setImageUrl(dataUrl);
      setIsOpen(true);
    } catch (error) {
      console.error('Failed to capture snapshot:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  const downloadImage = () => {
    if (!imageUrl) return;

    const link = document.createElement('a');
    link.download = `trading-dashboard-${new Date().toISOString().split('T')[0]}.png`;
    link.href = imageUrl;
    link.click();
  };

  const copyToClipboard = async () => {
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback: try to copy the data URL
      try {
        await navigator.clipboard.writeText(imageUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error('Fallback copy failed:', e);
      }
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={captureSnapshot}
        disabled={isCapturing}
        className="flex items-center gap-2"
      >
        {isCapturing ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Capturing...
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" />
            Snapshot
          </>
        )}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Snapshot Preview</DialogTitle>
            <DialogDescription>
              Your dashboard snapshot is ready. You can copy it to clipboard or download it.
            </DialogDescription>
          </DialogHeader>

          {imageUrl && (
            <div className="space-y-4">
              <div className="border border-border rounded-lg overflow-hidden bg-background">
                <img
                  src={imageUrl}
                  alt="Dashboard Snapshot"
                  className="w-full h-auto max-h-[60vh] object-contain"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={copyToClipboard}
                  className="flex items-center gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy to Clipboard
                    </>
                  )}
                </Button>
                <Button
                  onClick={downloadImage}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Image
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
