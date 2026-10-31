package novel

import (
	"companion/server/pkg/response"
	"context"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type Filters struct {
	Q        string
	Page     int
	PageSize int
}

type Page struct {
	Items    []Novel `json:"items"`
	Total    int     `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
}

func ParseFilters(query url.Values) (Filters, error) {
	f := Filters{Q: strings.TrimSpace(query.Get("q")), Page: 1, PageSize: 12}
	if len(query["q"]) > 1 || utf8.RuneCountInString(f.Q) > 80 || strings.ContainsRune(f.Q, 0) {
		return f, response.BadRequest("搜索词最多 80 个字")
	}
	for _, p := range []struct {
		key    string
		target *int
		max    int
	}{{"page", &f.Page, 1000000}, {"pageSize", &f.PageSize, 60}} {
		if raw, exists := query[p.key]; exists {
			if len(raw) != 1 {
				return f, response.BadRequest("重复的分页参数")
			}
			value, err := strconv.Atoi(raw[0])
			if err != nil || value < 1 || value > p.max {
				return f, response.BadRequest("分页参数无效")
			}
			*p.target = value
		}
	}
	return f, nil
}

const shelfFrom = ` FROM "Novel" n JOIN users u ON u.id=n."authorId"
 WHERE ($1='' OR n.title ILIKE $1 OR n.description ILIKE $1 OR COALESCE(u.name,'匿名') ILIKE $1)`

func (r Repository) List(ctx context.Context, f Filters) (Page, error) {
	page := Page{Items: []Novel{}, Page: f.Page, PageSize: f.PageSize}
	if f.Page < 1 || f.Page > 1000000 || f.PageSize < 1 || f.PageSize > 60 {
		return page, response.BadRequest("分页参数无效")
	}
	query := f.Q
	if query != "" {
		query = "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(query) + "%"
	}
	// Count and rows must describe the same snapshot, including after a deletion.
	tx, err := r.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return page, err
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, `SELECT count(*)`+shelfFrom, query).Scan(&page.Total); err != nil {
		return page, err
	}
	page.Page = min(page.Page, max(1, (page.Total+page.PageSize-1)/page.PageSize))
	rows, err := tx.Query(ctx, `SELECT `+novelColumns+shelfFrom+` ORDER BY n."updatedAt" DESC,n.id DESC LIMIT $2 OFFSET $3`, query, page.PageSize, (page.Page-1)*page.PageSize)
	if err != nil {
		return page, err
	}
	for rows.Next() {
		n, err := scanNovel(rows)
		if err != nil {
			rows.Close()
			return page, err
		}
		page.Items = append(page.Items, n)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return page, err
	}
	return page, tx.Commit(ctx)
}
