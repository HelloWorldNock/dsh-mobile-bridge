// Package gobridge embeds Tailscale's tsnet in the Android app.
//
// It does not create a VpnService. tsnet runs a userspace network stack and
// exposes a loopback TCP proxy, so only this app's DSH traffic goes through the
// tailnet. That keeps the system Tailscale app (and any other VPN) untouched.
package gobridge

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/mobile/bind"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

// StatusCallback receives lifecycle events from the embedded node.
type StatusCallback interface {
	OnAuthURL(url string)
	OnConnected()
	OnError(err string)
}

var (
	mu       sync.Mutex
	server   *tsnet.Server
	proxies  = map[string]net.Listener{}
	cancel   context.CancelFunc
	running  bool
	authURL  string
	initOnce sync.Once
)

func initRuntime(stateDir string) {
	initOnce.Do(func() {
		// Android apps cannot read the kernel interface table without elevated
		// permissions. Provide a synthetic interface so netmon/tsnet start.
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			return []netmon.Interface{{
				Interface: &net.Interface{
					Index: 1,
					MTU:   1500,
					Name:  "wlan0",
					Flags: net.FlagUp | net.FlagMulticast | net.FlagBroadcast,
				},
				AltAddrs: []net.Addr{&net.IPNet{
					IP:   net.IPv4(192, 168, 1, 100),
					Mask: net.CIDRMask(24, 32),
				}},
			}}, nil
		})
		netmon.UpdateLastKnownDefaultRouteInterface("wlan0")
		os.Setenv("STATE_DIRECTORY", stateDir)
		os.Setenv("HOME", stateDir)
		os.Setenv("TMPDIR", stateDir)
	})
}

func firstURL(text, prefix string) string {
	idx := strings.Index(text, prefix)
	if idx < 0 {
		return ""
	}
	rest := text[idx:]
	if end := strings.IndexAny(rest, " \t\r\n"); end >= 0 {
		return rest[:end]
	}
	return rest
}

// Start brings up the embedded node. authKey may be empty, in which case the
// callback receives a login URL. stateDir must be app-private and persistent.
func Start(stateDir, hostname, authKey string, cb StatusCallback) {
	mu.Lock()
	if server != nil {
		mu.Unlock()
		cb.OnError("Tailscale 已经在运行")
		return
	}
	mu.Unlock()

	initRuntime(stateDir)

	srv := &tsnet.Server{
		Hostname: hostname,
		Dir:      stateDir,
		AuthKey:  authKey,
		Logf:     log.Printf,
	}

	mu.Lock()
	server = srv
	authURL = ""
	mu.Unlock()

	go func() {
		ctx, c := context.WithCancel(context.Background())
		mu.Lock()
		cancel = c
		mu.Unlock()

		sent := false
		srv.Logf = func(format string, a ...any) {
			msg := fmt.Sprintf(format, a...)
			log.Print(msg)
			if !sent {
				if u := firstURL(msg, "https://login.tailscale.com/"); u != "" {
					sent = true
					mu.Lock()
					authURL = u
					mu.Unlock()
					cb.OnAuthURL(u)
				}
			}
		}

		if _, err := srv.Up(ctx); err != nil {
			cb.OnError(fmt.Sprintf("Tailscale 启动失败: %v", err))
			mu.Lock()
			if server == srv {
				server = nil
			}
			running = false
			mu.Unlock()
			return
		}
		mu.Lock()
		running = true
		mu.Unlock()
		cb.OnConnected()
	}()
}

// AuthURL returns the pending interactive login URL, if any.
func AuthURL() string {
	mu.Lock()
	defer mu.Unlock()
	return authURL
}

// StartProxy listens on 127.0.0.1 and forwards each accepted TCP connection
// to targetHost:targetPort through the tailnet. It returns the local port.
// One loopback listener is kept per target, so several DSH hosts can be
// reached at the same time without replacing each other.
func StartProxy(targetHost string, targetPort int) (int, error) {
	mu.Lock()
	srv := server
	ok := running
	mu.Unlock()
	if srv == nil || !ok {
		return 0, fmt.Errorf("Tailscale 尚未连接")
	}

	target := net.JoinHostPort(targetHost, fmt.Sprintf("%d", targetPort))
	mu.Lock()
	if ln, exists := proxies[target]; exists {
		port := ln.Addr().(*net.TCPAddr).Port
		mu.Unlock()
		return port, nil
	}
	mu.Unlock()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("本地代理监听失败: %w", err)
	}

	mu.Lock()
	proxies[target] = ln
	mu.Unlock()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				remote, err := srv.Dial(ctx, "tcp", target)
				if err != nil {
					log.Printf("gobridge: dial %s: %v", target, err)
					return
				}
				defer remote.Close()
				go func() {
					_, _ = io.Copy(remote, conn)
					_ = remote.Close()
				}()
				_, _ = io.Copy(conn, remote)
			}()
		}
	}()

	return ln.Addr().(*net.TCPAddr).Port, nil
}

// StopProxy closes all loopback proxies but keeps the tailnet node up.
func StopProxy() {
	mu.Lock()
	defer mu.Unlock()
	for key, ln := range proxies {
		_ = ln.Close()
		delete(proxies, key)
	}
}

// Stop shuts down the node and proxy.
func Stop() {
	StopProxy()
	mu.Lock()
	cancelFn := cancel
	srv := server
	cancel = nil
	server = nil
	running = false
	authURL = ""
	mu.Unlock()

	if cancelFn != nil {
		cancelFn()
	}
	if srv != nil {
		_ = srv.Close()
	}
}

// IsRunning reports whether the node is up and authenticated.
func IsRunning() bool {
	mu.Lock()
	defer mu.Unlock()
	return running
}
