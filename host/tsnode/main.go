// tsnode is the embedded Tailscale node for dsh-mobile-bridge.
//
// It runs a userspace tailscale.com/tsnet node (no TUN device, no system VPN,
// no admin rights), listens on the tailnet and forwards every accepted
// connection to the local bridge on 127.0.0.1. That lets a phone inside the
// same tailnet reach DSH on a PC that has no system Tailscale installed.
//
// The plugin spawns this binary and reads newline-delimited JSON events on
// stdout. Closing stdin shuts the node down.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

const version = "0.1.0"

type emitter struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func newEmitter(w io.Writer) *emitter {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return &emitter{enc: enc}
}

func (e *emitter) send(payload map[string]any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := payload["type"]; !ok {
		payload["type"] = "log"
	}
	_ = e.enc.Encode(payload)
}

type config struct {
	stateDir string
	hostname string
	listen   string
	local    string
	authKey  string
	control  string
}

func parseFlags() config {
	cfg := config{}
	flag.StringVar(&cfg.stateDir, "state-dir", "", "directory for node state (required)")
	flag.StringVar(&cfg.hostname, "hostname", "", "tailnet hostname for this node")
	flag.StringVar(&cfg.listen, "listen", ":0", "tailnet address to listen on, e.g. :48123")
	flag.StringVar(&cfg.local, "local", "127.0.0.1:48123", "local bridge address to forward to")
	flag.StringVar(&cfg.authKey, "authkey", "", "tailnet auth key (or TS_AUTHKEY)")
	flag.StringVar(&cfg.control, "control", "", "override control server URL (testing)")
	flag.Parse()
	if cfg.authKey == "" {
		cfg.authKey = os.Getenv("TS_AUTHKEY")
	}
	return cfg
}

func sanitizeHostname(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 63 {
		out = strings.Trim(out[:63], "-")
	}
	return out
}

func main() {
	cfg := parseFlags()
	out := newEmitter(os.Stdout)
	logger := log.New(os.Stderr, "[tsnode] ", log.LstdFlags|log.Lmicroseconds)

	if cfg.stateDir == "" {
		out.send(map[string]any{"type": "error", "code": "state-dir-required", "message": "missing -state-dir"})
		os.Exit(2)
	}
	if err := os.MkdirAll(cfg.stateDir, 0o700); err != nil {
		out.send(map[string]any{"type": "error", "code": "state-dir", "message": err.Error()})
		os.Exit(2)
	}

	hostname := sanitizeHostname(cfg.hostname)
	if hostname == "" {
		hostname = "dsh-bridge"
	}

	srv := &tsnet.Server{
		Dir:       cfg.stateDir,
		Hostname:  hostname,
		AuthKey:   cfg.authKey,
		ControlURL: cfg.control,
		Logf: func(format string, args ...any) {
			logger.Printf(format, args...)
		},
		UserLogf: func(format string, args ...any) {
			logger.Printf(format, args...)
		},
		Ephemeral: false,
	}

	out.send(map[string]any{
		"type":     "hello",
		"version":  version,
		"hostname": hostname,
		"listen":   cfg.listen,
		"local":    cfg.local,
		"authKey":  cfg.authKey != "",
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Shut down when the parent closes stdin (plugin exited or restarted).
	go func() {
		buf := make([]byte, 256)
		for {
			_, err := os.Stdin.Read(buf)
			if err != nil {
				logger.Printf("stdin closed: %v", err)
				cancel()
				_ = srv.Close()
				return
			}
		}
	}()

	signals := make(chan os.Signal, 2)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-signals
		logger.Printf("signal received, shutting down")
		cancel()
		_ = srv.Close()
	}()

	go reportStatus(ctx, srv, out, logger)

	ln, err := listenTailnet(srv, cfg.listen)
	if err != nil {
		out.send(map[string]any{"type": "error", "code": "listen-failed", "message": err.Error()})
		logger.Printf("listen failed: %v", err)
		_ = srv.Close()
		os.Exit(1)
	}
	ip4, _ := srv.TailscaleIPs()
	out.send(map[string]any{
		"type":    "listening",
		"addr":    ln.Addr().String(),
		"ip4":     addrString(ip4),
		"local":   cfg.local,
		"hostname": hostname,
	})

	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) || ctx.Err() != nil {
				break
			}
			logger.Printf("accept failed: %v", err)
			time.Sleep(200 * time.Millisecond)
			continue
		}
		go forward(conn, cfg.local, logger)
	}

	_ = srv.Close()
	out.send(map[string]any{"type": "exit", "code": 0})
}

func listenTailnet(srv *tsnet.Server, addr string) (net.Listener, error) {
	// Listen waits for the node to reach Running, which may require an
	// interactive login; the status reporter surfaces the auth URL meanwhile.
	return srv.Listen("tcp", addr)
}

func forward(conn net.Conn, local string, logger *log.Logger) {
	defer conn.Close()
	upstream, err := net.DialTimeout("tcp", local, 5*time.Second)
	if err != nil {
		logger.Printf("dial %s failed: %v", local, err)
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, conn)
		if tcp, ok := upstream.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(conn, upstream)
		if tcp, ok := conn.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		done <- struct{}{}
	}()
	<-done
	<-done
}

func reportStatus(ctx context.Context, srv *tsnet.Server, out *emitter, logger *log.Logger) {
	last := ""
	lastAuthURL := ""
	client, err := srv.LocalClient()
	if err != nil {
		out.send(map[string]any{"type": "error", "code": "local-client", "message": err.Error()})
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		st, err := client.Status(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Printf("status failed: %v", err)
			continue
		}
		ip4, ip6 := srv.TailscaleIPs()
		payload := map[string]any{
			"type":   "status",
			"state":  st.BackendState,
			"ip4":    addrString(ip4),
			"ip6":    addrString(ip6),
			"peers":  peerCount(st),
			"health": st.Health,
		}
		if st.Self != nil {
			payload["dnsName"] = strings.TrimSuffix(st.Self.DNSName, ".")
			payload["hostname"] = st.Self.HostName
			payload["os"] = st.Self.OS
		}
		if st.AuthURL != "" {
			payload["authUrl"] = st.AuthURL
		}
		if st.CurrentTailnet != nil {
			payload["tailnet"] = st.CurrentTailnet.Name
			payload["magicDns"] = st.CurrentTailnet.MagicDNSSuffix
		}
		encoded, _ := json.Marshal(payload)
		key := string(encoded)
		if key == last && st.AuthURL == lastAuthURL {
			continue
		}
		last = key
		lastAuthURL = st.AuthURL
		out.send(payload)
	}
}


func peerCount(st *ipnstate.Status) int {
	if st == nil || st.Peers == nil {
		return 0
	}
	return len(st.Peers())
}

// addrString renders a Tailscale address, or "" while the node has no address
// yet (netip's zero value prints "invalid IP", which no client should parse).
func addrString(addr netip.Addr) string {
	if !addr.IsValid() {
		return ""
	}
	return addr.String()
}