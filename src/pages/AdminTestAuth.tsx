import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import NotFound from './NotFound';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TestUser {
  user_id: string;
  email: string;
  email_confirmed: boolean;
  created_at: string;
  household_id: string | null;
  display_name: string | null;
  roles: string[];
}

interface HouseholdRow {
  id: string;
  name: string;
  member_count: number;
}

interface CreatedCredential {
  label: string;
  email: string;
  password: string;
  detail?: string;
  ts: number;
}

interface CreatedInvite {
  label: string;
  code: string;
  household_id?: string | null;
  ts: number;
}

type ConfirmState =
  | null
  | { kind: 'delete-user'; user_id: string; email: string }
  | { kind: 'delete-all-test-users' }
  | { kind: 'delete-orphan-households' }
  | { kind: 'hibp-test' };

// MUST stay in sync with PRODUCTION_HOSTS in
// supabase/functions/admin-test-auth/index.ts. Real enforcement happens
// server-side; this is just a UX optimization to skip the network round trip.
// NEVER include preview/dev hosts (e.g. `hearthbudget.lovable.app`) — doing so
// locks system_admins out of the test tool everywhere usable.
const PROD_HOSTS = new Set([
  'keeperbudget.com',
  'www.keeperbudget.com',
]);

export default function AdminTestAuth() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testUsers, setTestUsers] = useState<TestUser[]>([]);
  const [households, setHouseholds] = useState<HouseholdRow[]>([]);
  const [orphanCount, setOrphanCount] = useState(0);
  const [credentials, setCredentials] = useState<CreatedCredential[]>([]);
  const [invites, setInvites] = useState<CreatedInvite[]>([]);
  const [memberHousehold, setMemberHousehold] = useState<string>('');
  const [inviteHousehold, setInviteHousehold] = useState<string>('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [hibpResult, setHibpResult] = useState<string>('');

  // Frontend pre-check: hide the page on production hostnames immediately.
  // (Real enforcement is server-side; this just avoids the network round trip.)
  const isProdHost = typeof window !== 'undefined' && PROD_HOSTS.has(window.location.hostname);

  const probeAccess = useCallback(async () => {
    if (!user || !isAdmin || isProdHost) {
      setAccessGranted(false);
      setAccessChecked(true);
      return;
    }
    const { data, error } = await supabase.functions.invoke('admin-test-auth', {
      body: { action: 'ping' },
    });
    // The function returns 404 (which surfaces as a non-200 error) when any
    // of the security layers fail. Either way, anything other than {ok: true}
    // means show NotFound.
    if (!error && data?.ok) {
      setAccessGranted(true);
    } else {
      setAccessGranted(false);
    }
    setAccessChecked(true);
  }, [user, isAdmin, isProdHost]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('admin-test-auth', {
      body: { action: 'list-test-data' },
    });
    setLoading(false);
    if (error) {
      setActionMessage(`Load error: ${error.message}`);
      return;
    }
    setTestUsers(data.test_users || []);
    setHouseholds(data.households || []);
    setOrphanCount(data.orphan_household_count || 0);
  }, []);

  useEffect(() => {
    if (!authLoading) probeAccess();
  }, [authLoading, probeAccess]);

  useEffect(() => {
    if (accessGranted) refresh();
  }, [accessGranted, refresh]);

  if (authLoading || !accessChecked) {
    return <div className="p-6 font-mono text-sm">Loading…</div>;
  }
  if (!accessGranted) {
    return <NotFound />;
  }

  // ---- Action handlers ----

  const runAction = async (
    action: string,
    extra: Record<string, unknown> = {},
    onResult?: (data: any) => void,
  ) => {
    setActionMessage('Working…');
    const { data, error } = await supabase.functions.invoke('admin-test-auth', {
      body: { action, ...extra },
    });
    if (error || data?.error) {
      setActionMessage(`Error: ${data?.error || error?.message || 'unknown'}`);
      return;
    }
    setActionMessage('OK');
    onResult?.(data);
    refresh();
  };

  const recordCredential = (label: string, data: any, detail?: string) => {
    setCredentials(prev => [
      { label, email: data.email, password: data.password, detail, ts: Date.now() },
      ...prev,
    ].slice(0, 50));
  };

  const recordInvite = (label: string, data: any) => {
    setInvites(prev => [
      { label, code: data.code, household_id: data.household_id, ts: Date.now() },
      ...prev,
    ].slice(0, 50));
  };

  const handleHibpTest = async () => {
    setHibpResult('Testing…');
    // Use a known-pwned password. Email is ephemeral.
    const email = `test+hibp-${Date.now()}@keeperbudget.com`;
    const { error } = await supabase.auth.signUp({
      email,
      password: 'Password123!',
    });
    if (error) {
      setHibpResult(`PASS — GoTrue rejected: "${error.message}"`);
    } else {
      setHibpResult(
        `FAIL — Signup succeeded with "Password123!" (HIBP not enforced). ` +
        `Created user: ${email}. Delete it manually or via "Delete all test users".`
      );
    }
  };

  const confirmText = (() => {
    if (!confirm) return { title: '', desc: '', action: '' };
    switch (confirm.kind) {
      case 'delete-user':
        return {
          title: 'Delete this test user?',
          desc: `Permanently deletes ${confirm.email}. Cannot be undone.`,
          action: 'Delete user',
        };
      case 'delete-all-test-users':
        return {
          title: `Delete all ${testUsers.length} test users?`,
          desc: `Permanently deletes every user whose email starts with "test+". Cannot be undone.`,
          action: `Delete ${testUsers.length} users`,
        };
      case 'delete-orphan-households':
        return {
          title: `Delete ${orphanCount} orphan households?`,
          desc: `Permanently deletes every household with zero members and all of their budget data. Cannot be undone.`,
          action: `Delete ${orphanCount} households`,
        };
      case 'hibp-test':
        return {
          title: 'Run HIBP enforcement test?',
          desc: `This calls supabase.auth.signUp() with a known-leaked password ("Password123!"). If HIBP is enforced, signup will be rejected. If not, a new user will be created (and you should delete it).`,
          action: 'Run test',
        };
    }
  })();

  const onConfirm = async () => {
    if (!confirm) return;
    const c = confirm;
    setConfirm(null);
    if (c.kind === 'delete-user') {
      await runAction('delete-user', { user_id: c.user_id });
    } else if (c.kind === 'delete-all-test-users') {
      await runAction('delete-all-test-users');
    } else if (c.kind === 'delete-orphan-households') {
      await runAction('delete-orphan-households');
    } else if (c.kind === 'hibp-test') {
      await handleHibpTest();
    }
  };

  return (
    <div className="min-h-screen bg-white text-black font-mono text-sm p-4 lg:p-8">
      <header className="mb-6 border-b border-black pb-4">
        <h1 className="text-2xl font-bold">/admin/test-auth</h1>
        <p className="text-xs mt-1">
          Test fixtures. Visible because: system_admin = ✓, TEST_MODE_ENABLED = ✓, host ≠ production.
          Signed in as {user?.email}.
        </p>
        {actionMessage && (
          <p className="text-xs mt-2 px-2 py-1 bg-yellow-100 inline-block">{actionMessage}</p>
        )}
      </header>

      {/* CREATE USERS */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Create test user</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            className="px-3 py-2 bg-black text-white hover:bg-gray-800"
            onClick={() => runAction('create-verified', {}, d => recordCredential('Verified', d))}
          >Verified user</button>
          <button
            className="px-3 py-2 bg-black text-white hover:bg-gray-800"
            onClick={() => runAction('create-unverified', {}, d => recordCredential('Unverified', d, 'Email not confirmed'))}
          >Unverified user</button>
          <button
            className="px-3 py-2 bg-black text-white hover:bg-gray-800"
            onClick={() => runAction('create-household-admin', {}, d => recordCredential('Household admin', d, `household_id=${d.household_id}`))}
          >Household admin + seeded budget</button>
          <button
            className="px-3 py-2 bg-yellow-300 text-black hover:bg-yellow-400 border border-black"
            onClick={() => setConfirm({ kind: 'hibp-test' })}
          >Test HIBP block (client signUp)</button>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs">Existing household</span>
            <select
              className="border border-black px-2 py-1 min-w-[280px]"
              value={memberHousehold}
              onChange={e => setMemberHousehold(e.target.value)}
            >
              <option value="">— pick a household —</option>
              {households.map(h => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.member_count} members) — {h.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!memberHousehold}
            className="px-3 py-2 bg-black text-white hover:bg-gray-800 disabled:bg-gray-400"
            onClick={() => runAction('create-household-member', { household_id: memberHousehold }, d => recordCredential('Household member', d, `household_id=${d.household_id}`))}
          >Add member to household</button>
        </div>

        {hibpResult && (
          <div className="mt-3 p-2 border border-black bg-gray-100 text-xs whitespace-pre-wrap">
            {hibpResult}
          </div>
        )}
      </section>

      {/* INVITES */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Generate invite</h2>
        <div className="flex flex-wrap items-end gap-2">
          <button
            className="px-3 py-2 bg-black text-white hover:bg-gray-800"
            onClick={() => runAction('create-invite-new-household', {}, d => recordInvite('Create own household', d))}
          >Invite — create own household</button>

          <label className="flex flex-col gap-1">
            <span className="text-xs">Target household</span>
            <select
              className="border border-black px-2 py-1 min-w-[280px]"
              value={inviteHousehold}
              onChange={e => setInviteHousehold(e.target.value)}
            >
              <option value="">— pick a household —</option>
              {households.map(h => (
                <option key={h.id} value={h.id}>
                  {h.name} — {h.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!inviteHousehold}
            className="px-3 py-2 bg-black text-white hover:bg-gray-800 disabled:bg-gray-400"
            onClick={() => runAction('create-invite-existing-household', { household_id: inviteHousehold }, d => recordInvite('Join existing household', d))}
          >Invite — join existing household</button>
        </div>
      </section>

      {/* CREDENTIALS LOG */}
      {(credentials.length > 0 || invites.length > 0) && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-2">Recently created (this session)</h2>
          {credentials.length > 0 && (
            <table className="w-full border border-black text-xs mb-3">
              <thead className="bg-gray-200">
                <tr>
                  <th className="border border-black p-2 text-left">Type</th>
                  <th className="border border-black p-2 text-left">Email</th>
                  <th className="border border-black p-2 text-left">Password</th>
                  <th className="border border-black p-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map(c => (
                  <tr key={c.ts}>
                    <td className="border border-black p-2">{c.label}</td>
                    <td className="border border-black p-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(c.email)}
                        className="underline"
                        title="Click to copy"
                      >{c.email}</button>
                    </td>
                    <td className="border border-black p-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(c.password)}
                        className="underline"
                        title="Click to copy"
                      >{c.password}</button>
                    </td>
                    <td className="border border-black p-2">{c.detail || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {invites.length > 0 && (
            <table className="w-full border border-black text-xs">
              <thead className="bg-gray-200">
                <tr>
                  <th className="border border-black p-2 text-left">Invite type</th>
                  <th className="border border-black p-2 text-left">Code</th>
                  <th className="border border-black p-2 text-left">Household</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.ts}>
                    <td className="border border-black p-2">{i.label}</td>
                    <td className="border border-black p-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(i.code)}
                        className="underline"
                        title="Click to copy"
                      >{i.code}</button>
                    </td>
                    <td className="border border-black p-2">{i.household_id || '— (creates new)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* CLEANUP */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Cleanup</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            disabled={testUsers.length === 0}
            className="px-3 py-2 bg-red-700 text-white hover:bg-red-800 disabled:bg-gray-400"
            onClick={() => setConfirm({ kind: 'delete-all-test-users' })}
          >Delete all test users ({testUsers.length})</button>
          <button
            disabled={orphanCount === 0}
            className="px-3 py-2 bg-red-700 text-white hover:bg-red-800 disabled:bg-gray-400"
            onClick={() => setConfirm({ kind: 'delete-orphan-households' })}
          >Delete orphan households ({orphanCount})</button>
          <button
            className="px-3 py-2 border border-black"
            onClick={refresh}
          >Refresh</button>
        </div>
      </section>

      {/* TEST USER LIST */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">All test users ({testUsers.length})</h2>
        {loading && <p className="text-xs">Loading…</p>}
        <div className="overflow-x-auto">
          <table className="w-full border border-black text-xs">
            <thead className="bg-gray-200">
              <tr>
                <th className="border border-black p-2 text-left">Email</th>
                <th className="border border-black p-2 text-left">Verified</th>
                <th className="border border-black p-2 text-left">Roles</th>
                <th className="border border-black p-2 text-left">Household</th>
                <th className="border border-black p-2 text-left">Created</th>
                <th className="border border-black p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {testUsers.length === 0 && !loading && (
                <tr><td colSpan={6} className="border border-black p-4 text-center text-gray-600">No test users</td></tr>
              )}
              {testUsers.map(u => (
                <tr key={u.user_id}>
                  <td className="border border-black p-2 break-all">{u.email}</td>
                  <td className="border border-black p-2">{u.email_confirmed ? '✓' : '✗'}</td>
                  <td className="border border-black p-2">{u.roles.join(', ') || '—'}</td>
                  <td className="border border-black p-2">{u.household_id ? u.household_id.slice(0, 8) : '—'}</td>
                  <td className="border border-black p-2">{new Date(u.created_at).toLocaleString()}</td>
                  <td className="border border-black p-2">
                    <button
                      className="px-2 py-1 bg-red-700 text-white hover:bg-red-800"
                      onClick={() => setConfirm({ kind: 'delete-user', user_id: u.user_id, email: u.email })}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* HOUSEHOLDS LIST */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">All households ({households.length}, {orphanCount} orphan)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border border-black text-xs">
            <thead className="bg-gray-200">
              <tr>
                <th className="border border-black p-2 text-left">Name</th>
                <th className="border border-black p-2 text-left">ID</th>
                <th className="border border-black p-2 text-left">Members</th>
              </tr>
            </thead>
            <tbody>
              {households.map(h => (
                <tr key={h.id} className={h.member_count === 0 ? 'bg-red-50' : ''}>
                  <td className="border border-black p-2">{h.name}</td>
                  <td className="border border-black p-2">{h.id}</td>
                  <td className="border border-black p-2">{h.member_count}{h.member_count === 0 && ' (orphan)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmText.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className="bg-red-700 text-white hover:bg-red-800"
            >{confirmText.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
