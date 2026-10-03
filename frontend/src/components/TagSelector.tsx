import { useState, useEffect, useRef } from 'react';
import type { TradeTag, EventTag } from '@/types';
import { api } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, Tag } from 'lucide-react';

interface TagSelectorProps<T extends TradeTag | EventTag> {
  selectedTags: T[];
  onChange: (tags: T[]) => void;
  disabled?: boolean;
  tagType?: 'trade' | 'event';
  placeholder?: string;
}

export function TagSelector<T extends TradeTag | EventTag>({ selectedTags, onChange, disabled, tagType = 'trade', placeholder }: TagSelectorProps<T>) {
  const [allTags, setAllTags] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        setLoading(true);
        if (tagType === 'event') {
          const response = await api.getEventTags();
          if (response.success) {
            setAllTags(response.data as T[]);
          }
        } else {
          const response = await api.getTags();
          if (response.success) {
            setAllTags(response.data as T[]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch tags:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTags();
  }, [tagType]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleTag = (tag: T) => {
    const isSelected = selectedTags.some(t => t.id === tag.id);
    if (isSelected) {
      onChange(selectedTags.filter(t => t.id !== tag.id));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  const removeTag = (tagId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedTags.filter(t => t.id !== tagId));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tags...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected Tags Display */}
      <div
        className={`flex flex-wrap gap-2 min-h-[38px] p-2 border rounded-md cursor-pointer hover:border-ring ${isOpen ? 'ring-2 ring-ring ring-offset-2' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        {selectedTags.length === 0 ? (
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Tag className="h-4 w-4" />
            {placeholder || 'Click to add tags...'}
          </span>
        ) : (
          selectedTags.map(tag => (
            <Badge
              key={tag.id}
              style={{ backgroundColor: tag.color, color: '#fff' }}
              className="flex items-center gap-1 px-2 py-1"
            >
              {tag.name}
              {!disabled && (
                <button
                  onClick={(e) => removeTag(tag.id, e)}
                  className="ml-1 hover:opacity-70"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))
        )}
      </div>

      {/* Dropdown - position:fixed to escape overflow clipping */}
      {isOpen && !disabled && (
        <DropdownList
          allTags={allTags}
          selectedTags={selectedTags}
          toggleTag={toggleTag}
          tagType={tagType}
        />
      )}
    </div>
  );
}

// Separate component so its ref is stable and not recreated on parent re-renders
function DropdownList<T extends TradeTag | EventTag>({
  allTags,
  selectedTags,
  toggleTag,
  tagType,
}: {
  allTags: T[];
  selectedTags: T[];
  toggleTag: (tag: T) => void;
  tagType: 'trade' | 'event';
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dropdownRef.current;
    if (!el) return;

    // Position the dropdown below the trigger using the trigger's bounding rect.
    // Measure the trigger div (first child of the relative wrapper) rather than
    // the wrapper itself, because the wrapper currently includes this dropdown
    // in its height before we switch it to fixed positioning.
    const trigger = el.parentElement?.firstElementChild as HTMLElement | null;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.top = `${rect.bottom + 4}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.zIndex = '9999';
  }, []);

  return (
    <div
      ref={dropdownRef}
      onMouseDown={(e) => e.stopPropagation()}
      className="bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
    >
      {allTags.length === 0 ? (
        <div className="p-3 text-sm text-muted-foreground text-center">
          No tags available. Create {tagType} tags in Settings.
        </div>
      ) : (
        <div className="p-2">
          {allTags.map(tag => {
            const isSelected = selectedTags.some(t => t.id === tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm hover:bg-accent ${isSelected ? 'bg-accent' : ''}`}
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="flex-1 text-left">{tag.name}</span>
                {isSelected && <span className="text-xs text-muted-foreground">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TagDisplayProps<T extends TradeTag | EventTag> {
  tags: T[];
  maxDisplay?: number;
}

export function TagDisplay<T extends TradeTag | EventTag>({ tags, maxDisplay = 3 }: TagDisplayProps<T>) {
  if (!tags || tags.length === 0) return null;

  const displayTags = tags.slice(0, maxDisplay);
  const remaining = tags.length - maxDisplay;

  return (
    <div className="flex flex-wrap gap-1">
      {displayTags.map(tag => (
        <Badge
          key={tag.id}
          style={{ backgroundColor: tag.color, color: '#fff' }}
          className="text-xs px-1.5 py-0.5"
          title={tag.description}
        >
          {tag.name}
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge variant="outline" className="text-xs px-1.5 py-0.5">
          +{remaining}
        </Badge>
      )}
    </div>
  );
}

export default TagSelector;
