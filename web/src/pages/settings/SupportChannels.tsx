import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Link2, MessageSquareShare, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Section, SettingsPage } from "@/components/layout";
import { IconTile, ListSkeleton, StatePill } from "@/components/settings2/bits";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { CopyField } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { SupportChannelConnection, SupportChannelDestination, SupportChannelProvider } from "@/lib/api/types";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { toast } from "@/components/ui/toast";

export default function SupportChannels() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const canLink = atLeast(role, "agent");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: providers } = useQuery(q.supportChannelProviders());
  const { data: connections, isLoading } = useQuery(q.supportChannelConnections());
  const { data: destinations } = useQuery(q.supportChannelDestinations());
  const { data: teams } = useQuery(q.teams());
  const [connecting, setConnecting] = useState<SupportChannelProvider | null>(null);
  const [routing, setRouting] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; expires_at: string } | null>(null);

  const disconnect = useMutation({
    mutationFn: api.supportChannels.disconnect,
    onSuccess: (_, id) => {
      qc.setQueryData<SupportChannelConnection[]>(qk.supportChannelConnections, (old) => old?.filter((x) => x.id !== id));
      qc.setQueryData<SupportChannelDestination[]>(qk.supportChannelDestinations, (old) => old?.filter((x) => x.connection_id !== id));
      toast.success("Support channel disconnected.");
    },
    onError: (e) => toast.error(e, "Couldn't disconnect the support channel."),
  });
  const removeDestination = useMutation({
    mutationFn: api.supportChannels.removeDestination,
    onSuccess: (_, id) => {
      qc.setQueryData<SupportChannelDestination[]>(qk.supportChannelDestinations, (old) => old?.filter((x) => x.id !== id));
      toast.success("Destination removed.");
    },
    onError: (e) => toast.error(e, "Couldn't remove the destination."),
  });
  const createLink = useMutation({
    mutationFn: api.supportChannels.linkCode,
    onSuccess: setLink,
    onError: (e) => toast.error(e, "Couldn't create a link code."),
  });

  return (
    <SettingsPage
      wide
      title="Support channels"
      description="Mirror email tickets into Slack, Discord and Telegram. Teammates can reply, add notes and manage tickets from the ticket thread."
      actions={
        canLink ? (
          <Button icon={<Link2 />} onClick={() => createLink.mutate()} loading={createLink.isPending}>
            Link my account
          </Button>
        ) : undefined
      }
    >
      <Section
        flush
        title="Connections"
        description="Provider credentials are encrypted. Each connection gets a signed webhook URL for ticket conversations and commands."
      >
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : !connections?.length ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] font-medium">No support channels connected</p>
            <p className="mt-1 text-[12.5px] text-fg-3">Connect a provider, then choose where each team's email tickets should appear.</p>
          </div>
        ) : (
          <div className="divide-y divide-line-soft">
            {connections.map((connection) => {
              const provider = providers?.find((p) => p.key === connection.provider);
              const routes = destinations?.filter((d) => d.connection_id === connection.id) ?? [];
              return (
                <div key={connection.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <IconTile tone={connection.status === "error" ? "red" : "blue"}>
                      <MessageSquareShare />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium">{connection.name}</span>
                        <span className="text-[12px] text-fg-3">{provider?.name ?? connection.provider}</span>
                        <StatePill state={connection.status === "error" ? "failing" : "active"}>
                          {connection.status === "error" ? "Needs attention" : "Connected"}
                        </StatePill>
                      </div>
                      <p className="mt-0.5 text-[12px] text-fg-3">{connection.external_account_name || connection.external_account_id}</p>
                      {connection.last_error && <p className="mt-1 text-[12px] text-danger-fg">{connection.last_error}</p>}
                      <div className="mt-2 max-w-[620px]">
                        <CopyField value={connection.webhook_url} />
                      </div>
                      {!!routes.length && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {routes.map((route) => {
                            const team = teams?.find((x) => x.id === route.team_id);
                            return (
                              <span key={route.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-sunken pl-2 pr-1 text-[11.5px] text-fg-2">
                                <Hash className="size-3 text-fg-4" />
                                {route.external_channel_name || route.external_channel_id}
                                <span className="text-fg-4">· {team?.name ?? "All teams"}</span>
                                {admin && (
                                  <button
                                    type="button"
                                    className="ml-0.5 flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-danger-fg"
                                    aria-label={`Remove ${route.external_channel_name || route.external_channel_id}`}
                                    onClick={() => removeDestination.mutate(route.id)}
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {admin && (
                      <div className="flex shrink-0 gap-1.5">
                        <Button onClick={() => setRouting(connection.id)}>Add destination</Button>
                        <Button
                          variant="danger"
                          square
                          aria-label={`Disconnect ${connection.name}`}
                          icon={<Trash2 />}
                          onClick={() =>
                            confirm.show(`Disconnect ${connection.name} and remove its ticket thread mappings?`, () => disconnect.mutateAsync(connection.id), {
                              title: "Disconnect support channel",
                              confirmLabel: "Disconnect",
                              danger: true,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Available providers" description={admin ? "Connect a bot account. Adding another provider later only requires a provider adapter." : "An admin can connect provider accounts."}>
        <div className="grid gap-3 py-3 sm:grid-cols-3">
          {(providers ?? []).map((provider) => (
            <button
              key={provider.key}
              type="button"
              disabled={!admin}
              onClick={() => setConnecting(provider)}
              className="rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-hover disabled:cursor-default disabled:opacity-60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{provider.name}</span>
                {admin && <Plus className="size-3.5 text-fg-3" />}
              </div>
              <p className="mt-1.5 text-[12px] leading-[18px] text-fg-3">{provider.description}</p>
            </button>
          ))}
        </div>
      </Section>

      {connecting && <ConnectDialog provider={connecting} onClose={() => setConnecting(null)} />}
      {routing && <DestinationDialog connectionId={routing} onClose={() => setRouting(null)} />}
      <Dialog
        open={!!link}
        onOpenChange={(open) => !open && setLink(null)}
        title="Link your provider account"
        description="In a provider channel, run /link followed by this one-time code. It expires in 10 minutes."
        footer={<Button variant="primary" onClick={() => setLink(null)}>Done</Button>}
      >
        <CopyField value={link?.code ?? ""} />
      </Dialog>
    </SettingsPage>
  );
}

function ConnectDialog({ provider, onClose }: { provider: SupportChannelProvider; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const connect = useMutation({
    mutationFn: () => api.supportChannels.connect({ provider: provider.key, name: name.trim() || undefined, credentials }),
    onSuccess: (row) => {
      upsertInList(qc, qk.supportChannelConnections, row, { prepend: true });
      toast.success(`${provider.name} connected.`);
      onClose();
    },
    onError: (e) => setError(errorMessage(e, `Couldn't connect ${provider.name}.`)),
  });
  const valid = provider.fields.every((field) => credentials[field.name]?.trim());
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Connect ${provider.name}`}
      description={provider.description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={connect.isPending} onClick={() => connect.mutate()}>Connect</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Connection name" optional>
          {(props) => <TextInput {...props} value={name} maxLength={80} placeholder={provider.name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {provider.fields.map((field) => (
          <Field key={field.name} label={field.label} hint={field.help}>
            {(props) => (
              <TextInput
                {...props}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                value={credentials[field.name] ?? ""}
                onChange={(e) => setCredentials((old) => ({ ...old, [field.name]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        {error && <p role="alert" className="text-[12px] text-danger-fg">{error}</p>}
      </div>
    </Dialog>
  );
}

function DestinationDialog({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: teams } = useQuery(q.teams());
  const { data: destinations } = useQuery(q.supportChannelDestinations());
  const [team, setTeam] = useState("all");
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [error, setError] = useState("");
  const options = useMemo(() => {
    const used = new Set((destinations ?? []).filter((d) => d.connection_id === connectionId).map((d) => d.team_id ?? "all"));
    return [
      ...(!used.has("all") ? [{ value: "all", label: "All public teams (fallback)" }] : []),
      ...(teams ?? []).filter((t) => !t.private && !used.has(t.id)).map((t) => ({ value: t.id, label: t.name })),
    ];
  }, [connectionId, destinations, teams]);
  const selected = options.some((x) => x.value === team) ? team : options[0]?.value;
  const create = useMutation({
    mutationFn: () => api.supportChannels.addDestination({
      connection_id: connectionId,
      team_id: selected === "all" ? undefined : selected,
      external_channel_id: channelId.trim(),
      external_channel_name: channelName.trim() || undefined,
    }),
    onSuccess: (row) => {
      upsertInList(qc, qk.supportChannelDestinations, row);
      toast.success("Destination added.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Couldn't add the destination.")),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add destination"
      description="Map a public team to a provider channel, conversation or forum group. A fallback receives tickets without a more specific mapping."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected || !channelId.trim()} loading={create.isPending} onClick={() => create.mutate()}>Add destination</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Team">
          {({ id }) => <Select id={id} value={selected} onChange={setTeam} options={options} placeholder="Choose a team" />}
        </Field>
        <Field label="Provider channel ID" hint="Use the channel, conversation or forum group ID shown by the provider.">
          {(props) => <TextInput {...props} value={channelId} maxLength={200} onChange={(e) => setChannelId(e.target.value)} />}
        </Field>
        <Field label="Display name" optional>
          {(props) => <TextInput {...props} value={channelName} maxLength={100} placeholder="support" onChange={(e) => setChannelName(e.target.value)} />}
        </Field>
        {error && <p role="alert" className="text-[12px] text-danger-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
