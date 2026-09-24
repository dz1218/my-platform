package conversation

import (
	"companion/server/pkg/response"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
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
	ID         string    `json:"id"`
	Sender     Sender    `json:"sender"`
	SenderType string    `json:"senderType"`
	Content    string    `json:"content"`
	Status     string    `json:"status"`
	RequestID  *string   `json:"requestId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}
type Page struct {
	Items      []Message `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}
type Repository struct{ DB *pgxpool.Pool }

func (r Repository) Owned(ctx context.Context, userID, id string) (Conversation, error) {
	var c Conversation
	err := r.DB.QueryRow(ctx, `SELECT id,user_id,identity_id FROM conversations WHERE id=$1 AND user_id=$2`, id, userID).Scan(&c.ID, &c.UserID, &c.IdentityID)
	return c, err
}

func (r Repository) History(ctx context.Context, c Conversation, before int64, limit int) (Page, error) {
	rows, err := r.DB.Query(ctx, `SELECT m.id::text,m.sender_type,m.content,m.status,m.request_id,m.created_at,
 CASE WHEN m.sender_type='user' THEN u.id ELSE i.id END,
 CASE WHEN m.sender_type='user' THEN COALESCE(u.name,'') ELSE i.name END
 FROM messages m JOIN users u ON u.id=$2 JOIN identities i ON i.id=m.identity_id
 WHERE m.conversation_id=$1 AND ($3::bigint=0 OR m.id<$3) ORDER BY m.id DESC LIMIT $4`, c.ID, c.UserID, before, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	p := Page{Items: []Message{}}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SenderType, &m.Content, &m.Status, &m.RequestID, &m.CreatedAt, &m.Sender.ID, &m.Sender.Name); err != nil {
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
	return p, nil
}

// A session advisory lock serializes a conversation across API instances without
// keeping a SQL transaction open during an upstream model request.
func (r Repository) Lock(ctx context.Context, id string) (func(), error) {
	conn, err := r.DB.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	var ok bool
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, id).Scan(&ok); err != nil {
		conn.Release()
		return nil, err
	}
	if !ok {
		conn.Release()
		return nil, &response.Error{Status: 409, Code: "busy", Message: "上一条消息还在发送，请稍后再试"}
	}
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, id); err != nil {
			_ = conn.Conn().Close(ctx)
		}
		conn.Release()
	}, nil
}
func (r Repository) BeginMessage(ctx context.Context, c Conversation, requestID, content string) (string, error) {
	var id, status, existing string
	err := r.DB.QueryRow(ctx, `SELECT id::text,status,content FROM messages WHERE conversation_id=$1 AND request_id=$2 AND sender_type='user'`, c.ID, requestID).Scan(&id, &status, &existing)
	if err == nil {
		if existing != content {
			return "", &response.Error{Status: 409, Code: "request_conflict", Message: "重复请求的消息内容不同"}
		}
		if status == "complete" {
			return "", &response.Error{Status: 409, Code: "already_sent", Message: "消息已经发送，请刷新查看回复"}
		}
		// Retrying an interrupted turn is safe only until the next user turn exists.
		var newer bool
		if err = r.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_type='user' AND id>$2::bigint)`, c.ID, id).Scan(&newer); err != nil {
			return "", err
		}
		if newer {
			return "", &response.Error{Status: 409, Code: "stale_retry", Message: "已有后续消息，请发送新消息"}
		}
		_, err = r.DB.Exec(ctx, `UPDATE messages SET status='pending' WHERE id=$1::bigint`, id)
		return id, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	// A previous process might have stopped before marking its turn failed.
	_, err = r.DB.Exec(ctx, `UPDATE messages SET status='failed' WHERE conversation_id=$1 AND sender_type='user' AND status='pending'`, c.ID)
	if err != nil {
		return "", err
	}
	err = r.DB.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,content,request_id,status) VALUES($1,$2,'user',$3,$4,'pending') RETURNING id::text`, c.ID, c.IdentityID, content, requestID).Scan(&id)
	return id, err
}
func (r Repository) Fail(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `UPDATE messages SET status='failed' WHERE id=$1::bigint AND status='pending'`, id)
	return err
}
func (r Repository) Complete(ctx context.Context, c Conversation, userMessageID, content string) (Message, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback(ctx)
	m := Message{SenderType: "identity", Content: content, Status: "complete", Sender: Sender{ID: c.IdentityID}}
	err = tx.QueryRow(ctx, `INSERT INTO messages(conversation_id,identity_id,sender_type,driver_type,content) VALUES($1,$2,'identity','ai',$3) RETURNING id::text,created_at`, c.ID, c.IdentityID, content).Scan(&m.ID, &m.CreatedAt)
	if err != nil {
		return m, err
	}
	if _, err = tx.Exec(ctx, `UPDATE messages SET status='complete' WHERE id=$1::bigint`, userMessageID); err != nil {
		return m, err
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, c.ID); err != nil {
		return m, err
	}
	if _, err = tx.Exec(ctx, `UPDATE matches SET status='talking',updated_at=now() WHERE id=(SELECT match_id FROM conversations WHERE id=$1) AND status='matched'`, c.ID); err != nil {
		return m, err
	}
	if err = tx.QueryRow(ctx, `SELECT name FROM identities WHERE id=$1`, c.IdentityID).Scan(&m.Sender.Name); err != nil {
		return m, err
	}
	return m, tx.Commit(ctx)
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
