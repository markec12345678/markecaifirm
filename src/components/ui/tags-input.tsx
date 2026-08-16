'use client';

// v8.63: Reusable TagsInput — multi-value tag input with autocomplete.
// Used by TradeFormDialog (and anywhere a list of tags is needed).

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Suggestions shown as clickable chips below the input. */
  suggestions?: string[];
  /** Placeholder for the input. */
  placeholder?: string;
  /** Max number of tags allowed. */
  max?: number;
  /** Disabled state. */
  disabled?: boolean;
  className?: string;
}

export function TagsInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Dodaj tag in pritisni Enter…',
  max,
  disabled = false,
  className,
}: TagsInputProps) {
  const [input, setInput] = React.useState('');

  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

  const addTag = (raw: string) => {
    const tag = normalize(raw);
    if (!tag) return;
    if (value.includes(tag)) return;
    if (max && value.length >= max) return;
    onChange([...value, tag]);
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(value.filter(t => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      // Remove last tag on backspace
      removeTag(value[value.length - 1]);
    }
  };

  // Suggestions not yet selected
  const availableSuggestions = suggestions
    .filter(s => !value.includes(s))
    .slice(0, 8);

  const atMax = max != null && value.length >= max;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
        {value.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            <span className="text-xs">#{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                aria-label={`Odstrani tag ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addTag(input)}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled || atMax}
          className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground/60 text-sm disabled:cursor-not-allowed"
        />
        {input.trim() && !atMax && (
          <button
            type="button"
            onClick={() => addTag(input)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dodaj tag"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {availableSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {availableSuggestions.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              disabled={disabled || atMax}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded px-1.5 py-0.5 border border-dashed border-muted-foreground/30 transition-colors disabled:opacity-50"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {max != null && (
        <div className="text-xs text-muted-foreground">
          {value.length}/{max} tagov
        </div>
      )}
    </div>
  );
}
