'use client';

// v4.9: ProfileSwitcher — switch between profiles in header
// Shows current profile + dropdown to switch or manage profiles

import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Layers, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Profile {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  monitorsCount: number;
  tradesCount: number;
}

export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('📁');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles || []);
        setActiveProfileId(data.activeProfileId);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchProfile = async (id: string | null) => {
    try {
      const res = await fetch('/api/profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProfileId: id }),
      });
      if (res.ok) {
        setActiveProfileId(id);
        const name = id ? profiles.find(p => p.id === id)?.name : 'Vsi podatki';
        toast.success(`Profil: ${name}`);
        setOpen(false);
        // Reload page to refresh all data with new profile filter
        setTimeout(() => window.location.reload(), 500);
      }
    } catch {
      toast.error('Napaka pri preklopu profila');
    }
  };

  const createProfile = async () => {
    if (!newName.trim()) {
      toast.error('Ime je obvezno');
      return;
    }
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, icon: newIcon }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Profil "${newName}" ustvarjen`);
        setNewName('');
        setNewIcon('📁');
        setShowCreate(false);
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch {
      toast.error('Napaka');
    }
  };

  const deleteProfile = async (id: string, name: string) => {
    if (!confirm(`Izbrišem profil "${name}"? Monitorji in tradei bodo ostali, ampak brez profila.`)) return;
    try {
      const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Profil "${name}" izbrisan`);
        if (activeProfileId === id) {
          setActiveProfileId(null);
          setTimeout(() => window.location.reload(), 500);
        }
        await load();
      }
    } catch {
      toast.error('Napaka');
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/profiles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName }),
      });
      if (res.ok) {
        toast.success('Profil posodobljen');
        setEditingId(null);
        await load();
      }
    } catch {
      toast.error('Napaka');
    }
  };

  const activeProfile = profiles.find(p => p.id === activeProfileId);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-card/50 hover:border-primary/30 hover:text-primary transition-colors text-xs"
        title={activeProfile ? `Aktivni profil: ${activeProfile.name}` : 'Vsi podatki (brez profila)'}
      >
        <Layers className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{activeProfile ? `${activeProfile.icon} ${activeProfile.name}` : 'Vsi'}</span>
        <span className="sm:hidden">{activeProfile?.icon || '📊'}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profil</div>
          </div>

          {/* "All" option */}
          <button
            onClick={() => switchProfile(null)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-card/70 transition-colors text-left',
              !activeProfileId && 'bg-primary/10 text-primary'
            )}
          >
            <span className="text-lg">📊</span>
            <div className="flex-1">
              <div className="font-medium">Vsi podatki</div>
              <div className="text-[10px] text-muted-foreground">Brez filtra profila</div>
            </div>
            {!activeProfileId && <Check className="w-3.5 h-3.5" />}
          </button>

          {/* Profile list */}
          {profiles.map(p => (
            <div key={p.id} className="border-t border-border/50">
              {editingId === p.id ? (
                <div className="p-2 flex items-center gap-1">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs"
                    autoFocus
                  />
                  <button onClick={() => saveEdit(p.id)} className="text-primary hover:bg-primary/10 p-1 rounded">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:bg-card/70 p-1 rounded">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center">
                  <button
                    onClick={() => switchProfile(p.id)}
                    className={cn(
                      'flex-1 flex items-center gap-2 px-3 py-2 text-xs hover:bg-card/70 transition-colors text-left',
                      activeProfileId === p.id && 'bg-primary/10 text-primary'
                    )}
                  >
                    <span className="text-lg">{p.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.monitorsCount} monitorjev • {p.tradesCount} tradeov
                      </div>
                    </div>
                    {activeProfileId === p.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                  <div className="flex items-center pr-1">
                    <button
                      onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                      className="text-muted-foreground hover:text-primary p-1"
                      title="Uredi"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => deleteProfile(p.id, p.name)}
                      className="text-muted-foreground hover:text-red-500 p-1"
                      title="Izbriši"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Create new */}
          {showCreate ? (
            <div className="border-t border-border p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                  className="w-10 bg-background border border-border rounded px-1.5 py-1 text-xs text-center"
                  maxLength={2}
                />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ime profila"
                  className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && createProfile()}
                />
              </div>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 text-xs flex-1 gap-1" onClick={createProfile}>
                  <Plus className="w-3 h-3" /> Ustvari
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                  Prekliči
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-primary hover:bg-primary/10 transition-colors border-t border-border"
            >
              <Plus className="w-3.5 h-3.5" />
              Nov profil
            </button>
          )}

          <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
            💡 Profili filtrirajo monitorje in tradee. Oglasi in alerti se prilagodijo glede na aktivni profil.
          </div>
        </div>
      )}
    </div>
  );
}
