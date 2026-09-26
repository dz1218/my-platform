package novel

import (
	"companion/server/pkg/database"
	"companion/server/pkg/response"
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"unicode/utf8"
)

type Repository struct{ DB *pgxpool.Pool }
type Author struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Novel struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	Status       string    `json:"status"`
	AuthorID     string    `json:"authorId"`
	Author       Author    `json:"author"`
	ChapterCount int       `json:"chapterCount"`
	Chapters     []Chapter `json:"chapters"`
}
type Chapter struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	OrderIndex int    `json:"orderIndex"`
	Published  bool   `json:"published"`
	NovelID    string `json:"novelId"`
}
type Input struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Content     string `json:"content"`
	Published   bool   `json:"published"`
}

func (b *Input) validate(operation string) error {
	b.Title = strings.TrimSpace(b.Title)
	b.Description = strings.TrimSpace(b.Description)
	if operation == "create" || operation == "update" || operation == "chapter-create" || operation == "chapter-update" {
		if b.Title == "" || utf8.RuneCountInString(b.Title) > 200 {
			return response.BadRequest("标题需要 1–200 个字")
		}
	}
	if utf8.RuneCountInString(b.Description) > 5000 || len(b.Content) > 500000 {
		return response.BadRequest("内容过长，请缩短后再保存")
	}
	if operation == "update" && b.Status != "ongoing" && b.Status != "completed" {
		return response.BadRequest("请选择连载中或已完结")
	}
	return nil
}

const novelColumns = `n.id,n.title,COALESCE(n.description,''),n.status,n."authorId",COALESCE(u.name,'匿名'),(SELECT count(*) FROM "Chapter" c WHERE c."novelId"=n.id AND c.published)`

func scanNovel(row pgx.Row) (Novel, error) {
	var n Novel
	err := row.Scan(&n.ID, &n.Title, &n.Description, &n.Status, &n.AuthorID, &n.Author.Name, &n.ChapterCount)
	n.Author.ID = n.AuthorID
	n.Chapters = []Chapter{}
	return n, err
}
func (r Repository) List(ctx context.Context) ([]Novel, error) {
	rows, err := r.DB.Query(ctx, `SELECT `+novelColumns+` FROM "Novel" n JOIN users u ON u.id=n."authorId" ORDER BY n."updatedAt" DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Novel{}
	for rows.Next() {
		n, err := scanNovel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, n)
	}
	return items, rows.Err()
}
func (r Repository) Get(ctx context.Context, id, userID string) (Novel, error) {
	n, err := scanNovel(r.DB.QueryRow(ctx, `SELECT `+novelColumns+` FROM "Novel" n JOIN users u ON u.id=n."authorId" WHERE n.id=$1`, id))
	if err != nil {
		return n, err
	}
	rows, err := r.DB.Query(ctx, `SELECT id,title,"orderIndex",published,"novelId" FROM "Chapter" WHERE "novelId"=$1 AND (published OR $2) ORDER BY "orderIndex"`, id, n.AuthorID == userID)
	if err != nil {
		return n, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Chapter
		if err = rows.Scan(&c.ID, &c.Title, &c.OrderIndex, &c.Published, &c.NovelID); err != nil {
			return n, err
		}
		n.Chapters = append(n.Chapters, c)
	}
	return n, rows.Err()
}
func (r Repository) ReadChapter(ctx context.Context, id, chapterID, userID string) (Chapter, error) {
	var c Chapter
	err := r.DB.QueryRow(ctx, `SELECT c.id,c.title,c.content,c."orderIndex",c.published,c."novelId" FROM "Chapter" c JOIN "Novel" n ON n.id=c."novelId" WHERE c.id=$1 AND n.id=$2 AND (c.published OR n."authorId"=$3)`, chapterID, id, userID).Scan(&c.ID, &c.Title, &c.Content, &c.OrderIndex, &c.Published, &c.NovelID)
	return c, err
}

// Every write is authorized in the database transaction. Locking the parent also
// serializes chapter ordering, so two simultaneous creates cannot reuse a number.
func (r Repository) Mutate(ctx context.Context, userID, id, chapterID, operation string, b Input) (string, error) {
	if userID == "" {
		return "", &response.Error{Status: 401, Code: "unauthorized", Message: "请先登录"}
	}
	if err := b.validate(operation); err != nil {
		return "", err
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if operation == "create" {
		id = database.ID()
		_, err = tx.Exec(ctx, `INSERT INTO "Novel"(id,title,description,"authorId","updatedAt") VALUES($1,$2,$3,$4,now())`, id, b.Title, b.Description, userID)
	} else {
		var owner string
		if err = tx.QueryRow(ctx, `SELECT "authorId" FROM "Novel" WHERE id=$1 AND "authorId"=$2 FOR UPDATE`, id, userID).Scan(&owner); err != nil {
			return "", err
		}
		switch operation {
		case "update":
			_, err = tx.Exec(ctx, `UPDATE "Novel" SET title=$2,description=$3,status=$4,"updatedAt"=now() WHERE id=$1`, id, b.Title, b.Description, b.Status)
		case "delete":
			_, err = tx.Exec(ctx, `DELETE FROM "Novel" WHERE id=$1`, id)
		case "chapter-create":
			chapterID = database.ID()
			_, err = tx.Exec(ctx, `INSERT INTO "Chapter"(id,title,content,"orderIndex","novelId","updatedAt") SELECT $1,$2,'',COALESCE(MAX("orderIndex"),0)+1,$3,now() FROM "Chapter" WHERE "novelId"=$3`, chapterID, b.Title, id)
		case "chapter-update", "chapter-publish", "chapter-delete":
			var found string
			if err = tx.QueryRow(ctx, `SELECT id FROM "Chapter" WHERE id=$1 AND "novelId"=$2 FOR UPDATE`, chapterID, id).Scan(&found); err != nil {
				return "", err
			}
			switch operation {
			case "chapter-update":
				_, err = tx.Exec(ctx, `UPDATE "Chapter" SET title=$2,content=$3,"updatedAt"=now() WHERE id=$1`, chapterID, b.Title, b.Content)
			case "chapter-publish":
				_, err = tx.Exec(ctx, `UPDATE "Chapter" SET published=$2,"updatedAt"=now() WHERE id=$1`, chapterID, b.Published)
			case "chapter-delete":
				_, err = tx.Exec(ctx, `DELETE FROM "Chapter" WHERE id=$1`, chapterID)
			}
		default:
			return "", response.BadRequest("未知操作")
		}
		if err == nil && strings.HasPrefix(operation, "chapter-") {
			_, err = tx.Exec(ctx, `UPDATE "Novel" SET "updatedAt"=now() WHERE id=$1`, id)
		}
	}
	if err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	if strings.HasPrefix(operation, "chapter-") {
		return chapterID, nil
	}
	return id, nil
}
