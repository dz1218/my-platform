package novel

import (
	"net/url"
	"strings"
	"testing"
)

func TestParseFilters(t *testing.T) {
	f, err := ParseFilters(url.Values{})
	if err != nil || f.Page != 1 || f.PageSize != 12 || f.Q != "" {
		t.Fatalf("defaults: %+v, %v", f, err)
	}
	f, err = ParseFilters(url.Values{"q": {"  雨夜  "}, "page": {"3"}, "pageSize": {"24"}})
	if err != nil || f.Q != "雨夜" || f.Page != 3 || f.PageSize != 24 {
		t.Fatalf("explicit filters: %+v, %v", f, err)
	}
	for _, query := range []string{"page=0", "page=-1", "page=1.5", "page=1000001", "page=", "page=1&page=2", "pageSize=0", "pageSize=61", "pageSize=12&pageSize=24", "q=a&q=b", "q=%00", "q=" + strings.Repeat("字", 81)} {
		t.Run(query, func(t *testing.T) {
			values, _ := url.ParseQuery(query)
			if _, err := ParseFilters(values); err == nil {
				t.Fatal("invalid filters accepted")
			}
		})
	}
}
