import { useId } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { MAX_ADD_BATCH, MAX_BATCH_NAME_LENGTH } from '@/config/backlinks';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export type BatchImportInput = { batchName: string; urls: string[] };

function importLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const schema = z.object({
  batchName: z.string().trim().min(1).max(MAX_BATCH_NAME_LENGTH),
  urls: z
    .string()
    .trim()
    .min(1)
    .refine((value) => importLines(value).length <= MAX_ADD_BATCH),
});

export function BatchImportForm({
  onImport,
  onCancel,
  submitLabel,
  destinationHint,
}: {
  onImport: (input: BatchImportInput) => Promise<boolean>;
  onCancel?: () => void;
  submitLabel?: string;
  destinationHint?: string;
}) {
  const formId = useId();
  const form = useForm({
    defaultValues: { batchName: '', urls: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const completed = await onImport({
          batchName: value.batchName.trim(),
          urls: importLines(value.urls),
        });
        if (completed) formApi.reset();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : m['common.error.message']()
        );
      }
    },
  });
  const { batchName, urls } = useStore(form.store, (state) => state.values);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const count = importLines(urls).length;
  const overLimit = count > MAX_ADD_BATCH;
  const ready = batchName.trim().length > 0 && count > 0 && !overLimit;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !submitting) void form.handleSubmit();
      }}
    >
      <form.Field name="batchName">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={`${formId}-batch-name`}>
              {m['dash.my.batch_name']()}
            </Label>
            <Input
              id={`${formId}-batch-name`}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              maxLength={MAX_BATCH_NAME_LENGTH}
              disabled={submitting}
              placeholder={m['dash.my.batch_name_placeholder']()}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="urls">
        {(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`${formId}-urls`}>
                {m['dash.my.batch_urls']()}
              </Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {m['dash.my.batch_url_count']({ count })}
              </span>
            </div>
            <Textarea
              id={`${formId}-urls`}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              disabled={submitting}
              aria-describedby={`${formId}-hint`}
              aria-invalid={overLimit}
              placeholder={m['dash.my.batch_urls_placeholder']()}
              className="min-h-48 resize-y font-mono text-sm"
              spellCheck={false}
            />
            <p id={`${formId}-hint`} className="text-muted-foreground text-sm">
              {destinationHint ? `${destinationHint} ` : null}
              {m['dash.my.batch_urls_hint']()}
            </p>
          </div>
        )}
      </form.Field>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={
            overLimit
              ? 'text-destructive text-sm'
              : 'text-muted-foreground text-sm'
          }
        >
          {overLimit
            ? m['dash.my.batch_limit']({ max: MAX_ADD_BATCH })
            : ready
              ? m['dash.my.batch_ready']({ count })
              : m['dash.my.batch_required']()}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onCancel}
            >
              {m['dash.common.cancel']()}
            </Button>
          )}
          <Button type="submit" disabled={!ready || submitting}>
            <Upload className="size-4" />
            {submitting
              ? m['dash.my.batch_importing']()
              : (submitLabel ?? m['dash.my.batch_import']())}
          </Button>
        </div>
      </div>
    </form>
  );
}
