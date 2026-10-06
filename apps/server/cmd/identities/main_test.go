package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateCatalogDoesNotRequireDatabase(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	file := filepath.Join(t.TempDir(), "catalog.json")
	data := `{"schemaVersion":1,"complete":false,"occupations":[{"code":"editor","name":"编辑","minAge":22}],"identities":[{"id":"linwan","name":"林晚","age":27,"gender":"FEMALE","city":"上海","background":"图书编辑","avatarUrl":"","occupationCode":"editor","persona":{"personality":"坦诚","speakingStyle":"直接","interests":["阅读"],"careerStage":"职业稳定","backstory":"毕业后进入出版业","goals":"编辑好书"}}]}`
	if err := os.WriteFile(file, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := run([]string{"-file", file, "-validate-only"}, &out); err != nil || !strings.Contains(out.String(), `"valid":true`) {
		t.Fatal(out.String(), err)
	}
	if err := run([]string{"-file", file, "-dry-run"}, &out); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatal("dry run without DB did not fail clearly", err)
	}
	if err := run([]string{"-file", file, "-dry-run", "-validate-only"}, &out); err == nil {
		t.Fatal("contradictory flags accepted")
	}
}
