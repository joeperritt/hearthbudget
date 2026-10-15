import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Sparkles, CalendarPlus } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface Proposal { calendar_id: string; title: string; start: string; end: string | null; all_day: boolean; location: string | null; notes: string | null; state?: 'open' | 'saving' | 'done' | 'cancelled' }
interface Msg { role: 'user' | 'assistant'; content: string; proposals?: Proposal[] }
interface Cal { id: string; label: string }

// deno-ish typing for the browser speech API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRec: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

async function errorText(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try { const b = await error.context.json(); return b.error || 'Something went wrong.'; } catch { return 'Something went wrong.'; }
  }
  return 'Something went wrong.';
}

function when(p: Proposal) {
  const d = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (s: string) => { const [h, m] = s.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`; };
  if (p.all_day) return p.end && p.end !== p.start ? `${d(p.start)} – ${d(p.end)} · All day` : `${d(p.start)} · All day`;
  return `${d(p.start)} · ${t(p.start)}${p.end ? `–${t(p.end)}` : ''}`;
}

export function KeeperAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [cals, setCals] = useState<Cal[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('household_calendars').select('id, label').order('created_at').then(({ data }) => setCals(data ?? []));
  }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (raw?: string) => {
    const content = (raw ?? text).trim().slice(0, 2000);
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content }];
    setMsgs(next); setText(''); setBusy(true);
    const { data, error } = await supabase.functions.invoke('keeper-assistant', {
      body: { messages: next.slice(-12).map(m => ({ role: m.role, content: m.content })) },
    });
    setBusy(false);
    if (error || !data) { setMsgs(m => [...m, { role: 'assistant', content: 'Sorry — ' + '' }]); const t = await errorText(error); setMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: `Sorry — ${t}` }]); return; }
    setMsgs(m => [...m, { role: 'assistant', content: data.reply, proposals: (data.proposals ?? []).map((p: Proposal) => ({ ...p, state: 'open' })) }]);
  };

  const updateProposal = (mi: number, pi: number, patch: Partial<Proposal>) =>
    setMsgs(m => m.map((msg, i) => i !== mi ? msg : { ...msg, proposals: msg.proposals?.map((p, j) => j === pi ? { ...p, ...patch } : p) }));

  const confirm = async (mi: number, pi: number, p: Proposal) => {
    updateProposal(mi, pi, { state: 'saving' });
    const { data, error } = await supabase.functions.invoke('create-calendar-event', {
      body: { calendar_id: p.calendar_id, title: p.title, start: p.start, end: p.end, all_day: p.all_day, location: p.location, notes: p.notes },
    });
    if (error || !data?.ok) {
      updateProposal(mi, pi, { state: 'open' });
      toast.error(`Couldn't add the event: ${await errorText(error)}`);
      return;
    }
    updateProposal(mi, pi, { state: 'done' });
    setMsgs(m => [...m, { role: 'assistant', content: `Added "${p.title}" to ${data.calendar}.` }]);
    window.dispatchEvent(new Event('keeper-calendar-refresh'));
  };

  const listen = () => {
    if (!SpeechRec || listening) return;
    const rec = new SpeechRec();
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => { const said = e.results?.[0]?.[0]?.transcript ?? ''; if (said) send(said); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Keeper assistant"
        className="fixed bottom-40 right-6 lg:bottom-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        <Sparkles size={22} />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[85vh] sm:h-[80vh] lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[420px] lg:max-w-[420px] flex flex-col p-0 rounded-t-2xl lg:rounded-none">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <SheetTitle className="font-display flex items-center gap-2"><Sparkles size={18} className="text-accent" /> Keeper</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {!msgs.length && (
              <p className="text-sm text-muted-foreground">Try "We need milk and eggs", "Remind me to call the dentist", or "Dinner with the Smiths Friday at 7".</p>
            )}
            {msgs.map((m, mi) => (
              <div key={mi} className={m.role === 'user' ? 'flex justify-end' : 'space-y-2'}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>{m.content}</div>
                {m.proposals?.map((p, pi) => (
                  <div key={pi} className="rounded-2xl border border-border bg-card p-3.5 space-y-2.5 max-w-[95%]">
                    <div className="flex items-center gap-2"><CalendarPlus size={16} className="text-accent" /><p className="text-sm font-semibold text-foreground">{p.title}</p></div>
                    <p className="text-xs text-muted-foreground">{when(p)}{p.location ? ` · ${p.location}` : ''}</p>
                    <select aria-label="Calendar" value={p.calendar_id} disabled={p.state !== 'open'}
                      onChange={e => updateProposal(mi, pi, { calendar_id: e.target.value })} className="auth-input">
                      {cals.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    {p.state === 'done' ? <p className="text-xs font-semibold text-success">Added ✓</p>
                      : p.state === 'cancelled' ? <p className="text-xs text-muted-foreground">Cancelled</p>
                      : (
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90" disabled={p.state === 'saving'} onClick={() => confirm(mi, pi, p)}>{p.state === 'saving' ? 'Adding…' : 'Confirm'}</Button>
                          <Button size="sm" variant="ghost" className="flex-1" disabled={p.state === 'saving'} onClick={() => updateProposal(mi, pi, { state: 'cancelled' })}>Cancel</Button>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            ))}
            {busy && <div className="text-sm text-muted-foreground">Thinking…</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={e => { e.preventDefault(); send(); }} className="border-t border-border p-3 flex items-center gap-2 safe-bottom">
            <input aria-label="Message Keeper" value={text} onChange={e => setText(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask Keeper…'} className="auth-input flex-1" maxLength={2000} />
            {SpeechRec && (
              <Button type="button" size="icon" variant={listening ? 'secondary' : 'ghost'} onClick={listen} aria-label="Speak" disabled={busy}><Mic size={18} className={listening ? 'text-destructive' : ''} /></Button>
            )}
            <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send"><Send size={18} /></Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
