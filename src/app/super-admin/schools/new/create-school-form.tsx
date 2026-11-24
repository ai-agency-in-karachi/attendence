"use client";

import { useActionState, useState } from "react";
import { createSchool, type CreateSchoolState } from "../actions";
import { slugify } from "@/lib/slug";
import { Alert, Button, ButtonLink, Card, CardHeader, Field, inputClass } from "@/components/ui";

type Props = { timeZones: { value: string; label: string }[] };

export function CreateSchoolForm({ timeZones }: Props) {
  const [state, action, pending] = useActionState<CreateSchoolState, FormData>(createSchool, undefined);
  const v = state?.values ?? {};
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];

  // The web name follows the school name until the user edits it by hand.
  const [name, setName] = useState(String(v.name ?? ""));
  const [slug, setSlug] = useState(String(v.slug ?? ""));
  const [slugTouched, setSlugTouched] = useState(Boolean(v.slug));
  const [createAdmin, setCreateAdmin] = useState(v.createAdmin === undefined ? true : Boolean(v.createAdmin));

  const aria = (k: string) =>
    err(k) ? ({ "aria-invalid": true, "aria-describedby": `${k}-error` } as const) : {};

  return (
    <form action={action} className="max-w-3xl space-y-6" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}

      <Card>
        <CardHeader title="School details" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="School name" htmlFor="name" required error={err("name")}>
              <input
                id="name"
                name="name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                className={inputClass}
                {...aria("name")}
              />
            </Field>
          </div>
          <Field
            label="Web name"
            htmlFor="slug"
            required
            hint="Short unique name: lowercase letters, numbers, hyphens."
            error={err("slug")}
          >
            <input
              id="slug"
              name="slug"
              required
              maxLength={80}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className={inputClass}
              {...aria("slug")}
            />
          </Field>
          <Field
            label="Time zone"
            htmlFor="timezone"
            required
            hint="Decides which calendar day a scan belongs to."
            error={err("timezone")}
          >
            <select
              id="timezone"
              name="timezone"
              required
              defaultValue={String(v.timezone ?? "")}
              className={inputClass}
              {...aria("timezone")}
            >
              <option value="" disabled>
                Select time zone…
              </option>
              {timeZones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact email" htmlFor="contactEmail" error={err("contactEmail")}>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              maxLength={254}
              defaultValue={String(v.contactEmail ?? "")}
              className={inputClass}
              {...aria("contactEmail")}
            />
          </Field>
          <Field label="Contact phone" htmlFor="contactPhone" error={err("contactPhone")}>
            <input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              maxLength={40}
              defaultValue={String(v.contactPhone ?? "")}
              className={inputClass}
              {...aria("contactPhone")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address" htmlFor="address" error={err("address")}>
              <textarea
                id="address"
                name="address"
                rows={2}
                maxLength={500}
                defaultValue={String(v.address ?? "")}
                className={inputClass}
                {...aria("address")}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="First School Admin" />
        <div className="space-y-4 p-5">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              name="createAdmin"
              checked={createAdmin}
              onChange={(e) => setCreateAdmin(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Create a login for the school now
              <span className="block text-xs text-slate-500">
                You can also add admins later. Share the password with the school securely.
              </span>
            </span>
          </label>

          {createAdmin && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Admin full name" htmlFor="adminName" required error={err("adminName")}>
                <input
                  id="adminName"
                  name="adminName"
                  maxLength={200}
                  defaultValue={String(v.adminName ?? "")}
                  className={inputClass}
                  {...aria("adminName")}
                />
              </Field>
              <Field label="Admin email (used to sign in)" htmlFor="adminEmail" required error={err("adminEmail")}>
                <input
                  id="adminEmail"
                  name="adminEmail"
                  type="email"
                  maxLength={254}
                  autoComplete="off"
                  defaultValue={String(v.adminEmail ?? "")}
                  className={inputClass}
                  {...aria("adminEmail")}
                />
              </Field>
              <Field
                label="Initial password"
                htmlFor="adminPassword"
                required
                hint="At least 10 characters."
                error={err("adminPassword")}
              >
                <input
                  id="adminPassword"
                  name="adminPassword"
                  type="password"
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  className={inputClass}
                  {...aria("adminPassword")}
                />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create school"}
        </Button>
        <ButtonLink href="/super-admin/schools" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
