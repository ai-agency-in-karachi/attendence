import { formatBytes } from "@/lib/format";
import type { StorageStatus } from "@/lib/storage";
import { Alert } from "@/components/ui";

/** Warning banner when storage is nearly full, full, or there is no plan. Shows nothing when fine. */
export function StorageNotice({ status }: { status: StorageStatus }) {
  if (status.level === "none") {
    return (
      <Alert tone="warning">
        Your school has no active subscription, so new students, imports and photos can’t be added. Attendance still works.
        Please contact the platform administrator.
      </Alert>
    );
  }
  if (status.level === "full") {
    return (
      <Alert tone="error">
        Storage is full ({formatBytes(status.total)} of {formatBytes(status.quota.limit)}). New students, imports and photos are
        blocked until space is freed or the plan is upgraded. Attendance still works.
      </Alert>
    );
  }
  if (status.level === "warning") {
    return (
      <Alert tone="warning">
        Storage is {status.percent}% full ({formatBytes(status.remaining)} left). Ask the platform administrator about a larger plan soon.
      </Alert>
    );
  }
  return null;
}
