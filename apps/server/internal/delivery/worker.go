package delivery

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/behavior"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"sync"
	"time"
)

type Worker struct {
	Repo     Repository
	Builder  aicontext.Builder
	Model    provider.ChatModel
	Policies behavior.Catalog
}

func (w Worker) Run(ctx context.Context) {
	var group sync.WaitGroup
	group.Add(1)
	go func() {
		defer group.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := w.enrich(ctx); err != nil && ctx.Err() == nil {
					slog.Error("enrichment queue failed", "error", err)
				}
			}
		}
	}()
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
		nextProactiveScan := time.Time{}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// DB eligibility and an 8-hour attempt budget prevent model polling.
				if time.Now().After(nextProactiveScan) {
					nextProactiveScan = time.Now().Add(time.Minute)
					if err := w.Repo.RefreshDailyStates(ctx); err != nil && ctx.Err() == nil {
						slog.Error("virtual state refresh failed", "error", err)
					}
					if err := w.Repo.QueueProactive(ctx, w.RepoPolicy()); err != nil && ctx.Err() == nil {
						slog.Error("proactive scan failed", "error", err)
					}
				}
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
	release, locked, err := w.Repo.generationLock(ctx, j.Conversation.ID)
	if err != nil {
		slog.Error("generation lock failed", "error", err)
		return
	}
	if !locked {
		if err = w.Repo.deferBusy(ctx, j); err != nil {
			slog.Error("defer busy conversation failed", "error", err)
		}
		return
	}
	defer release()
	current, err := w.Repo.Current(ctx, j)
	if err != nil {
		slog.Error("reply freshness check failed", "conversation", j.Conversation.ID, "error", err)
		return
	}
	if !current {
		if err = w.Repo.CancelClaim(ctx, j); err != nil {
			slog.Error("stale reply cancellation failed", "error", err)
		}
		return
	}
	deferred, err := w.Repo.deferForTyping(ctx, j)
	if err != nil {
		slog.Error("typing deferral failed", "error", err)
		return
	}
	if deferred {
		return
	}
	request, err := w.Builder.Build(ctx, j.Conversation)
	var reply provider.Reply
	if err == nil {
		request.Kind = jobKind(j)
		if j.OpportunityID != nil {
			var topic, source string
			err = w.Repo.DB.QueryRow(ctx, `SELECT o.topic_key,m.content FROM proactive_opportunities o JOIN messages m ON m.id=o.source_message_id WHERE o.id=$1 AND o.conversation_id=$2`, *j.OpportunityID, j.Conversation.ID).Scan(&topic, &source)
			if err == nil {
				request.Messages = append(request.Messages, provider.Message{Role: "user", Content: "已授权跟进主题：" + topic + "；原始用户陈述：" + source})
			}
		}
		request.AllowWait = false
		request.MaxWaitSeconds = j.Policy.MaxWaitSeconds
		request.PendingSeconds = int(time.Since(j.RequestedAt).Seconds())
		if request.PendingSeconds < 0 {
			request.PendingSeconds = 0
		}
		if err == nil {
			reply, err = w.Model.Generate(ctx, request)
		}
	}
	if err == nil {
		if reply.Action == "wait" {
			err = errors.New("agent returned wait although scheduling belongs to server")
		} else {
			if reply.Action == "REPLY" || reply.Action == "SILENCE" {
				err = w.Repo.SchedulePlan(ctx, j, reply, time.Now())
			} else {
				err = w.Repo.Schedule(ctx, j, reply.Content, reply.PromptVersion, time.Now())
			}
		}
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

func (w Worker) RepoPolicy() behavior.Policy {
	if w.Policies.Default.Version != "" {
		return w.Policies.Default
	}
	return behavior.Policy{Version: "proactive-v2", DebounceSeconds: 1, MaxBufferSeconds: 8, MaxAttempts: 2, RetrySeconds: 30, MaxWaitSeconds: 10}
}
