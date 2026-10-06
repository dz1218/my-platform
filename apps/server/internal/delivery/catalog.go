package delivery

import (
	"companion/server/internal/identity"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"

	"github.com/jackc/pgx/v5"
)

type CatalogResult struct {
	Created               int  `json:"created"`
	Updated               int  `json:"updated"`
	Unchanged             int  `json:"unchanged"`
	AffectedConversations int  `json:"affectedConversations"`
	DryRun                bool `json:"dryRun"`
}

// ImportCatalog is the only platform write path for shared identity profiles.
// No omitted identity, inherited owner, match or historical message is removed.
// Dry runs use a read-only snapshot and never acquire mutation/advisory locks.
func (r Repository) ImportCatalog(ctx context.Context, catalog identity.Catalog, dryRun bool) (CatalogResult, error) {
	result := CatalogResult{DryRun: dryRun}
	if err := catalog.Validate(); err != nil {
		return result, err
	}
	profiles := catalog.Resolved()
	sort.Slice(profiles, func(a, b int) bool { return profiles[a].ID < profiles[b].ID })
	ids := make([]string, len(profiles))
	for n, i := range profiles {
		ids[n] = i.ID
	}
	options := pgx.TxOptions{}
	if dryRun {
		options = pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	}
	tx, err := r.DB.BeginTx(ctx, options)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if !dryRun {
		// Serializes imports including as-yet absent IDs. Match/inheritance writers
		// use the identity row lock below and never need this advisory lock.
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('identity-catalog-import',47119))`); err != nil {
			return result, err
		}
	}
	query := `SELECT ` + identity.PublicColumns + `,i.persona,i.persona_version
 FROM identities i WHERE i.id=ANY($1::text[]) ORDER BY i.id`
	if !dryRun {
		query += ` FOR NO KEY UPDATE OF i`
	}
	rows, err := tx.Query(ctx, query, ids)
	if err != nil {
		return result, err
	}
	existing := map[string]identity.Identity{}
	owned := map[string]bool{}
	for rows.Next() {
		var i identity.Identity
		if err = rows.Scan(append(identity.PublicDestinations(&i), &i.Persona, &i.PersonaVersion)...); err != nil {
			rows.Close()
			return result, err
		}
		existing[i.ID] = i
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	// Read ownership after acquiring identity locks: inheritance may have committed
	// while the preceding SELECT waited for its row lock under READ COMMITTED.
	rows, err = tx.Query(ctx, `SELECT identity_id FROM identity_inheritances WHERE identity_id=ANY($1::text[])`, ids)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return result, err
		}
		owned[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	changed := []identity.Identity{}
	changedIDs := []string{}
	for _, i := range profiles {
		previous, exists := existing[i.ID]
		if exists && owned[i.ID] && previous.Gender != i.Gender {
			return result, fmt.Errorf("identity %s is inherited; its gender cannot be changed", i.ID)
		}
		// Version belongs to the database, not the input document.
		previous.PersonaVersion = 0
		if exists && reflect.DeepEqual(previous, i) {
			result.Unchanged++
			continue
		}
		if exists {
			result.Updated++
		} else {
			result.Created++
		}
		changed = append(changed, i)
		changedIDs = append(changedIDs, i.ID)
	}
	conversationIDs := []string{}
	if len(changedIDs) > 0 {
		query = `SELECT id FROM conversations WHERE identity_id=ANY($1::text[]) ORDER BY id`
		if !dryRun {
			query += ` FOR UPDATE`
		}
		rows, err = tx.Query(ctx, query, changedIDs)
		if err != nil {
			return result, err
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return result, err
			}
			conversationIDs = append(conversationIDs, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return result, err
		}
	}
	result.AffectedConversations = len(conversationIDs)
	if dryRun {
		return result, tx.Commit(ctx)
	}
	for _, i := range changed {
		persona, err := json.Marshal(i.Persona)
		if err != nil {
			return result, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO identities(id,name,age,avatar_url,gender,city,background,occupation_code,occupation,persona)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,age=EXCLUDED.age,avatar_url=EXCLUDED.avatar_url,gender=EXCLUDED.gender,
 city=EXCLUDED.city,background=EXCLUDED.background,occupation_code=EXCLUDED.occupation_code,occupation=EXCLUDED.occupation,
 persona=EXCLUDED.persona,persona_version=identities.persona_version+1,updated_at=now()`, i.ID, i.Name, i.Age, i.AvatarURL, i.Gender, i.City, i.Background, i.OccupationCode, i.Occupation, persona)
		if err != nil {
			return result, err
		}
	}
	for _, id := range conversationIDs {
		if _, err = tx.Exec(ctx, `UPDATE conversations SET settings_version=settings_version+1,summary='',summary_through_message_id=NULL WHERE id=$1`, id); err != nil {
			return result, err
		}
		if err = cancelJobs(ctx, tx, id); err != nil {
			return result, err
		}
		// Otherwise an old pending enrichment keeps retrying with an obsolete
		// settings version. Retire its exact lease and let the scanner reschedule.
		if _, err = tx.Exec(ctx, `UPDATE context_jobs SET status='DONE',claim_token=NULL,lease_until=NULL WHERE conversation_id=$1 AND status IN ('PENDING','RUNNING')`, id); err != nil {
			return result, err
		}
		if err = refreshPendingOpen(ctx, tx, id); err != nil {
			return result, err
		}
	}
	return result, tx.Commit(ctx)
}
