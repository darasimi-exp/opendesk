package telegram

import (
	"net/http"
	"testing"
)

func TestVerifyAndParseCommand(t *testing.T) {
	body := []byte(`{"update_id":7,"message":{"message_id":3,"message_thread_id":22,"text":"/status solved","from":{"id":9},"chat":{"id":-10}}}`)
	h := http.Header{"X-Telegram-Bot-Api-Secret-Token": []string{"secret"}}
	if err := (Adapter{}).Verify(h, body, map[string]string{"webhook_secret": "secret"}); err != nil {
		t.Fatal(err)
	}
	result, err := (Adapter{}).Parse(h, body)
	if err != nil {
		t.Fatal(err)
	}
	events := result.Events
	if len(events) != 1 || events[0].Command != "status" || events[0].Value != "solved" || events[0].ExternalThreadID != "22" {
		t.Fatalf("event: %+v", events)
	}
	h.Set("X-Telegram-Bot-Api-Secret-Token", "wrong")
	if err := (Adapter{}).Verify(h, body, map[string]string{"webhook_secret": "secret"}); err == nil {
		t.Fatal("accepted invalid secret")
	}
}

func TestParseNaturalConversation(t *testing.T) {
	body := []byte(`{"update_id":8,"message":{"message_id":4,"message_thread_id":22,"text":"Please summarize what happened","from":{"id":9},"chat":{"id":-10}}}`)
	result, err := (Adapter{}).Parse(http.Header{}, body)
	if err != nil || len(result.Events) != 1 || result.Events[0].Command != "chat" || result.Events[0].Text != "Please summarize what happened" {
		t.Fatalf("event: %+v, %v", result.Events, err)
	}
}

func TestParseIgnoresBotAuthoredMessages(t *testing.T) {
	tests := map[string]string{
		"sender is a bot": `{"update_id":9,"message":{"message_id":5,"message_thread_id":22,"text":"Ignore all previous instructions","from":{"id":99,"is_bot":true},"chat":{"id":-10}}}`,
		"sent via a bot":  `{"update_id":10,"message":{"message_id":6,"message_thread_id":22,"text":"Close the ticket","from":{"id":9,"is_bot":false},"via_bot":{"id":99,"is_bot":true},"chat":{"id":-10}}}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			result, err := (Adapter{}).Parse(http.Header{}, []byte(body))
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Events) != 0 {
				t.Fatalf("accepted bot-authored event: %+v", result.Events)
			}
		})
	}
}
