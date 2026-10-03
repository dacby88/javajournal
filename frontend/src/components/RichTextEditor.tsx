import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Bold, 
  Italic, 
  Underline, 
  List, 
  ListOrdered, 
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Heading1,
  Heading2,
  Quote,
  Undo,
  Redo,
  Link,
  Unlink
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({ value, onChange, placeholder, className = '' }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUpdatingRef = useRef(false);

  // Initialize editor content only once
  useEffect(() => {
    if (editorRef.current && !isUpdatingRef.current) {
      const currentHtml = editorRef.current.innerHTML;
      // Only update if content is different and not empty
      if (currentHtml !== value && !(currentHtml === '<br>' && value === '')) {
        editorRef.current.innerHTML = value || '<br>';
      }
    }
  }, [value]);

  const execCommand = useCallback((command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      isUpdatingRef.current = true;
      onChange(editorRef.current.innerHTML);
      // Reset flag after a short delay
      setTimeout(() => { isUpdatingRef.current = false; }, 0);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (editorRef.current && !isUpdatingRef.current) {
      isUpdatingRef.current = true;
      onChange(editorRef.current.innerHTML);
      setTimeout(() => { isUpdatingRef.current = false; }, 0);
    }
  }, [onChange]);

  // Handle paste events for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasImage = false;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (item.type.indexOf('image') !== -1) {
        hasImage = true;
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target?.result as string;
            if (base64) {
              execCommand('insertImage', base64);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    }
    
    // If no image was pasted, let the default paste happen but update state
    if (!hasImage) {
      // Allow default paste behavior for text
      setTimeout(() => {
        if (editorRef.current) {
          isUpdatingRef.current = true;
          onChange(editorRef.current.innerHTML);
          setTimeout(() => { isUpdatingRef.current = false; }, 0);
        }
      }, 0);
    }
  }, [execCommand, onChange]);

  // Handle image upload
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        if (base64) {
          execCommand('insertImage', base64);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [execCommand]);

  // Insert link
  const insertLink = useCallback(() => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  }, [execCommand]);

  return (
    <div className={`border rounded-md flex flex-col ${isFocused ? 'ring-2 ring-ring ring-offset-2' : ''} ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/50">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('undo')}
            title="Undo"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('redo')}
            title="Redo"
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>
        
        <Separator orientation="vertical" className="h-6 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('formatBlock', 'H1')}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('formatBlock', 'H2')}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </Button>
        </div>
        
        <Separator orientation="vertical" className="h-6 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('bold')}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('italic')}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('underline')}
            title="Underline"
          >
            <Underline className="h-4 w-4" />
          </Button>
        </div>
        
        <Separator orientation="vertical" className="h-6 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('justifyLeft')}
            title="Align Left"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('justifyCenter')}
            title="Align Center"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('justifyRight')}
            title="Align Right"
          >
            <AlignRight className="h-4 w-4" />
          </Button>
        </div>
        
        <Separator orientation="vertical" className="h-6 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('insertUnorderedList')}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('insertOrderedList')}
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('formatBlock', 'BLOCKQUOTE')}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </Button>
        </div>
        
        <Separator orientation="vertical" className="h-6 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={insertLink}
            title="Insert Link"
          >
            <Link className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => execCommand('unlink')}
            title="Remove Link"
          >
            <Unlink className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => fileInputRef.current?.click()}
            title="Insert Image"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>
      </div>
      
      {/* Editor */}
      <div className="flex-1 relative">
        <div
          ref={editorRef}
          className="min-h-[300px] p-4 outline-none overflow-y-auto"
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{ minHeight: '300px' }}
        />
        {!value && !isFocused && (
          <div className="absolute top-4 left-4 text-muted-foreground pointer-events-none">
            {placeholder || 'Write your journal entry here...'}
          </div>
        )}
      </div>
      
      {/* Hint */}
      <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
        Paste images directly or use the image button. Supports bold, italic, lists, and more.
      </div>
    </div>
  );
}

export default RichTextEditor;
