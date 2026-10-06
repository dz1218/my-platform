package identity

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

type OccupationTemplate struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	MinAge int    `json:"minAge"`
}
type CatalogIdentity struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Age            int     `json:"age"`
	Gender         string  `json:"gender"`
	City           string  `json:"city"`
	Background     string  `json:"background"`
	AvatarURL      string  `json:"avatarUrl"`
	OccupationCode string  `json:"occupationCode"`
	Persona        Persona `json:"persona"`
}
type Catalog struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Complete      bool                 `json:"complete"`
	Occupations   []OccupationTemplate `json:"occupations"`
	Identities    []CatalogIdentity    `json:"identities"`
}

var catalogCode = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var catalogID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$`)

// ReadCatalog rejects unknown fields and trailing documents before any DB access.
func ReadCatalog(reader io.Reader) (Catalog, error) {
	var c Catalog
	data, err := io.ReadAll(io.LimitReader(reader, 16*1024*1024+1))
	if err != nil {
		return c, err
	}
	if len(data) > 16*1024*1024 {
		return c, fmt.Errorf("catalog exceeds 16 MiB")
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err = d.Decode(&c); err != nil {
		return c, fmt.Errorf("invalid catalog JSON: %w", err)
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return c, fmt.Errorf("catalog must contain one JSON document")
	}
	return c, c.Validate()
}

func textLength(value string, min, max int) bool {
	n := utf8.RuneCountInString(value)
	return value == strings.TrimSpace(value) && n >= min && n <= max
}

func (c Catalog) Validate() error {
	if c.SchemaVersion != 1 {
		return fmt.Errorf("schemaVersion must be 1")
	}
	if len(c.Occupations) == 0 || len(c.Occupations) > 100 || len(c.Identities) == 0 || len(c.Identities) > 1000 {
		return fmt.Errorf("catalog requires 1..100 occupations and 1..1000 identities")
	}
	if c.Complete && (len(c.Occupations) != 100 || len(c.Identities) != 1000) {
		return fmt.Errorf("complete catalog requires 100 occupations and 1000 identities")
	}
	occupations := make(map[string]OccupationTemplate, len(c.Occupations))
	names := make(map[string]bool, len(c.Occupations))
	for n, o := range c.Occupations {
		if !catalogCode.MatchString(o.Code) || !textLength(o.Name, 1, 40) || o.MinAge < 18 || o.MinAge > 50 {
			return fmt.Errorf("occupations[%d]: invalid code, name or minAge (18..50)", n)
		}
		if _, exists := occupations[o.Code]; exists || names[o.Name] {
			return fmt.Errorf("occupations[%d]: duplicate occupation", n)
		}
		occupations[o.Code] = o
		names[o.Name] = true
	}
	ids := make(map[string]bool, len(c.Identities))
	ages := make(map[string]map[int]bool, len(c.Occupations))
	for n, i := range c.Identities {
		fail := func(reason string) error { return fmt.Errorf("identities[%d] (%s): %s", n, i.ID, reason) }
		if !catalogID.MatchString(i.ID) || ids[i.ID] {
			return fail("invalid or duplicate id")
		}
		ids[i.ID] = true
		o, ok := occupations[i.OccupationCode]
		if !ok {
			return fail("unknown occupationCode")
		}
		if i.Age < 18 || i.Age > 50 || i.Age < o.MinAge {
			return fail("age must be 18..50 and meet occupation minAge")
		}
		if ages[o.Code] == nil {
			ages[o.Code] = map[int]bool{}
		}
		if ages[o.Code][i.Age] {
			return fail("ages must differ within an occupation")
		}
		ages[o.Code][i.Age] = true
		if !ValidGender(i.Gender) || !textLength(i.Name, 1, 40) || !textLength(i.City, 1, 80) || !textLength(i.Background, 1, 500) {
			return fail("invalid gender, name, city or background")
		}
		if i.AvatarURL != "" {
			u, err := url.Parse(i.AvatarURL)
			local := strings.HasPrefix(i.AvatarURL, "/") && !strings.HasPrefix(i.AvatarURL, "//") && !strings.Contains(i.AvatarURL, `\`)
			if err != nil || len(i.AvatarURL) > 2048 || (!local && !(u.Scheme == "https" && u.Host != "" && u.User == nil)) {
				return fail("avatarUrl must be an app-relative path or HTTPS URL")
			}
		}
		p := i.Persona
		if !textLength(p.Personality, 1, 500) || !textLength(p.SpeakingStyle, 1, 500) || !textLength(p.CareerStage, 1, 200) || !textLength(p.Backstory, 1, 1500) || !textLength(p.Goals, 1, 500) || len(p.Interests) < 1 || len(p.Interests) > 12 {
			return fail("persona fields are missing or exceed their limits")
		}
		interests := map[string]bool{}
		for _, interest := range p.Interests {
			if !textLength(interest, 1, 80) || interests[interest] {
				return fail("interests must contain 1..12 distinct short values")
			}
			interests[interest] = true
		}
	}
	if c.Complete {
		for _, o := range c.Occupations {
			if len(ages[o.Code]) != 10 {
				return fmt.Errorf("occupation %s requires 10 identities of distinct ages", o.Code)
			}
		}
	}
	return nil
}

func (c Catalog) Resolved() []Identity {
	names := map[string]string{}
	for _, o := range c.Occupations {
		names[o.Code] = o.Name
	}
	out := make([]Identity, 0, len(c.Identities))
	for _, i := range c.Identities {
		out = append(out, Identity{ID: i.ID, Name: i.Name, Age: i.Age, Gender: i.Gender, City: i.City, Background: i.Background, AvatarURL: i.AvatarURL, OccupationCode: i.OccupationCode, Occupation: names[i.OccupationCode], Persona: i.Persona})
	}
	return out
}
