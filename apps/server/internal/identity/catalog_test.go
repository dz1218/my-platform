package identity

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"testing"
)

func exampleCatalog() Catalog {
	return Catalog{SchemaVersion: 1, Occupations: []OccupationTemplate{{Code: "editor", Name: "编辑", MinAge: 22}}, Identities: []CatalogIdentity{{ID: "identity_linwan", Name: "林晚", Age: 27, Gender: "FEMALE", City: "上海", Background: "在上海从事图书编辑。", OccupationCode: "editor", Persona: Persona{Personality: "坦诚，有耐心", SpeakingStyle: "自然完整的句子", Interests: []string{"阅读"}, CareerStage: "有五年编辑经验", Backstory: "毕业后进入出版行业", Goals: "做好一本新书"}}}}
}

func TestCatalogReadValidation(t *testing.T) {
	base := exampleCatalog()
	raw, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ReadCatalog(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Resolved()[0].Occupation != "编辑" {
		t.Fatal("occupation template was not resolved")
	}
	for _, input := range []string{string(raw) + ` {}`, strings.Replace(string(raw), `"schemaVersion":1`, `"schemaVersion":1,"unexpected":true`, 1)} {
		if _, err = ReadCatalog(strings.NewReader(input)); err == nil {
			t.Fatal("invalid JSON shape accepted")
		}
	}
	for _, tc := range []struct {
		name   string
		change func(*Catalog)
	}{
		{"minor", func(c *Catalog) { c.Identities[0].Age = 17 }},
		{"occupation experience", func(c *Catalog) { c.Identities[0].Age = 20 }},
		{"over age range", func(c *Catalog) { c.Identities[0].Age = 51 }},
		{"duplicate identity", func(c *Catalog) { c.Identities = append(c.Identities, c.Identities[0]) }},
		{"duplicate age", func(c *Catalog) { i := c.Identities[0]; i.ID = "another"; c.Identities = append(c.Identities, i) }},
		{"unknown occupation", func(c *Catalog) { c.Identities[0].OccupationCode = "missing" }},
		{"missing personality", func(c *Catalog) { c.Identities[0].Persona.Personality = "" }},
		{"oversized backstory", func(c *Catalog) { c.Identities[0].Persona.Backstory = strings.Repeat("字", 1501) }},
		{"unsafe avatar", func(c *Catalog) { c.Identities[0].AvatarURL = "javascript:alert(1)" }},
		{"incomplete complete catalog", func(c *Catalog) { c.Complete = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := exampleCatalog()
			tc.change(&c)
			if err := c.Validate(); err == nil {
				t.Fatal("invalid catalog accepted")
			}
		})
	}
}

func TestCompleteCatalogRequiresTenPerOccupation(t *testing.T) {
	c := Catalog{SchemaVersion: 1, Complete: true}
	for n := 0; n < 100; n++ {
		code := fmt.Sprintf("occupation_%03d", n)
		c.Occupations = append(c.Occupations, OccupationTemplate{Code: code, Name: fmt.Sprintf("职业%d", n), MinAge: 22})
		for age := 22; age < 32; age++ {
			i := exampleCatalog().Identities[0]
			i.ID = fmt.Sprintf("identity_%03d_%d", n, age)
			i.Age = age
			i.OccupationCode = code
			c.Identities = append(c.Identities, i)
		}
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	// Keep 100 occupations and 1000 identities but distribute them 9/11.
	c.Identities[0].OccupationCode = "occupation_001"
	c.Identities[0].Age = 32
	if err := c.Validate(); err == nil {
		t.Fatal("uneven complete catalog accepted")
	}
}

func TestCatalogPublicIdentityExcludesPrivatePersona(t *testing.T) {
	i := exampleCatalog().Resolved()[0]
	i.PersonaVersion = 7
	raw, err := json.Marshal(i)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "persona") || strings.Contains(string(raw), "personality") {
		t.Fatal("private persona leaked through API serialization")
	}
	if !strings.Contains(string(raw), `"occupation":"编辑"`) {
		t.Fatal("public occupation missing")
	}
}

func TestCatalogFilterValidation(t *testing.T) {
	f, err := ParseFilters(url.Values{})
	if err != nil || f.Page != 1 || f.PageSize != 24 || f.AgeMin != 18 || f.AgeMax != 50 {
		t.Fatal(f, err)
	}
	for _, query := range []string{"page=0", "pageSize=61", "ageMin=17", "ageMin=40&ageMax=30", "page=1&page=2", "occupationCode=x%27%20OR%201%3D1", "page=999999999999999"} {
		q, _ := url.ParseQuery(query)
		if _, err := ParseFilters(q); err == nil {
			t.Fatalf("accepted %s", query)
		}
	}
}
