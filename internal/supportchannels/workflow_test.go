package supportchannels

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/jobs"
	"github.com/useopendesk/opendesk/internal/supportchannels/channel"
)

func TestTicketCommandsWaitForTheirCommittedSequence(t *testing.T) {
	e := hdtest.New(t)
	ws := e.NewWorkspace()
	var ticket domain.Ticket
	if err := e.D.DB.Tx(e.Ctx, func(tx pgx.Tx) error {
		var err error
		ticket, err = domain.CreateTicket(e.Ctx, tx, domain.NewTicket{WorkspaceID: ws.ID, Subject: "Printer", Channel: domain.ChannelEmail})
		return err
	}); err != nil {
		t.Fatal(err)
	}

	connectionID, destinationID := ids.New(), ids.New()
	e.Exec(`INSERT INTO support_channel_connections(id,workspace_id,provider,name,external_account_id,credentials_enc)
		VALUES($1,$2,'slack','Support','T1',$3)`, connectionID, ws.ID, []byte{0})
	e.Exec(`INSERT INTO support_channel_destinations(id,workspace_id,connection_id,external_channel_id)
		VALUES($1,$2,$3,'C1')`, destinationID, ws.ID, connectionID)
	e.Exec(`INSERT INTO support_channel_threads(id,workspace_id,connection_id,destination_id,ticket_id,external_channel_id,external_thread_id,history_posted_at)
		VALUES($1,$2,$3,$4,$5,'C1','10.1',now())`, ids.New(), ws.ID, connectionID, destinationID, ticket.ID)

	s := For(e.D)
	c := connection{ID: connectionID, WorkspaceID: ws.ID, ExternalAccountID: "T1"}
	items := []channel.Inbound{
		{EventID: "E1", ExternalChannelID: "C1", ExternalThreadID: "10.1", ExternalUserID: "U1", Command: "status", Value: "pending"},
		{EventID: "E2", ExternalChannelID: "C1", ExternalThreadID: "10.1", ExternalUserID: "U2", Command: "priority", Value: "urgent"},
	}
	if err := s.persistInbound(e.Ctx, c, items); err != nil {
		t.Fatal(err)
	}
	var first, second int64
	e.Scalar(`SELECT ticket_command_seq FROM support_channel_inbound_events WHERE connection_id=$1 AND external_event_id='E1'`, &first, connectionID)
	e.Scalar(`SELECT ticket_command_seq FROM support_channel_inbound_events WHERE connection_id=$1 AND external_event_id='E2'`, &second, connectionID)
	if first != 1 || second != 2 {
		t.Fatalf("command sequences = %d, %d", first, second)
	}
	if err := s.claimTicketCommand(e.Ctx, ticket.ID, second); !errors.Is(err, errTicketCommandBusy) {
		t.Fatalf("later command claim = %v", err)
	}
	if err := s.claimTicketCommand(e.Ctx, ticket.ID, first); err != nil {
		t.Fatal(err)
	}
	if err := s.finishInbound(e.Ctx, jobs.SupportChannelInboundArgs{ConnectionID: connectionID, ExternalEventID: "E1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.claimTicketCommand(e.Ctx, ticket.ID, second); err != nil {
		t.Fatalf("second command did not advance: %v", err)
	}
	s.releaseTicketCommand(ticket.ID, second)
}

func TestConfirmationMessageOffersOnlyConfirmAndCancel(t *testing.T) {
	message := confirmationChannelMessage("Review this reply")
	if len(message.Actions) != 2 || message.Actions[0].Command != "confirm" || message.Actions[1].Command != "cancel" {
		t.Fatalf("actions: %+v", message.Actions)
	}
	for _, action := range message.Actions {
		if _, err := uuid.Parse(action.Value); err == nil {
			t.Fatalf("action exposed an identifier: %+v", action)
		}
	}
}
