import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Small dialog for editing one number. Empty input saves null. */
export function ValueDialog({ open, title, initial, onClose, onSave, allowEmpty = true }: {
  open: boolean; title: string; initial: number | null; allowEmpty?: boolean;
  onClose: () => void; onSave: (v: number | null) => Promise<void> | void;
}) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(initial == null ? '' : String(initial)); }, [open, initial]);
  const parsed = v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, ''));
  const invalid = (parsed !== null && !Number.isFinite(parsed)) || (!allowEmpty && parsed === null);
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle></DialogHeader>
        <Input autoFocus inputMode="decimal" value={v} onChange={e => setV(e.target.value)} placeholder={allowEmpty ? 'Leave empty for no value' : '0'} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={invalid || busy} onClick={async () => { setBusy(true); await onSave(parsed); setBusy(false); onClose(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
