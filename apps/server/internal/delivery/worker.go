package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"math/rand"
	"sync"
	"time"
)

type Worker struct {
	Repo    Repository
	Builder aicontext.Builder
	Model   provider.ChatModel
}

func (w Worker) Run(ctx context.Context) {
	var group sync.WaitGroup
	// Bounded concurrency; multiple worker processes can share the leased queue.
	for i := 0; i < 4; i++ {
		group.Add(1)
		go func() { defer group.Done(); w.generateLoop(ctx) }()
	}
	group.Add(1)
	go func() {
		defer group.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for n := 0; n < 100; n++ {
					done, err := w.Repo.Deliver(ctx)
					if err != nil && !errors.Is(err, context.Canceled) {
						slog.Error("reply delivery failed", "error", err)
					}
					if err != nil || !done {
						break
					}
				}
			}
		}
	}()
	<-ctx.Done()
	group.Wait()
}
func (w Worker) generateLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			j, err := w.Repo.Claim(ctx)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				if ctx.Err() == nil {
					slog.Error("reply claim failed", "error", err)
				}
				continue
			}
			if j.Attempts > j.Policy.MaxAttempts {
				_ = w.Repo.Failed(ctx, j)
				continue
			}
			w.generate(ctx, j)
		}
	}
}
func (w Worker) generate(parent context.Context, j Job) {
	ctx, cancel := context.WithTimeout(parent, 100*time.Second)
	defer cancel()
	request, err := w.Builder.Build(ctx, j.Conversation)
	var reply provider.Reply
	if err == nil {
		reply, err = w.Model.Generate(ctx, request)
	}
	if err == nil {
		due := j.Policy.DeliverAt(j.RequestedAt, time.Now(), reply.Content, rand.Float64())
		err = w.Repo.Schedule(ctx, j, reply.Content, reply.PromptVersion, due)
	}
	if err != nil {
		// Shutdown leaves the lease for recovery instead of consuming another retry.
		if parent.Err() != nil {
			return
		}
		slog.Error("reply generation failed", "conversation", j.Conversation.ID, "attempt", j.Attempts, "error", err)
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if e := w.Repo.Failed(cleanup, j); e != nil {
			slog.Error("reply retry scheduling failed", "error", e)
		}
	}
}
