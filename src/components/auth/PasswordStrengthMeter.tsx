import { useEffect, useState } from "react";
import { validatePassword, strengthLabel } from "@/lib/passwordSecurity";

interface Props {
  password: string;
}

export function PasswordStrengthMeter({ password }: Props) {
  const [check, setCheck] = useState(() => validatePassword(password));
  useEffect(() => setCheck(validatePassword(password)), [password]);

  if (!password) return null;

  const colors = [
    "bg-destructive",
    "bg-destructive",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-emerald-600",
  ];
  const widths = ["20%", "40%", "60%", "80%", "100%"];

  return (
    <div className="mt-2 space-y-1.5">
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${colors[check.score]}`}
          style={{ width: widths[check.score] }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{strengthLabel(check.score)}</span>
        {check.issues.length > 0 && (
          <span className="text-muted-foreground/80">{check.issues[0]}</span>
        )}
      </div>
    </div>
  );
}
