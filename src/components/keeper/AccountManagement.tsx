import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InvitesManagement } from '@/components/auth/InvitesManagement';

interface HouseholdUser {
  user_id: string;
  display_name: string;
  avatar_initial: string;
  email?: string;
  last_seen_at?: string | null;
}

export function AccountManagement() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<HouseholdUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Add user form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Auto-derived initial from display name (first letter, uppercase). Falls
  // back to email's first letter if no name is entered.
  const derivedInitial = (addName.trim() || addEmail.trim()).charAt(0).toUpperCase() || '?';

  // Edit user
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editInitial, setEditInitial] = useState('');

  // Delete confirm
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'list-users' },
    });
    if (error) {
      toast({ title: 'Error loading users', description: String(error), variant: 'destructive' });
    } else {
      setUsers(data.users || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleAdd = async () => {
    if (!addEmail.trim() || !addPassword.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'create-user',
        email: addEmail.trim(),
        password: addPassword,
        display_name: addName.trim() || addEmail.trim(),
        avatar_initial: derivedInitial,
      },
    });
    setSaving(false);
    if (error || data?.error) {
      toast({ title: 'Error creating user', description: data?.error || String(error), variant: 'destructive' });
    } else {
      toast({ title: 'User created' });
      setShowAdd(false);
      setAddName(''); setAddEmail(''); setAddPassword('');
      fetchUsers();
    }
  };

  const startEdit = (u: HouseholdUser) => {
    setEditUserId(u.user_id);
    setEditName(u.display_name);
    setEditEmail(u.email || '');
    setEditPassword('');
    setEditInitial(u.avatar_initial);
  };

  const handleEdit = async () => {
    if (!editUserId) return;
    setSaving(true);
    const body: Record<string, string> = { action: 'update-user', user_id: editUserId };
    if (editName.trim()) body.display_name = editName.trim();
    if (editEmail.trim()) body.email = editEmail.trim();
    if (editPassword) body.password = editPassword;
    if (editInitial.trim()) body.avatar_initial = editInitial.trim();

    const { data, error } = await supabase.functions.invoke('admin-users', { body });
    setSaving(false);
    if (error || data?.error) {
      toast({ title: 'Error updating user', description: data?.error || String(error), variant: 'destructive' });
    } else {
      toast({ title: 'User updated' });
      setEditUserId(null);
      fetchUsers();
    }
  };

  const handleDelete = async (userId: string) => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'delete-user', user_id: userId },
    });
    setSaving(false);
    if (error || data?.error) {
      toast({ title: 'Error removing user', description: data?.error || String(error), variant: 'destructive' });
    } else {
      toast({ title: 'User removed' });
      setDeleteUserId(null);
      fetchUsers();
    }
  };

  const formatLastLogin = (dt?: string | null) => {
    if (!dt) return 'Never';
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading users…</div>;

  return (
    <div className="mb-8">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account Management</h3>

      <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
        {users.map(u => (
          <div key={u.user_id}>
            {editUserId === u.user_id ? (
              <div className="p-4 space-y-2">
                <div className="flex gap-2">
                  <input value={editInitial} onChange={e => setEditInitial(e.target.value)} maxLength={2} placeholder="Initial"
                    className="w-12 px-2 py-2 text-center text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Display Name"
                    className="flex-1 px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
                </div>
                <input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Email" type="email"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <input value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="New password (leave empty to keep)" type="password"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <div className="flex gap-2">
                  <button onClick={handleEdit} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-[0.98] transition-transform disabled:opacity-50">
                    <Check size={14} className="inline mr-1" />Save
                  </button>
                  <button onClick={() => setEditUserId(null)}
                    className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-medium active:scale-[0.98] transition-transform">
                    Cancel
                  </button>
                </div>
              </div>
            ) : deleteUserId === u.user_id ? (
              <div className="p-4">
                <p className="text-sm text-foreground mb-2">Remove <strong>{u.display_name}</strong>? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => handleDelete(u.user_id)} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold active:scale-[0.98] transition-transform disabled:opacity-50">
                    Remove
                  </button>
                  <button onClick={() => setDeleteUserId(null)}
                    className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-medium active:scale-[0.98] transition-transform">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                  {u.avatar_initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{u.display_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                  <p className="text-[10px] text-muted-foreground">Last active: {formatLastLogin(u.last_seen_at)}</p>
                </div>
                <button onClick={() => startEdit(u)} className="p-1.5 text-muted-foreground hover:text-accent active:scale-95 transition-all">
                  <Pencil size={14} />
                </button>
                <button onClick={() => setDeleteUserId(u.user_id)} className="p-1.5 text-muted-foreground/40 hover:text-destructive active:scale-95 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add User */}
      {showAdd ? (
        <div className="mt-3 bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-base font-semibold shrink-0">
              {derivedInitial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Add a household member</p>
              <p className="text-[11px] text-muted-foreground">They'll be able to view and edit the budget alongside you.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Display name</label>
            <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Katie"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" autoFocus />
            <p className="text-[10px] text-muted-foreground">Avatar initial auto-set to "{derivedInitial}".</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
            <input value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="name@example.com" type="email"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Temporary password</label>
            <input value={addPassword} onChange={e => setAddPassword(e.target.value)} placeholder="At least 8 characters" type="password"
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30" />
            <p className="text-[10px] text-muted-foreground">Share this with them and they can change it on first login.</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd} disabled={saving || !addEmail.trim() || !addPassword.trim()}
              className="flex-1 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50">
              {saving ? 'Adding…' : 'Add User'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2.5 rounded-lg bg-card border border-border text-sm font-medium text-muted-foreground active:scale-[0.98] transition-transform">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="mt-3 flex items-center gap-1.5 text-accent text-sm font-medium active:scale-95 transition-transform">
          <Plus size={16} /> Add User
        </button>
      )}

      <div className="mt-10">
        <h2 className="font-display text-base font-semibold text-foreground mb-3">Invites</h2>
        <InvitesManagement />
      </div>
    </div>
  );
}
