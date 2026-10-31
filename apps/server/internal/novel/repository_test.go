package novel

import (
	"companion/server/internal/auth"
	"companion/server/migrations"
	"companion/server/pkg/database"
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestInputLimits(t *testing.T) {
	for _, tc := range []struct {
		op   string
		body Input
	}{
		{"create", Input{Title: "  "}}, {"chapter-create", Input{Title: strings.Repeat("章", 201)}},
		{"update", Input{Title: "有效标题", Status: "hidden"}}, {"chapter-update", Input{Title: "章节", Content: strings.Repeat("a", 500001)}},
	} {
		if err := tc.body.validate(tc.op); err == nil {
			t.Errorf("accepted invalid %s", tc.op)
		}
	}
	b := Input{Title: "  章节  ", Content: strings.Repeat("文", 10000)}
	if err := b.validate("chapter-update"); err != nil || b.Title != "章节" {
		t.Fatalf("valid content: %v", err)
	}
}

// Opt in to an isolated-schema database test; never modifies existing app tables.
func TestRepositoryIntegration(t *testing.T) {
	if os.Getenv("NOVEL_INTEGRATION") != "1" {
		t.Skip("set NOVEL_INTEGRATION=1 to use a temporary schema")
	}
	ctx := context.Background()
	url := os.Getenv("NOVEL_TEST_DATABASE_URL")
	if url == "" {
		env, err := godotenv.Read("../../.env")
		if err != nil {
			t.Fatal(err)
		}
		url = env["DATABASE_URL"]
	}
	admin, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "novel_test_" + database.ID()
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO users(id,email,password_hash) VALUES('owner','owner@example.test','unused'),('other','other@example.test','unused')`); err != nil {
		t.Fatal(err)
	}
	// Legacy Prisma schemas have no database default for updated_at.
	if _, err = db.Exec(ctx, `ALTER TABLE users ALTER COLUMN updated_at DROP DEFAULT`); err != nil {
		t.Fatal(err)
	}
	if _, err = (auth.Repository{DB: db}).Create(ctx, "legacy@example.test", "兼容账号", "unused", "FEMALE"); err != nil {
		t.Fatalf("legacy registration: %v", err)
	}
	r := Repository{DB: db}
	id, err := r.Mutate(ctx, "owner", "", "", "create", Input{Title: "测试小说"})
	if err != nil {
		t.Fatal(err)
	}
	chapterID, err := r.Mutate(ctx, "owner", id, "", "chapter-create", Input{Title: "草稿"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ReadChapter(ctx, id, chapterID, ""); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("public draft leaked: %v", err)
	}
	if _, err = r.ReadChapter(ctx, id, chapterID, "other"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("other user draft leaked: %v", err)
	}
	for _, op := range []string{"update", "delete", "chapter-create", "chapter-update", "chapter-publish", "chapter-delete"} {
		if _, err = r.Mutate(ctx, "other", id, chapterID, op, Input{Title: "越权", Status: "ongoing"}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("unauthorized %s: %v", op, err)
		}
	}
	if _, err = r.Mutate(ctx, "", id, chapterID, "chapter-delete", Input{}); err == nil {
		t.Fatal("anonymous write succeeded")
	}
	n, err := r.Get(ctx, id, "")
	if err != nil || len(n.Chapters) != 0 {
		t.Fatalf("public chapter list leaked: %+v %v", n, err)
	}
	n, err = r.Get(ctx, id, "owner")
	if err != nil || len(n.Chapters) != 1 {
		t.Fatalf("owner draft hidden: %+v %v", n, err)
	}
	content := strings.Repeat("章节内容", 5000)
	if _, err = r.Mutate(ctx, "owner", id, chapterID, "chapter-update", Input{Title: "第一章", Content: content}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Mutate(ctx, "owner", id, chapterID, "chapter-publish", Input{Published: true}); err != nil {
		t.Fatal(err)
	}
	c, err := r.ReadChapter(ctx, id, chapterID, "")
	if err != nil || c.Content != content {
		t.Fatalf("published chapter: %v", err)
	}
	if _, err = r.ReadChapter(ctx, "wrong-novel", chapterID, "owner"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("cross-novel chapter leaked")
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.Mutate(ctx, "owner", id, "", "chapter-create", Input{Title: "并发章节"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	n, err = r.Get(ctx, id, "owner")
	if err != nil || len(n.Chapters) != 9 {
		t.Fatalf("concurrent chapters: %d %v", len(n.Chapters), err)
	}
	for i, c := range n.Chapters {
		if c.OrderIndex != i+1 {
			t.Fatalf("chapter order: %+v", c)
		}
	}
	if _, err = r.Mutate(ctx, "owner", id, chapterID, "chapter-publish", Input{Published: false}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.ReadChapter(ctx, id, chapterID, ""); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("unpublished chapter still public")
	}
	if _, err = r.Mutate(ctx, "owner", id, "", "delete", Input{}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM "Chapter" WHERE "novelId"=$1`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade: %d %v", count, err)
	}
	t.Run("shelf pagination and search", func(t *testing.T) {
		if _, err := db.Exec(ctx, `UPDATE users SET name='夜行人' WHERE id='owner'`); err != nil {
			t.Fatal(err)
		}
		for i := 1; i <= 25; i++ {
			if _, err := db.Exec(ctx, `INSERT INTO "Novel"(id,title,description,"authorId","updatedAt") VALUES($1,$2,$3,'owner','2026-01-01')`, fmt.Sprintf("book-%02d", i), fmt.Sprintf("雨夜 %02d", i), "literal 100% _ \\ voyage"); err != nil {
				t.Fatal(err)
			}
		}
		seen := map[string]bool{}
		for p := 1; p <= 3; p++ {
			page, err := r.List(ctx, Filters{Page: p, PageSize: 12})
			want := 12
			if p == 3 {
				want = 1
			}
			if err != nil || page.Total != 25 || page.Page != p || len(page.Items) != want {
				t.Fatalf("page %d: %+v, %v", p, page, err)
			}
			for _, n := range page.Items {
				if seen[n.ID] {
					t.Fatalf("duplicate novel across pages: %s", n.ID)
				}
				seen[n.ID] = true
			}
			if p == 1 && page.Items[0].ID != "book-25" {
				t.Fatal("equal timestamps must have stable ID ordering")
			}
		}
		for _, tc := range []struct {
			q     string
			total int
		}{{"雨夜 13", 1}, {"夜行人", 25}, {"VOYAGE", 25}, {"100%", 25}, {"_", 25}, {`\`, 25}, {"100_", 0}, {"不存在", 0}} {
			page, err := r.List(ctx, Filters{Q: tc.q, Page: 1, PageSize: 12})
			if err != nil || page.Total != tc.total || len(page.Items) != min(12, tc.total) {
				t.Fatalf("search %q: %+v, %v", tc.q, page, err)
			}
		}
		if _, err := db.Exec(ctx, `DELETE FROM "Novel" WHERE id='book-01'`); err != nil {
			t.Fatal(err)
		}
		page, err := r.List(ctx, Filters{Page: 3, PageSize: 12})
		if err != nil || page.Page != 2 || page.Total != 24 || len(page.Items) != 12 {
			t.Fatalf("deleted last page: %+v, %v", page, err)
		}
		page, err = r.List(ctx, Filters{Q: "不存在", Page: 999, PageSize: 12})
		if err != nil || page.Page != 1 || page.Total != 0 || page.Items == nil || len(page.Items) != 0 {
			t.Fatalf("empty search: %+v, %v", page, err)
		}
	})
}
