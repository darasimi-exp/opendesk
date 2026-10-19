# Support channels (`internal/supportchannels`)

Support channels mirror email tickets into agent-facing chat products. Version 1 ships
Slack, Discord and Telegram. The orchestration is provider-neutral so WhatsApp, Signal,
Teams and other products can be added as adapters without changing ticket behavior.
This is separate from `internal/integrations`: integrations expose MCP tools to Ollie,
while support channels are places where people work tickets.

The cloud and self-host use the same code. There is no plan gate.

## Model and API

```ts
type Provider = { key: string; name: string; description: string;
  fields: { name: string; label: string; secret: boolean; help?: string }[] };
type Connection = { id: string; provider: string; name: string;
  external_account_id: string; external_account_name: string;
  status: "connected"|"error"; last_error: string; webhook_url: string; created_at: string };
type Destination = { id: string; connection_id: string; team_id: string|null;
  external_channel_id: string; external_channel_name: string; enabled: boolean; created_at: string };
```

| method | path | role | body → response |
| --- | --- | --- | --- |
| GET | `/v1/support-channels/providers` | viewer, `settings:read` | → `{data: Provider[]}` |
| GET | `/v1/support-channels/connections` | viewer, `settings:read` | → `{data: Connection[]}` |
| POST | `/v1/support-channels/connections` | admin, `settings:write` | `{provider,name?,credentials}` → 201 `Connection` |
| DELETE | `/v1/support-channels/connections/{id}` | admin, `settings:write` | → 204, including its destinations and thread mappings |
| GET | `/v1/support-channels/destinations` | viewer, `settings:read` | → `{data: Destination[]}` |
| POST | `/v1/support-channels/destinations` | admin, `settings:write` | `{connection_id,team_id?,external_channel_id,external_channel_name?}` → 201 `Destination` |
| DELETE | `/v1/support-channels/destinations/{id}` | admin, `settings:write` | → 204, including its thread mappings |
| POST | `/v1/me/support-channel-link-code` | agent, `tickets:write` | → 201 `{code,expires_at}` |
| POST | `/v1/support-channels/hooks/{provider}/{connectionId}` | signed provider | provider payload → provider acknowledgement |

A destination maps one provider connection and one public team to an external channel.
`team_id: null` is that connection's fallback. A specific team mapping wins over the
fallback. Every matching connection receives the event, so one team can be mirrored to
Slack, Discord and Telegram at the same time. A connection can have only one destination
per team and an external channel can appear only once on that connection.

Private teams cannot have a destination. The dispatcher also rejects any event marked
with private-team visibility, even if old or manually written data contains a mapping.
Version 1 mirrors email tickets only.

## Provider adapter boundary

The engine owns connections, encrypted credentials, routing, idempotency, retries,
identity linking, authorization and every ticket mutation. An adapter owns only its
provider protocol:

```go
type Adapter interface {
    Describe() Descriptor
    Validate(context.Context, *http.Client, map[string]string) (Account, error)
    Verify(http.Header, []byte, map[string]string) error
    Parse(http.Header, []byte) (WebhookResult, error)
    CreateThread(context.Context, *http.Client, map[string]string, string, Ticket) (Thread, error)
    Post(context.Context, *http.Client, map[string]string, string, string) error
    Update(context.Context, *http.Client, map[string]string, string, Ticket) error
}
```

An adapter is registered in `NewRegistry` at boot. It never imports a helpdesk package or
reads a helpdesk table. `Inbound` is the normalized command envelope and
`WebhookResult` carries both normalized actions and the provider's immediate protocol
acknowledgement. This supports handshakes such as Slack URL verification and Discord
interaction responses without provider branches in the engine. Adding a provider means
implementing this interface, registering it and adding its settings metadata. It does
not require a schema change: provider keys are data, not a database enum.

Adapters are compiled into the binary. They are plugin-shaped Go packages, not Go
runtime `.so` plugins, which keeps builds portable and self-hosting predictable.

## Delivery

Committed `ticket.created`, `ticket.updated` and `message.created` events enqueue one
dispatcher job through the event relay. For each matching destination:

1. `(destination_id,event_seq)` claims the delivery. A completed claim makes replay a no-op.
2. `(destination_id,ticket_id)` claims the external thread before network I/O, so two
   workers cannot create two threads.
3. The adapter creates or updates the ticket root and posts text-only message activity.
4. The delivery is marked complete. Provider failures set the connection to `error` and
   River retries; the next successful delivery clears the error.

