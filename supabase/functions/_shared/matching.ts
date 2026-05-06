export interface LegacyTransactionCandidate {
  id: string;
  amount: number;
  date: string;
  description: string;
  account: string;
  plaid_transaction_id: string | null;
  created_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CENT_EPSILON = 0.005;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function descriptionsLookSimilar(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function amountsMatch(left: number, right: number): boolean {
  return Math.abs(Math.abs(left) - Math.abs(right)) < CENT_EPSILON;
}

function isWithinDateWindow(left: string, right: string, windowDays = 3): boolean {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return false;
  }

  return Math.abs(leftTime - rightTime) <= windowDays * DAY_MS;
}

// Strip common POS-aggregator prefixes (Toast "TST*", Square "SQ *", "SP *", etc.)
// and trailing state codes (" - CO") so a fallback to raw `name` reads cleanly.
export function cleanRawDescription(value: string): string {
  if (!value) return "";
  let v = value.trim();
  v = v.replace(/^(TST\*|SQ ?\*|SP ?\*|PY ?\*|PAYPAL ?\*|IZ ?\*)\s*/i, "");
  v = v.replace(/\s+-\s+[A-Z]{2}\s*$/, "");
  v = v.replace(/\s{2,}/g, " ").trim();
  return v;
}

export function buildTransactionDescription(tx: Record<string, unknown>): string {
  const merchantName = ((tx.merchant_name as string) || "").trim();
  const txName = ((tx.name as string) || "").trim();
  const rawCleaned = cleanRawDescription(txName);

  // Venmo: prefer raw `name` since merchant_name is always "Venmo"
  if (merchantName.toLowerCase() === "venmo" && txName) return rawCleaned || txName;
  return merchantName || rawCleaned || txName;
}

export function extractOriginalDescription(tx: Record<string, unknown>): string | null {
  const orig = (tx.original_description as string) || (tx.name as string) || "";
  return orig ? orig.trim() : null;
}

export function findLegacyTransactionGroup(
  candidates: LegacyTransactionCandidate[],
  target: { amount: number; date: string; description: string }
): LegacyTransactionCandidate[] | null {
  const datedCandidates = candidates.filter((candidate) => isWithinDateWindow(candidate.date, target.date));

  // 1. Description-similar group sum (legacy behavior — preferred when names match)
  const similarDescriptionCandidates = datedCandidates.filter((candidate) =>
    descriptionsLookSimilar(candidate.description, target.description)
  );

  const groupByCreatedAt = (rows: LegacyTransactionCandidate[]) => {
    const m = new Map<string, LegacyTransactionCandidate[]>();
    for (const row of rows) {
      const key = row.created_at || row.id;
      const group = m.get(key) || [];
      group.push(row);
      m.set(key, group);
    }
    return Array.from(m.values()).sort((left, right) => {
      const lt = Date.parse(left[0]?.created_at || "") || 0;
      const rt = Date.parse(right[0]?.created_at || "") || 0;
      return rt - lt;
    });
  };

  for (const group of groupByCreatedAt(similarDescriptionCandidates)) {
    const totalAmount = group.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
    if (amountsMatch(totalAmount, target.amount)) return group;
  }

  // 2. NEW: same-created_at group sum across ALL date+account-window candidates,
  // even when descriptions differ. Catches the case where a user manually split a
  // Plaid charge under a different vendor name (e.g. they typed "Salsarita's"
  // for a Cantina 76 charge that Plaid later sent as "76 Gas Stations").
  // Splits are inserted in a single batch, so created_at is a strong grouping key.
  for (const group of groupByCreatedAt(datedCandidates)) {
    if (group.length < 2) continue; // singletons handled by exact-amount fallback below
    const totalAmount = group.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
    if (amountsMatch(totalAmount, target.amount)) return group;
  }

  // 3. Exact-amount single-row fallback
  const exactAmountFallback = datedCandidates.filter((candidate) => amountsMatch(candidate.amount, target.amount));
  if (exactAmountFallback.length === 1) {
    return [exactAmountFallback[0]];
  }

  return null;
}