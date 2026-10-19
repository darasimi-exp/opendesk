package supportchannels

import (
	"context"
	"net/http"
	"testing"

	"github.com/useopendesk/opendesk/internal/supportchannels/channel"
)

type testAdapter struct{ key string }

func (a testAdapter) Describe() channel.Descriptor {
	return channel.Descriptor{Key: a.key, Name: a.key}
}
func (testAdapter) Validate(context.Context, *http.Client, map[string]string) (channel.Account, error) {
	return channel.Account{}, nil
}
func (testAdapter) Verify(http.Header, []byte, map[string]string) error { return nil }
func (testAdapter) Parse(http.Header, []byte) (channel.WebhookResult, error) {
	return channel.WebhookResult{}, nil
}
func (testAdapter) CreateThread(context.Context, *http.Client, map[string]string, string, channel.Ticket) (channel.Thread, error) {
	return channel.Thread{}, nil
}
func (testAdapter) Post(context.Context, *http.Client, map[string]string, string, string) error {
	return nil
}
func (testAdapter) Update(context.Context, *http.Client, map[string]string, string, channel.Ticket) error {
	return nil
}

func TestRegistryRejectsDuplicateAndEmptyProviders(t *testing.T) {
	if _, err := NewRegistry(testAdapter{key: ""}); err == nil {
		t.Fatal("accepted empty provider key")
	}
	if _, err := NewRegistry(testAdapter{key: "chat"}, testAdapter{key: "chat"}); err == nil {
		t.Fatal("accepted duplicate provider key")
	}
	r, err := NewRegistry(testAdapter{key: "whatsapp"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Get("whatsapp"); !ok {
		t.Fatal("registered provider missing")
	}
}
