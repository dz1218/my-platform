// takeover manages operator assignments using trusted server access.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"companion/server/internal/behavior"
	"companion/server/internal/delivery"
	"companion/server/pkg/database"
	"github.com/joho/godotenv"
)

func main() {
	if err := run(); err != nil {
		slog.Error("assignment failed", "error", err)
		os.Exit(1)
	}
}
func run() error {
	id := flag.String("conversation", "", "conversation ID")
	operator := flag.String("operator", "", "assigned operator user ID")
	actor := flag.String("actor", "", "administrator user ID for audit")
	revoke := flag.Bool("revoke", false, "revoke existing assignment")
	flag.Parse()
	if *id == "" || *actor == "" || (*operator == "" && !*revoke) || (*operator != "" && *revoke) {
		return fmt.Errorf("specify -conversation, -actor and either -operator or -revoke")
	}
	_ = godotenv.Load(".env", "../../.env")
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	policyPath := os.Getenv("BEHAVIOR_CONFIG")
	if policyPath == "" {
		policyPath = "config/behavior.json"
	}
	policies, err := behavior.Load(policyPath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := database.Open(ctx, url)
	if err != nil {
		return err
	}
	defer db.Close()
	if err = (delivery.Repository{DB: db}).AssignOperator(ctx, *id, *operator, *actor, policies); err != nil {
		return err
	}
	slog.Info("assignment updated", "conversation", *id, "operator", *operator)
	return nil
}