The root shows the ticket number, subject, customer, status, priority and opendesk URL.
Messages identify customer replies, agent replies and internal notes. Stored HTML is
never sent to a provider; adapters receive bounded plain text.

## Conversations, commands and identity

Linked agents can talk to Ollie inside a mapped ticket thread. The engine gives Ollie
the visible ticket and its messages, plus a bounded per-agent conversation history.
Ticket content is delimited as untrusted data. Ollie may answer a question or emit one
of the typed actions below; generated text is never executed as a command.

| command | effect |
| --- | --- |
| `link <code>` | consumes the signed-in agent's 10-minute, one-use code and links the external user |
| `reply <text>` | sends a public ticket reply through the ticket's normal mailbox path |
| `note <text>` | adds an internal note |
| `assign` / `assign_self` | assigns the linked agent |
| `status <open|pending|on_hold|solved|closed>` | changes status |
| `priority <low|normal|high|urgent>` | changes priority |

Natural-language customer replies and closing a ticket wait for an explicit `confirm`
or `cancel` response and expire after ten minutes. Drafting a reply does not send it.
Notes, self-assignment, status and priority changes can run immediately after the model
emits their validated schema. A pending action and the ticket mutation are consumed in
one transaction, so two confirmation events cannot apply it twice.

Every conversation and command runs only inside a mapped ticket thread. Before every
action, the engine reloads the linked user, workspace membership, suspension state and
role, then loads the ticket through `domain.LoadVisibleTicket`. Replies use
`tickets.PostMessage`; changes use `tickets.ApplyPatch`. The normal sanitizing, mailbox,
signature, event, automation, notification and audit behavior therefore remains the
single implementation. If Ollie or the workspace assistant is off, explicit commands
continue to work.

In Slack an agent mentions the bot inside the ticket thread. Telegram accepts ordinary
text inside the ticket's forum topic. Discord accepts a bot mention inside the ticket
thread over its Gateway connection; `/ask` is an interactions-only fallback. Explicit
syntax remains `@opendesk reply ...` or `/opendesk reply ...` in Slack, application
commands in Discord, and `/reply ...` in Telegram.

## Provider setup

- **Slack:** bot token and signing secret. Point Event Subscriptions and the slash
  command request URL to `webhook_url`; subscribe the bot to `app_mention`, grant
  `chat:write` and `app_mentions:read`, and invite it to each selected channel.
- **Discord:** bot token, interactions public key and server ID. Set the application's
  Interactions Endpoint URL to `webhook_url`, install the bot with thread/message access,
  enable the privileged Message Content intent, and register the commands above plus
  `/ask`. Worker processes maintain one leased Gateway connection per Discord connection,
  so multiple workers do not handle the same message.
- **Telegram:** bot token and a webhook secret. Add the bot as an administrator to a
  forum-enabled group, then call `setWebhook` with `webhook_url` and the same
  `secret_token`. Disable privacy mode with BotFather so the bot receives ordinary topic
  messages. The destination is the forum group ID.

## Security and operations

- Provider credentials are AES-GCM sealed with `d.Box`; API responses, events, errors and
  logs never include them. Connect and disconnect are audit logged.
- Webhooks are found by an opaque connection UUID, body-capped at 1 MiB, then authenticated
  before parsing: Slack HMAC with a five-minute timestamp window, Discord Ed25519, Telegram
  constant-time secret-token comparison.
- Inbound event persistence and River enqueue share one transaction. Provider event IDs
  deduplicate retries. Link codes are random, stored hashed, expire after ten minutes and
  are consumed in the identity transaction.
- Conversation history and pending actions are scoped to a connection, external thread
  and linked external user. A renewable processing lease serializes that agent's messages,
  and only the ten most recent turns are retained. Provider adapters only emit normalized
  chat text; they never call the model or ticket services.
- Provider API clients have a 15-second timeout and do not follow redirects. Their URLs
  are adapter constants, never user input.
- Provider posts suppress link previews and mass mentions, so customer-controlled
  subjects and message text cannot notify an external channel or fetch arbitrary links.

Events: `support_channel_connection.created {support_channel_connection}`,
`support_channel_connection.deleted {support_channel_connection_id}`,
`support_channel_destination.created {support_channel_destination}` and
`support_channel_destination.deleted {support_channel_destination_id}`.
