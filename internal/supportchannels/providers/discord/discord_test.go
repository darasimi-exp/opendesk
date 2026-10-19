package discord

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"testing"
)

func TestVerifyAndParseCommand(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"id":"I1","guild_id":"G1","channel_id":"TH1","type":2,"member":{"user":{"id":"U1"}},"data":{"name":"reply","options":[{"name":"text","value":"Hello"}]}}`)
	ts := "123"
	sig := ed25519.Sign(priv, append([]byte(ts), body...))
	h := http.Header{"X-Signature-Timestamp": []string{ts}, "X-Signature-Ed25519": []string{hex.EncodeToString(sig)}}
	if err = (Adapter{}).Verify(h, body, map[string]string{"public_key": hex.EncodeToString(pub)}); err != nil {
		t.Fatal(err)
	}
	result, err := (Adapter{}).Parse(h, body)
	if err != nil {
		t.Fatal(err)
	}
	events := result.Events
	if len(events) != 1 || events[0].AccountID != "G1" || events[0].ExternalUserID != "U1" || events[0].Command != "reply" || events[0].Text != "Hello" || result.Status != http.StatusOK {
		t.Fatalf("event: %+v", events)
	}
	body[0] ^= 1
	if err = (Adapter{}).Verify(h, body, map[string]string{"public_key": hex.EncodeToString(pub)}); err == nil {
		t.Fatal("accepted invalid signature")
	}
}

func TestParsePing(t *testing.T) {
	result, err := (Adapter{}).Parse(http.Header{}, []byte(`{"id":"I1","type":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != http.StatusOK || string(result.Body) != `{"type":1}` || len(result.Events) != 0 {
		t.Fatalf("result: %+v", result)
	}
}

func TestParseAskCommandAsConversation(t *testing.T) {
	body := []byte(`{"id":"I2","guild_id":"G1","channel_id":"TH1","type":2,"member":{"user":{"id":"U1"}},"data":{"name":"ask","options":[{"name":"text","value":"Summarize this"}]}}`)
	result, err := (Adapter{}).Parse(http.Header{}, body)
	if err != nil || len(result.Events) != 1 || result.Events[0].Command != "chat" || result.Events[0].Text != "Summarize this" {
		t.Fatalf("event: %+v, %v", result.Events, err)
	}
}
