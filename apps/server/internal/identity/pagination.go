package identity

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
	Q              string
	OccupationCode string
	AgeMin         int
	AgeMax         int
	Page           int
	PageSize       int
}
type OccupationChoice struct {
	Code string `json:"code"`
	Name string `json:"name"`
}
type Page[T any] struct {
	Items          []T                `json:"items"`
	Total          int                `json:"total"`
	AvailableTotal int                `json:"availableTotal"`
	Page           int                `json:"page"`
	PageSize       int                `json:"pageSize"`
	NextPage       *int               `json:"nextPage"`
	Occupations    []OccupationChoice `json:"occupations"`
}

func ParseFilters(q url.Values) (Filters, error) {
	f := Filters{Q: strings.TrimSpace(q.Get("q")), OccupationCode: q.Get("occupationCode"), AgeMin: 18, AgeMax: 50, Page: 1, PageSize: 24}
	if utf8.RuneCountInString(f.Q) > 80 || (f.OccupationCode != "" && !catalogCode.MatchString(f.OccupationCode)) {
		return f, response.BadRequest("搜索词或职业筛选无效")
	}
	for _, p := range []struct {
		key      string
		target   *int
		min, max int
	}{{"ageMin", &f.AgeMin, 18, 50}, {"ageMax", &f.AgeMax, 18, 50}, {"page", &f.Page, 1, 1000000}, {"pageSize", &f.PageSize, 1, 60}} {
		if raw, exists := q[p.key]; exists {
			if len(raw) != 1 {
				return f, response.BadRequest("重复的分页参数")
			}
			value, err := strconv.Atoi(raw[0])
			if err != nil || value < p.min || value > p.max {
				return f, response.BadRequest("年龄或分页参数无效")
			}
			*p.target = value
		}
	}
	if f.AgeMin > f.AgeMax {
		return f, response.BadRequest("最小年龄不能大于最大年龄")
	}
	return f, nil
}

const availableSQL = `h.identity_id IS NULL AND NOT EXISTS(SELECT 1 FROM identity_inheritances mine WHERE mine.user_id=$1)`
const pageScope = `(($6 AND i.gender=COALESCE((SELECT gender FROM users WHERE id=$1),'')) OR (NOT $6 AND NOT EXISTS(SELECT 1 FROM identity_inheritances mine WHERE mine.user_id=$1 AND mine.identity_id=i.id)))`
const pageFilter = pageScope + ` AND ($2='' OR i.name ILIKE $2 OR i.city ILIKE $2 OR i.background ILIKE $2 OR i.occupation ILIKE $2)
 AND ($3='' OR i.occupation_code=$3) AND i.age BETWEEN $4 AND $5`

// A repeatable read keeps page counts, choices and items on one database snapshot.
func (r Repository) catalogPage(ctx context.Context, user string, f Filters, inheritance bool) (Page[InheritanceOption], error) {
	page := Page[InheritanceOption]{Items: []InheritanceOption{}, Occupations: []OccupationChoice{}, Page: f.Page, PageSize: f.PageSize}
	if f.Page < 1 || f.Page > 1000000 || f.PageSize < 1 || f.PageSize > 60 || f.AgeMin < 18 || f.AgeMax > 50 || f.AgeMin > f.AgeMax {
		return page, response.BadRequest("年龄或分页参数无效")
	}
	query := f.Q
	if query != "" {
		query = "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(query) + "%"
	}
	args := []any{user, query, f.OccupationCode, f.AgeMin, f.AgeMax, inheritance}
	tx, err := r.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return page, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE NOT $6 OR (`+availableSQL+`)) FROM identities i LEFT JOIN identity_inheritances h ON h.identity_id=i.id WHERE `+pageFilter, args...).Scan(&page.Total, &page.AvailableTotal)
	if err != nil {
		return page, err
	}
	rows, err := tx.Query(ctx, `SELECT `+PublicColumns+`,(`+availableSQL+`) FROM identities i LEFT JOIN identity_inheritances h ON h.identity_id=i.id WHERE `+pageFilter+` ORDER BY i.occupation_code,i.age,i.id LIMIT $7 OFFSET $8`, append(args, f.PageSize, (f.Page-1)*f.PageSize)...)
	if err != nil {
		return page, err
	}
	for rows.Next() {
		var i InheritanceOption
		if err = rows.Scan(append(PublicDestinations(&i.Identity), &i.Available)...); err != nil {
			rows.Close()
			return page, err
		}
		page.Items = append(page.Items, i)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return page, err
	}
	// Choice lists describe this account's complete scope, not just the current filter.
	rows, err = tx.Query(ctx, `SELECT DISTINCT i.occupation_code,i.occupation FROM identities i WHERE i.occupation_code<>'' AND
 (($2 AND i.gender=COALESCE((SELECT gender FROM users WHERE id=$1),'')) OR (NOT $2 AND NOT EXISTS(SELECT 1 FROM identity_inheritances mine WHERE mine.user_id=$1 AND mine.identity_id=i.id))) ORDER BY i.occupation_code,i.occupation`, user, inheritance)
	if err != nil {
		return page, err
	}
	for rows.Next() {
		var o OccupationChoice
		if err = rows.Scan(&o.Code, &o.Name); err != nil {
			rows.Close()
			return page, err
		}
		page.Occupations = append(page.Occupations, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return page, err
	}
	if f.Page*f.PageSize < page.Total {
		next := f.Page + 1
		page.NextPage = &next
	}
	return page, tx.Commit(ctx)
}

func (r Repository) DiscoverPage(ctx context.Context, user string, f Filters) (Page[Identity], error) {
	source, err := r.catalogPage(ctx, user, f, false)
	page := Page[Identity]{Items: []Identity{}, Total: source.Total, AvailableTotal: source.AvailableTotal, Page: source.Page, PageSize: source.PageSize, NextPage: source.NextPage, Occupations: source.Occupations}
	for _, i := range source.Items {
		page.Items = append(page.Items, i.Identity)
	}
	return page, err
}
func (r Repository) InheritancePage(ctx context.Context, user string, f Filters) (Page[InheritanceOption], error) {
	return r.catalogPage(ctx, user, f, true)
}
