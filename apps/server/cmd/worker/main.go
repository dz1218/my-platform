package main

import (
	aicontext "companion/server/internal/ai/context"
	"companion/server/internal/ai/provider"
	"companion/server/internal/config"
	"companion/server/internal/conversation"
	"companion/server/internal/delivery"
	"companion/server/internal/identity"
	"companion/server/migrations"
	"companion/server/pkg/database"
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := database.Open(startup, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err = migrations.Apply(startup, db); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	worker := delivery.Worker{Repo: delivery.Repository{DB: db}, Builder: aicontext.Builder{Identities: identity.Repository{DB: db}, Messages: conversation.Repository{DB: db}}, Model: provider.NewAgent(cfg.AgentURL, cfg.AgentToken)}
	slog.Info("reply worker started")
	worker.Run(ctx)
	return nil
}
