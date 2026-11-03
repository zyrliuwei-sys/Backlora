import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BadgeConnection({
  websiteId,
  disabled,
}: {
  websiteId: string;
  disabled: boolean;
}) {
  const [token, setToken] = useState('');
  const { confirm, dialog } = useConfirm();
  const client = useQueryClient();
  const url = `/api/websites/${encodeURIComponent(websiteId)}/badge-connection`;
  const queryKey = ['website-badge-connection', websiteId];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<{ configured: boolean; ready: boolean; origin: string | null }>(
        url
      ),
  });
  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      remove ? apiDelete(url) : apiPost(url, { token }),
    onSuccess: () => {
      setToken('');
      client.invalidateQueries({ queryKey });
      toast.success(m['dash.badges.saved']());
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <section className="space-y-3 rounded-xl border p-5">
      {dialog}
      <h2 className="font-semibold">{m['dash.badges.title']()}</h2>
      <p className="text-muted-foreground text-sm">
        {m['dash.badges.description']()}
      </p>
      <p className="text-sm" role="status">
        {query.isError
          ? m['dash.badges.load_error']()
          : query.isPending
            ? m['dash.common.loading']()
            : query.data.ready
              ? m['dash.badges.ready']()
              : query.data.configured
                ? m['dash.badges.reconnect']()
                : m['dash.badges.not_connected']()}
      </p>
      {disabled && (
        <p className="text-sm text-amber-600">{m['dash.badges.save_url']()}</p>
      )}
      <Label htmlFor="badge-connection-token">{m['dash.badges.token']()}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="badge-connection-token"
          type="password"
          autoComplete="new-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="min-w-48 flex-1"
          disabled={disabled || mutation.isPending}
          placeholder={m['dash.badges.token_hint']()}
        />
        <Button
          type="button"
          disabled={
            disabled ||
            mutation.isPending ||
            query.isPending ||
            query.isError ||
            !token.trim()
          }
          onClick={() => mutation.mutate(false)}
        >
          {m['dash.badges.connect']()}
        </Button>
        {query.data?.configured && (
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: m['dash.badges.disconnect'](),
                  description: m['dash.badges.disconnect_hint'](),
                })
              )
                mutation.mutate(true);
            }}
          >
            {m['dash.badges.disconnect']()}
          </Button>
        )}
      </div>
    </section>
  );
}
