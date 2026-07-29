'use client';

/**
 * v6.99: ListingActionsBar — izvlečen iz ListingDetailModal.
 *
 * Združuje 2 akciji povezani z uporabniškimi zapiski:
 * 1. Personal Notes — /api/listings/:id/notes (PATCH notes) (v2.4)
 * 2. Contact Tracker — /api/listings/:id/notes (PATCH contactStatus + sellerResponse) (v2.4)
 *
 * Prej: ~60 vrstic inline JSX + 5 useState + 3 funkcije znotraj ListingDetailModal.
 * Sedaj: samostojna komponenta z lastnim state in funkcijami.
 *
 * API:
 * <ListingActionsBar
 *   listingId={listing.id}
 *   initialContactStatus={listing.contactStatus}
 *   initialSellerResponse={listing.sellerResponse}
 *   initialNotes={listing.userNotes}
 * />
 */

import { useState, useEffect } from 'react';
import { StickyNote, Phone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ListingActionsBarProps {
  listingId: string;
  initialContactStatus?: string;
  initialSellerResponse?: string | null;
  initialNotes?: string | null;
}

export function ListingActionsBar({ listingId, initialContactStatus, initialSellerResponse, initialNotes }: ListingActionsBarProps) {
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [contactStatus, setContactStatus] = useState('none');
  const [sellerResponse, setSellerResponse] = useState('');

  // Sync z initial vrednostmi ob odpiranju novega listinga
  useEffect(() => {
    setNotes(initialNotes ?? '');
    setContactStatus(initialContactStatus ?? 'none');
    setSellerResponse(initialSellerResponse ?? '');
  }, [listingId, initialNotes, initialContactStatus, initialSellerResponse]);

  // ===== Save notes =====
  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      await fetch(`/api/listings/${listingId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      toast.success('Opombe shranjene');
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setNotesSaving(false);
    }
  };

  // ===== Update contact status =====
  const updateContact = async (status: string) => {
    setContactStatus(status);
    try {
      await fetch(`/api/listings/${listingId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactStatus: status, sellerResponse }),
      });
      toast.success(`Status: ${status}`);
    } catch {
      toast.error('Napaka');
    }
  };

  // ===== Save seller response =====
  const saveSellerResponse = async () => {
    try {
      await fetch(`/api/listings/${listingId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerResponse }),
      });
      toast.success('Odgovor shranjen');
    } catch {
      toast.error('Napaka');
    }
  };

  return (
    <>
      {/* Personal notes (v2.4) */}
      <div className="border-t border-border pt-3">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5" />
          Moje opombe
        </h4>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="npr. Poklical sem prodajalca, razpoložljiv od petka. Dogovor za 350€."
          className="text-xs min-h-[60px]"
        />
        <Button size="sm" variant="outline" onClick={saveNotes} disabled={notesSaving} className="mt-1.5 gap-1.5 h-7 text-xs">
          {notesSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <StickyNote className="w-3 h-3" />}
          Shrani opombe
        </Button>
      </div>

      {/* Contact tracker (v2.4) */}
      <div className="border-t border-border pt-3">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5" />
          Sledenje kontakta <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.4</Badge>
        </h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {[
            { val: 'none', label: 'Ni kontakt', cls: 'border-muted text-muted-foreground' },
            { val: 'contacted', label: '📞 Kontaktiran', cls: 'border-amber-400/40 text-amber-400' },
            { val: 'responded', label: '✉️ Odgovoril', cls: 'border-primary/40 text-primary' },
            { val: 'closed', label: '✅ Zaključeno', cls: 'border-muted text-muted-foreground' },
          ].map(opt => (
            <button
              key={opt.val}
              onClick={() => updateContact(opt.val)}
              className={cn(
                'px-2 py-1 rounded border text-[10px] uppercase tracking-wider transition-colors',
                contactStatus === opt.val ? opt.cls + ' bg-card' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {contactStatus !== 'none' && (
          <>
            <Textarea
              value={sellerResponse}
              onChange={(e) => setSellerResponse(e.target.value)}
              placeholder="Kaj je prodajalec odgovoril? (npr. 'Cena je fiksna, lahko pridete v ponedeljek')"
              className="text-xs min-h-[40px]"
            />
            <Button size="sm" variant="ghost" onClick={saveSellerResponse} className="mt-1 h-6 text-xs gap-1">
              Shrani odgovor
            </Button>
          </>
        )}
      </div>
    </>
  );
}
