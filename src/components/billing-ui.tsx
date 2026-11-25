import type { SubscriptionStatus } from "@/generated/prisma/client";
import { effectiveStatus, daysLeft } from "@/lib/billing";
import { formatBytes } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { StorageStatus } from "@/lib/storage";

/** Subscription status, treating overdue ones as expired. */
export function SubscriptionBadge({ sub }: { sub: { status: SubscriptionStatus; endsAt: Date } }) {
  const s = effectiveStatus(sub);
  if (s === "ACTIVE") {
    const left = daysLeft(sub.endsAt);
    return left <= 14 ? <Badge tone="amber">Active · {left} day{left === 1 ? "" : "s"} left</Badge> : <Badge tone="green">Active</Badge>;
  }
  if (s === "TRIAL") return <Badge tone="blue">Trial · {daysLeft(sub.endsAt)} days left</Badge>;
  if (s === "EXPIRED") return <Badge tone="red">Expired</Badge>;
  return <Badge>Cancelled</Badge>;
}

/** Storage usage bar: green, amber from 80 %, red when full. */
export function StorageMeter({ status, compact }: { status: StorageStatus; compact?: boolean }) {
  const pct = status.percent ?? 0;
  const bar = status.level === "full" ? "bg-red-500" : status.level === "warning" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-900">
          {formatBytes(status.total)}
          <span className="font-normal text-slate-500"> of {status.quota.limit === null ? "—" : formatBytes(status.quota.limit)}</span>
        </span>
        {status.percent !== null && <span className="tabular-nums text-slate-600">{status.percent}%</span>}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
      >
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {!compact && (
        <p className="text-xs text-slate-500">
          Students {formatBytes(status.students)} · Attendance {formatBytes(status.attendance)} · Photos {formatBytes(status.photos)}
          {status.quota.source === "custom" && " · custom quota"}
        </p>
      )}
    </div>
  );
}
