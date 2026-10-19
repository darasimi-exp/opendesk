// Package natsx connects to NATS, or runs it embedded in this process.
package natsx

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

type Options struct {
	URL      string // external server; empty = embedded
	Token    string
	Listen   string // embedded listen address, "" = in-process only
	StoreDir string
	Name     string
}

type Conn struct {
	*nats.Conn
	server *server.Server
}

// Connect returns a connection to an external NATS, or starts an embedded server.
// The embedded server listens on Options.Listen so the Elixir gateway can join it.
func Connect(o Options, log *slog.Logger) (*Conn, error) {
	opts := []nats.Option{nats.Name(o.Name), nats.MaxReconnects(-1), nats.ReconnectWait(time.Second)}
	if o.Token != "" {
		opts = append(opts, nats.Token(o.Token))
	}
	if o.URL != "" {
		nc, err := nats.Connect(o.URL, opts...)
		if err != nil {
			return nil, fmt.Errorf("connect nats: %w", err)
		}
		return &Conn{Conn: nc}, nil
	}

	sopts := &server.Options{
		ServerName:         "opendesk-embedded",
		JetStream:          true,
		StoreDir:           o.StoreDir,
		NoSigs:             true,
		Authorization:      o.Token,
		MaxPayload:         4 << 20,
		JetStreamMaxMemory: 64 << 20,
	}
	if o.Listen == "" {
		sopts.DontListen = true
	} else {
		host, port, err := net.SplitHostPort(o.Listen)
		if err != nil {
			return nil, fmt.Errorf("NATS_LISTEN: %w", err)
		}
		p, err := strconv.Atoi(port)
		if err != nil {
			return nil, fmt.Errorf("NATS_LISTEN port: %w", err)
		}
		// NATS opens its listener asynchronously in Start. Check the address first
		// so local startup reports the real bind failure instead of timing out with
		// the otherwise opaque "embedded nats did not start" message.
		probe, err := net.Listen("tcp", o.Listen)
		if err != nil {
			return nil, fmt.Errorf("NATS_LISTEN %s: %w", o.Listen, err)
		}
		if err := probe.Close(); err != nil {
			return nil, fmt.Errorf("NATS_LISTEN %s: close probe: %w", o.Listen, err)
		}
		sopts.Host, sopts.Port = host, p
	}
	ns, err := server.NewServer(sopts)
	if err != nil {
		return nil, fmt.Errorf("start embedded nats: %w", err)
	}
	go ns.Start()
	if !ns.ReadyForConnections(10 * time.Second) {
		return nil, errors.New("embedded nats did not start")
	}
	log.Info("nats embedded", "listen", o.Listen, "store", o.StoreDir)
	nc, err := nats.Connect("", append(opts, nats.InProcessServer(ns))...)
	if err != nil {
		ns.Shutdown()
		return nil, err
	}
	return &Conn{Conn: nc, server: ns}, nil
}

func (c *Conn) Close() {
	_ = c.Drain()
	if c.server != nil {
		c.server.Shutdown()
		c.server.WaitForShutdown()
	}
}
