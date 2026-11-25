"use client";

import { useActionState } from "react";
import { changeOwnPassword } from "@/lib/auth/actions";
import type { FormState } from "@/lib/form";
import { Button, Card, CardHeader, Field, FormMessage, ariaFor, inputClass } from "@/components/ui";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changeOwnPassword, undefined);
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];
  return (
    <Card className="max-w-lg">
      <CardHeader title="Change password" />
      <form action={action} className="space-y-4 p-5" key={state?.ok ? "done" : "form"}>
        <FormMessage state={state} />
        <Field label="Current password" htmlFor="currentPassword" required error={err("currentPassword")}>
          <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} {...ariaFor(err("currentPassword"), "currentPassword")} />
        </Field>
        <Field label="New password" htmlFor="newPassword" required hint="At least 10 characters." error={err("newPassword")}>
          <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} className={inputClass} {...ariaFor(err("newPassword"), "newPassword")} />
        </Field>
        <Field label="Repeat new password" htmlFor="confirmPassword" required error={err("confirmPassword")}>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={inputClass} {...ariaFor(err("confirmPassword"), "confirmPassword")} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}
