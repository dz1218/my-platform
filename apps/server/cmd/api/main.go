package main

import (
	"companion/server/internal/behavior"
	"companion/server/internal/config"
	"companion/server/internal/httpapi"
	"companion/server/migrations"
	"companion/server/pkg/database"
	"context"
	"flag"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	migrateOnly := flag.Bool("migrate-only", false, "apply database migrations and exit")
	flag.Parse()
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
	if *migrateOnly {
		slog.Info("migrations applied")
		return nil
	}
	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	cache := redis.NewClient(options)
	defer cache.Close()
	if err = cache.Ping(startup).Err(); err != nil {
		return err
	}
	policies, err := behavior.Load(cfg.BehaviorFile)
	if err != nil {
		return err
	}
	router := httpapi.New(cfg, db, cache, policies)
	server := &http.Server{Addr: cfg.Address, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	result := make(chan error, 1)
	go func() {
		slog.Info("companion API listening", "address", cfg.Address)
		result <- server.ListenAndServe()
	}()
	select {
	case <-stop:
		ctx, cancel := context.WithTimeout(context.Background(), 105*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	case err := <-result:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}
