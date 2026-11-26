import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

export const GOAL_CATEGORIES = ['Faith', 'Fitness and Health', 'Family', 'Financial', 'Blackbridge', 'Other'];

export interface GoalDraft { id?: string; text: string; horizon: string; category: string }

export function GoalEditDialog({ goal, horizons, onClose, onSave, onDelete }: {
  goal: GoalDraft | null; horizons: string[]; onClose: () => void;
  onSave: (g: GoalDraft) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [d, setD] = useState<GoalDraft>({ text: '', horizon: '', category: '' });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (goal) setD(goal); }, [goal]);
  const every = d.horizon === 'Every Year';
  const ok = d.text.trim() && d.horizon.trim() && (every || d.category);
  return (
    <>
      <Dialog open={!!goal} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{d.id ? 'Edit goal' : 'Add goal'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea aria-label="Goal" value={d.text} onChange={e => setD({ ...d, text: e.target.value })} rows={3} maxLength={500} />
            {!d.id && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Horizon</p>
                  <Input list="goal-horizons" value={d.horizon} onChange={e => setD({ ...d, horizon: e.target.value })} placeholder="2027" />
                  <datalist id="goal-horizons">{horizons.map(h => <option key={h} value={h} />)}</datalist>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Category</p>
                  <select aria-label="Category" disabled={every} value={every ? 'Every Year' : d.category} onChange={e => setD({ ...d, category: e.target.value })} className="h-10 w-full rounded-md border border-border bg-card px-2 text-sm">
                    <option value="">Choose</option>
                    {every && <option value="Every Year">Every Year</option>}
                    {GOAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {d.id ? <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>Delete</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={!ok || busy} onClick={async () => { setBusy(true); await onSave({ ...d, text: d.text.trim(), horizon: d.horizon.trim(), category: every ? 'Every Year' : d.category }); setBusy(false); }}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this goal?</AlertDialogTitle><AlertDialogDescription>{d.text}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (d.id) await onDelete(d.id); setConfirm(false); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
