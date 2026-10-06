package main

import (
	"companion/server/internal/delivery"
	"companion/server/internal/identity"
	"companion/server/pkg/database"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("identities", flag.ContinueOnError)
	file := flags.String("file", "", "catalog JSON file")
	validate := flags.Bool("validate-only", false, "validate the file without connecting to a database")
	dryRun := flags.Bool("dry-run", false, "preview changes using a read-only database transaction")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *file == "" || flags.NArg() != 0 || (*validate && *dryRun) {
		return fmt.Errorf("usage: identities -file catalog.json [-validate-only | -dry-run]")
	}
	input, err := os.Open(*file)
	if err != nil {
		return fmt.Errorf("cannot open catalog file")
	}
	catalog, err := identity.ReadCatalog(input)
	input.Close()
	if err != nil {
		return err
	}
	if *validate {
		return json.NewEncoder(out).Encode(map[string]any{"valid": true, "occupations": len(catalog.Occupations), "identities": len(catalog.Identities), "complete": catalog.Complete})
	}
	// Match the API's precedence while requiring only DATABASE_URL. Validation
	// above deliberately remains independent of environment files and services.
	_ = godotenv.Load(".env", "../../.env")
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required (or use -validate-only)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("cannot connect to the catalog database")
	}
	defer db.Close()
	// Intentionally no automatic migration: a preview must never alter schema.
	result, err := (delivery.Repository{DB: db}).ImportCatalog(ctx, catalog, *dryRun)
	if err != nil {
		return fmt.Errorf("catalog import failed: %w", err)
	}
	return json.NewEncoder(out).Encode(result)
}
