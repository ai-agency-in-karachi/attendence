"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { uploadPhoto } from "../actions";
import type { FormState } from "@/lib/form";
import { Button } from "@/components/ui";

const MAX_SIDE = 480;

/** Shrinks a picture in the browser to at most 480 px, saved as JPEG (~30-80 KB). */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
}

export function PhotoUploader({ studentId, hasPhoto }: { studentId: number; hasPhoto: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadPhoto, undefined);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError(null);
    if (!file.type.startsWith("image/")) {
      setLocalError("Choose an image file (JPG, PNG…).");
      return;
    }
    setBusy(true);
    try {
      const blob = await resize(file);
      const fd = new FormData();
      fd.set("studentId", String(studentId));
      fd.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      startTransition(() => action(fd));
    } catch {
      setLocalError("This image could not be read. Try a JPG or PNG.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={onChange} aria-label="Choose photo" />
      <Button type="button" variant="secondary" disabled={pending || busy} onClick={() => input.current?.click()}>
        {pending || busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add photo"}
      </Button>
      {(localError || state?.error) && <p className="text-xs text-red-600">{localError ?? state?.error}</p>}
      {state?.message && !localError && <p className="text-xs text-emerald-700">{state.message}</p>}
    </div>
  );
}
