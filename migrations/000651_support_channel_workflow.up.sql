-- Ticket-wide lanes keep commands from every mirrored provider in the order in
-- which their signed callbacks are committed. A lease lets a failed worker be
-- retried without allowing a later command to pass it.
CREATE TABLE support_channel_ticket_lanes (
    ticket_id          uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
    workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    next_enqueue_seq   bigint NOT NULL DEFAULT 0,
    next_process_seq   bigint NOT NULL DEFAULT 1,
    processing_seq     bigint,
    processing_expires_at timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE support_channel_inbound_events
    ADD COLUMN ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
    ADD COLUMN ticket_command_seq bigint;

CREATE UNIQUE INDEX support_channel_inbound_ticket_seq_uq
    ON support_channel_inbound_events(ticket_id, ticket_command_seq)
    WHERE ticket_id IS NOT NULL;

ALTER TABLE support_channel_threads
    ADD COLUMN card_event_seq bigint NOT NULL DEFAULT 0,
    ADD COLUMN card_processing_seq bigint,
    ADD COLUMN card_processing_expires_at timestamptz,
    ADD COLUMN history_event_seq bigint NOT NULL DEFAULT 0,
    ADD COLUMN history_processing_expires_at timestamptz,
    ADD COLUMN history_posted_at timestamptz;

-- Existing mirrored threads must not receive an unexpected history replay.
UPDATE support_channel_threads SET history_posted_at = now();
