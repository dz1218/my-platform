.PHONY: dev all api agent worker infra migrate test check

dev:
	pnpm dev
api:
	cd apps/server && go run ./cmd/api
infra:
	docker compose up -d postgres redis
migrate:
	cd apps/server && go run ./cmd/api -migrate-only
test:
	cd apps/server && go test ./...
check:
	pnpm --filter web typecheck
	cd apps/server && go vet ./... && go test ./...

all:
	pnpm dev:all
agent:
	pnpm agent:dev
worker:
	pnpm worker:dev
