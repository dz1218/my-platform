package conversation

import (
	"companion/server/pkg/response"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"strconv"
	"time"
)

type Conversation struct{ ID, UserID, IdentityID string }
type Sender struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Message struct {
	ID          string    `json:"id"`
	ServerSeq   string    `json:"serverSeq"`
	MessageKind string    `json:"messageKind"`
	Sender      Sender    `json:"sender"`
	SenderType  string    `json:"senderType"`
	Source      string    `json:"source"`
	Content     string    `json:"content"`
	Status      string    `json:"status"`
	RequestID   *string   `json:"requestId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}
type Page struct {
	Items       []Message `json:"items"`
	NextCursor  string    `json:"nextCursor,omitempty"`
	ReplyStatus string    `json:"replyStatus,omitempty"`
}
type Repository struct{ DB *pgxpool.Pool }

func (r Repository) Accessible(ctx context.Context, userID, id string) (Conversation, error) {
	var c Conversation
	err := r.DB.QueryRow(ctx, `SELECT id,user_id,identity_id FROM conversations WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM conversation_takeovers t WHERE t.conversation_id=conversations.id AND t.operator_id=$2))`, id, userID).Scan(&c.ID, &c.UserID, &c.IdentityID)
	return c, err
}

const messageQuery = `SELECT m.id::text,m.sender_type,CASE WHEN m.sender_type='user' THEN 'USER' WHEN m.driver_type='human' THEN 'HUMAN' ELSE 'AI' END,m.content,CASE WHEN m.sender_type='user' THEN 'complete' ELSE m.status END,m.request_id,m.created_at,
 CASE WHEN m.sender_type='user' THEN u.id ELSE i.id END,
 CASE WHEN m.sender_type='user' THEN COALESCE(u.name,'') ELSE i.name END,m.id::text,m.message_kind
 FROM messages m JOIN message_outbox o ON o.message_id=m.id JOIN users u ON u.id=$2 JOIN identities i ON i.id=m.identity_id
`

func (r Repository) History(ctx context.Context, c Conversation, before int64, limit int) (Page, error) {
	rows, err := r.DB.Query(ctx, messageQuery+` WHERE m.conversation_id=$1 AND ($3::bigint=0 OR m.id<$3) ORDER BY m.id DESC LIMIT $4`, c.ID, c.UserID, before, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	p := Page{Items: []Message{}}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SenderType, &m.Source, &m.Content, &m.Status, &m.RequestID, &m.CreatedAt, &m.Sender.ID, &m.Sender.Name, &m.ServerSeq, &m.MessageKind); err != nil {
			return Page{}, err
		}
		p.Items = append(p.Items, m)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	if len(p.Items) > limit {
		p.Items = p.Items[:limit]
		p.NextCursor = p.Items[len(p.Items)-1].ID
	}
	for i, j := 0, len(p.Items)-1; i < j; i, j = i+1, j-1 {
		p.Items[i], p.Items[j] = p.Items[j], p.Items[i]
	}
	rows.Close()
	// Reply generation is independent of whether a user message was accepted.
	if before == 0 {
		if err := r.DB.QueryRow(ctx, `SELECT COALESCE((SELECT status FROM reply_jobs WHERE conversation_id=$1),'idle')`, c.ID).Scan(&p.ReplyStatus); err != nil {
			return Page{}, err
		}
	}
	return p, nil
}

func Cursor(raw string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return 0, response.BadRequest("无效的历史游标")
	}
	return v, nil
}

// After reads committed events in order, independently of the 50-message UI
// window, so a burst cannot silently drop message.created notifications.
func (r Repository) After(ctx context.Context, c Conversation, after int64, limit int) ([]Message, error) {
	rows, err := r.DB.Query(ctx, messageQuery+` WHERE m.conversation_id=$1 AND m.id>$3 ORDER BY m.id ASC LIMIT $4`, c.ID, c.UserID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.ID, &m.SenderType, &m.Source, &m.Content, &m.Status, &m.RequestID, &m.CreatedAt, &m.Sender.ID, &m.Sender.Name, &m.ServerSeq, &m.MessageKind); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}
