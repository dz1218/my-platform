package livekit

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"

	"github.com/gin-gonic/gin"
)

// Fixture fallback only. Production transcripts live in PostgreSQL and expire
// with their room governance record, rather than with the delivery buffer.
var localLiveHistory sync.Map

func (h Handler) archiveLiveChat(ctx context.Context, r *roomLifecycle, b *roomChatBuffer) error {
	if b.Sequence <= b.ArchivedSequence {
		return nil
	}
	messages := []LiveChatMessage{}
	for _, m := range b.Messages {
		if m.Sequence > b.ArchivedSequence && m.Destination == "" {
			messages = append(messages, m)
		}
	}
	if len(messages) > 0 {
		if db := h.Auth.Service.Repo.DB; db != nil {
			data, err := json.Marshal(messages)
			if err != nil {
				return err
			}
			_, err = db.Exec(ctx, `INSERT INTO live_room_chat_history(room_sid,sequence,member_id,name,text,message)
				SELECT $1,(m->>'sequence')::bigint,m->>'memberId',m->>'name',m->>'text',m
				FROM jsonb_array_elements($2::jsonb) m
				ON CONFLICT(room_sid,sequence) DO NOTHING`, r.SID, data)
			if err != nil {
				return err
			}
		} else {
			key := h.governanceKey(r)
			previous, _ := localLiveHistory.Load(key)
			history := map[int64]LiveChatMessage{}
			if previous != nil {
				for sequence, m := range previous.(map[int64]LiveChatMessage) {
					history[sequence] = m
				}
			}
			for _, m := range messages {
				history[m.Sequence] = m
			}
			localLiveHistory.Store(key, history)
		}
	}
	b.ArchivedSequence = b.Sequence
	return nil
}

type roomHistoryQuery struct {
	Before  int64
	Through int64
	Member  string
	Query   string
	Limit   int
}

type roomHistoryPage struct {
	Messages   []LiveChatMessage `json:"messages"`
	NextBefore *int64            `json:"nextBefore"`
}

func (h Handler) readRoomHistory(ctx context.Context, r *roomLifecycle, query roomHistoryQuery) (roomHistoryPage, error) {
	page := roomHistoryPage{Messages: []LiveChatMessage{}}
	limit := min(max(query.Limit, 1), 50)
	messages := []LiveChatMessage{}
	if db := h.Auth.Service.Repo.DB; db != nil {
		rows, err := db.Query(ctx, `SELECT message FROM live_room_chat_history
			WHERE room_sid=$1 AND ($2::bigint=0 OR sequence<$2) AND ($3::bigint=0 OR sequence<=$3)
			AND ($4='' OR member_id=$4 OR strpos(lower(name),lower($4))>0)
			AND ($5='' OR strpos(lower(text),lower($5))>0)
			ORDER BY sequence DESC LIMIT $6`, r.SID, query.Before, query.Through, query.Member, query.Query, limit+1)
		if err != nil {
			return page, err
		}
		defer rows.Close()
		for rows.Next() {
			var data []byte
			var m LiveChatMessage
			if err = rows.Scan(&data); err != nil {
				return page, err
			}
			if err = json.Unmarshal(data, &m); err != nil {
				return page, err
			}
			messages = append(messages, m)
		}
		if err = rows.Err(); err != nil {
			return page, err
		}
	} else if stored, ok := localLiveHistory.Load(h.governanceKey(r)); ok {
		for _, m := range stored.(map[int64]LiveChatMessage) {
			if (query.Before == 0 || m.Sequence < query.Before) && (query.Through == 0 || m.Sequence <= query.Through) &&
				(query.Member == "" || m.MemberID == query.Member || strings.Contains(strings.ToLower(m.Name), strings.ToLower(query.Member))) &&
				strings.Contains(strings.ToLower(m.Text), strings.ToLower(query.Query)) {
				messages = append(messages, m)
			}
		}
		slices.SortFunc(messages, func(a, b LiveChatMessage) int {
			if a.Sequence > b.Sequence {
				return -1
			}
			return 1
		})
	}
	characters := 0
	for _, m := range messages {
		data, _ := json.Marshal(m)
		size := len(utf16.Encode([]rune(string(data))))
		if len(page.Messages) >= limit || (len(page.Messages) > 0 && characters+size > 16000) {
			cursor := page.Messages[len(page.Messages)-1].Sequence
			page.NextBefore = &cursor
			break
		}
		page.Messages = append(page.Messages, m)
		characters += size
	}
	slices.Reverse(page.Messages)
	return page, nil
}

func (h Handler) roomAgentHistory(c *gin.Context) {
	r, err := h.activeRoomAgent(c.Request.Context(), c)
	if err != nil {
		c.AbortWithStatus(409)
		return
	}
	query := roomHistoryQuery{Member: strings.TrimSpace(c.Query("member")), Query: strings.TrimSpace(c.Query("query")), Limit: 30}
	for key, target := range map[string]*int64{"before": &query.Before, "through": &query.Through} {
		if raw := c.Query(key); raw != "" {
			*target, err = strconv.ParseInt(raw, 10, 64)
			if err != nil || *target < 0 {
				c.AbortWithStatus(400)
				return
			}
		}
	}
	if raw := c.Query("limit"); raw != "" {
		query.Limit, err = strconv.Atoi(raw)
		if err != nil || query.Limit < 1 || query.Limit > 50 {
			c.AbortWithStatus(400)
			return
		}
	}
	if len(utf16.Encode([]rune(query.Query))) > 200 || len(utf16.Encode([]rune(query.Member))) > 100 {
		c.AbortWithStatus(400)
		return
	}
	page, err := h.readRoomHistory(c.Request.Context(), r, query)
	if !upstreamFailed(c, err) {
		c.Header("Cache-Control", "no-store")
		c.JSON(200, page)
	}
}
