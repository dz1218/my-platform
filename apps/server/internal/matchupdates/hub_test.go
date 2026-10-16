package matchupdates

import (
	"sync"
	"testing"
	"time"
)

func receive(t *testing.T, changes <-chan struct{}) {
	t.Helper()
	select {
	case _, open := <-changes:
		if !open {
			t.Fatal("subscription unexpectedly closed")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("missing invalidation")
	}
}

func noChange(t *testing.T, changes <-chan struct{}) {
	t.Helper()
	select {
	case <-changes:
		t.Fatal("unexpected invalidation")
	default:
	}
}

func TestHubSubscriptionIsolationCoalescingAndRecovery(t *testing.T) {
	h := New()
	defer h.close()
	a, stopA := h.Subscribe("a")
	defer stopA()
	tab, stopTab := h.Subscribe("a")
	defer stopTab()
	b, stopB := h.Subscribe("b")
	defer stopB()
	noChange(t, a) // Never snapshot before LISTEN is established.
	h.ready()
	receive(t, a)
	receive(t, tab)
	receive(t, b)
	for i := 0; i < 1000; i++ {
		h.changed("a")
	}
	receive(t, a)
	receive(t, tab)
	noChange(t, a)
	noChange(t, b)
	stopTab()
	stopTab() // Unsubscription is idempotent.
	if _, open := <-tab; open {
		t.Fatal("canceled subscription still open")
	}
	h.disconnected()
	c, stopC := h.Subscribe("c")
	defer stopC()
	noChange(t, c)
	h.ready() // Recover missed notifications for every account.
	receive(t, a)
	receive(t, b)
	receive(t, c)
	newTab, stopNew := h.Subscribe("a")
	defer stopNew()
	receive(t, newTab)
}

func TestHubConcurrentDisconnectAndShutdown(t *testing.T) {
	h := New()
	h.ready()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, stop := h.Subscribe("user")
			h.changed("user")
			stop()
		}()
	}
	h.close()
	wg.Wait()
	changes, stop := h.Subscribe("user")
	defer stop()
	if _, open := <-changes; open {
		t.Fatal("shutdown subscription still open")
	}
}
