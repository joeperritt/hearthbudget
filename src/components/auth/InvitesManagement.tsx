import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { getPublicOrigin } from "@/lib/publicOrigin";

interface InviteRow {
  id: string;
  code: string;
  email: string | null;
  household_id: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

type InviteType = "own_household" | "new_household";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function InvitesManagement() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // Default non-system-admins to "join my household" — they can't create
  // brand-new household invites (server-side RLS also enforces this).
  const [inviteType, setInviteType] = useState<InviteType>("own_household");
  const [emailLock, setEmailLock] = useState("");
  const [creating, setCreating] = useState(false);

  // Detect system admin specifically (vs household admin) — only system
  // admins can create new-household invites for beta testers.
  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setIsSystemAdmin(data?.some((r: any) => r.role === "system_admin") ?? false);
    });
  }, [user]);

  const fetchInvites = async () => {
    const { data } = await supabase.from("invites").select("*").order("created_at", { ascending: false });
    setInvites((data as InviteRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchInvites(); }, []);

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Admin access required.</p>;
  }

  const generate = async () => {
    if (!user) return;
    // Defense in depth: even if the UI is bypassed, server RLS rejects
    // non-system-admins from creating new-household invites.
    const effectiveType: InviteType = isSystemAdmin ? inviteType : "own_household";
    setCreating(true);
    const code = randomCode();
    const { error } = await supabase.from("invites").insert({
      code,
      email: emailLock.trim() || null,
      created_by: user.id,
      household_id: effectiveType === "own_household" ? profile?.household_id ?? null : null,
    });
    setCreating(false);
    if (error) {
      toast({ title: "Could not create invite", description: error.message, variant: "destructive" });
      return;
    }
    setEmailLock("");
    fetchInvites();
    toast({ title: "Invite created", description: code });
  };

  const revoke = async (id: string) => {
    await supabase.from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    fetchInvites();
  };

  const copyLink = (code: string) => {
    const url = `${getPublicOrigin()}/signup?invite=${code}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Invite link copied", description: url });
  };

  const status = (inv: InviteRow): { label: string; cls: string } => {
    if (inv.revoked_at) return { label: "Revoked", cls: "text-muted-foreground" };
    if (inv.used_at) return { label: "Used", cls: "text-muted-foreground" };
    if (new Date(inv.expires_at) < new Date()) return { label: "Expired", cls: "text-muted-foreground" };
    return { label: "Active", cls: "text-emerald-600" };
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="font-display text-base font-semibold text-foreground">Generate invite</h3>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invite type</label>
          <div className="grid grid-cols-1 gap-2">
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${inviteType === "new_household" ? "border-accent bg-accent/5" : "border-border"}`}>
              <input type="radio" checked={inviteType === "new_household"} onChange={() => setInviteType("new_household")} className="mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Create their own household</p>
                <p className="text-xs text-muted-foreground">Beta tester — gets a brand-new household with seeded defaults.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${inviteType === "own_household" ? "border-accent bg-accent/5" : "border-border"}`}>
              <input type="radio" checked={inviteType === "own_household"} onChange={() => setInviteType("own_household")} className="mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Join my household</p>
                <p className="text-xs text-muted-foreground">Adds them as a member of your household (e.g., spouse).</p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lock to email (optional)</label>
          <input type="email" value={emailLock} onChange={(e) => setEmailLock(e.target.value)}
            placeholder="anyone@example.com"
            className="auth-input mt-1" />
        </div>

        <button onClick={generate} disabled={creating}
          className="w-full py-2.5 rounded-lg bg-accent text-accent-foreground font-semibold text-sm disabled:opacity-50">
          {creating ? "Creating…" : "Generate invite"}
        </button>
      </div>

      <div className="bg-card rounded-xl p-5 shadow-sm">
        <h3 className="font-display text-base font-semibold text-foreground mb-3">All invites</h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-muted-foreground">No invites yet.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => {
              const st = status(inv);
              const type = inv.household_id ? "Join household" : "New household";
              return (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-foreground">{inv.code}</code>
                      <span className={`text-[10px] uppercase font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {type} · {inv.email ?? "any email"} · expires {format(new Date(inv.expires_at), "MMM d")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {st.label === "Active" && (
                      <>
                        <button onClick={() => copyLink(inv.code)} title="Copy link"
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
                          <Copy size={14} />
                        </button>
                        <button onClick={() => revoke(inv.id)} title="Revoke"
                          className="p-1.5 rounded-md hover:bg-muted text-destructive">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
