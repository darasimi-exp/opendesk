package natsx

import (
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
)

func TestConnectReportsListenFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	_, err = Connect(Options{Listen: listener.Addr().String(), StoreDir: t.TempDir(), Name: "listen-test"}, log)
	if err == nil || !strings.Contains(err.Error(), "NATS_LISTEN "+listener.Addr().String()) {
		t.Fatalf("error = %v, want NATS_LISTEN address", err)
	}
}
