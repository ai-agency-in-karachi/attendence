"use client";

import { useActionState, useState } from "react";
import { setSchoolStatus, type StatusState } from "../actions";
import { Alert, Button } from "@/components/ui";

/** Activate / deactivate with an explicit confirmation step. */
export function StatusControl({ schoolId, status, adminCount }: { schoolId: number; status: "ACTIVE" | "INACTIVE"; adminCount: number }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(setSchoolStatus, undefined);
  const [confirming, setConfirming] = useState(false);
  const deactivate = status === "ACTIVE";

  if (!confirming) {
    return (
      <div className="space-y-3">
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        <Button type="button" variant={deactivate ? "secondary" : "success"} onClick={() => setConfirming(true)}>
          {deactivate ? "Deactivate school…" : "Activate school…"}
        </Button>
      </div>
    );
  }

  return (
    <form action={action} onSubmit={() => setConfirming(false)} className="space-y-3">
      <input type="hidden" name="schoolId" value={schoolId} />
      <input type="hidden" name="status" value={deactivate ? "INACTIVE" : "ACTIVE"} />
      <Alert tone={deactivate ? "warning" : "info"}>
        {deactivate ? (
          <>
            <strong>Deactivate this school?</strong> Its {adminCount} admin{adminCount === 1 ? "" : "s"} will be signed
            out immediately and cannot sign in. <strong>No data is deleted</strong>, and you can reactivate at any time.
          </>
        ) : (
          <>
            <strong>Activate this school?</strong> Its admins will be able to sign in again.
          </>
        )}
      </Alert>
      <div className="flex gap-2">
        <Button type="submit" variant={deactivate ? "danger" : "success"} disabled={pending}>
          {pending ? "Saving…" : deactivate ? "Yes, deactivate" : "Yes, activate"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
