// Package livekit implements the room and dispatch subset of LiveKit's Twirp API.
// Wire contract: https://github.com/livekit/protocol/tree/main/protobufs
package livekit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Config struct {
	URL, InternalURL, APIKey, APISecret, AgentName string
}

func (c Config) Enabled() bool { return c.URL != "" && c.APIKey != "" && c.APISecret != "" }

func (c Config) Validate() error {
	if c.URL == "" && c.InternalURL == "" && c.APIKey == "" && c.APISecret == "" {
		return nil
	}
	if !c.Enabled() {
		return fmt.Errorf("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set together")
	}
	for _, raw := range []string{c.URL, c.InternalURL} {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("invalid LiveKit URL")
		}
		switch u.Scheme {
		case "ws", "wss", "http", "https":
		default:
			return fmt.Errorf("invalid LiveKit URL scheme")
		}
	}
	return nil
}

type Client struct {
	config Config
	http   *http.Client
}

func NewClient(cfg Config) *Client {
	return &Client{config: cfg, http: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *Client) token(identity, name string, grant map[string]any, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{"iss": c.config.APIKey, "nbf": now.Unix(), "iat": now.Unix(), "exp": now.Add(ttl).Unix(), "video": grant}
	if identity != "" {
		claims["sub"] = identity
		claims["name"] = name
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(c.config.APISecret))
}

// All room participants can chat; audio/video publishing remains host-only.
func (c *Client) JoinToken(room, identity, name string, canPublish bool) (string, error) {
	return c.token(identity, name, map[string]any{"roomJoin": true, "room": room, "canPublish": canPublish, "canSubscribe": true, "canPublishData": true}, 2*time.Hour)
}

func (c *Client) call(ctx context.Context, service, method string, grant map[string]any, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	token, err := c.token("", "", grant, 5*time.Minute)
	if err != nil {
		return err
	}
	host := c.config.InternalURL
	if host == "" {
		host = c.config.URL
	}
	host = strings.Replace(strings.Replace(host, "wss://", "https://", 1), "ws://", "http://", 1)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(host, "/")+"/twirp/livekit."+service+"/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("LiveKit %s: %w", method, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("LiveKit %s returned HTTP %d", method, res.StatusCode)
	}
	if output == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(output); err != nil {
		return fmt.Errorf("LiveKit %s response: %w", method, err)
	}
	return nil
}

// Twirp deployments can emit either protobuf field names or lowerCamelCase.
type room struct {
	Name                 string `json:"name"`
	Metadata             string `json:"metadata"`
	NumParticipants      int    `json:"numParticipants"`
	NumParticipantsProto int    `json:"num_participants"`
	NumPublishers        int    `json:"numPublishers"`
	NumPublishersProto   int    `json:"num_publishers"`
}
type RoomItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Viewers int    `json:"viewers"`
}

func (r room) item() RoomItem {
	title := r.Name
	var metadata struct {
		Title string `json:"title"`
	}
	if json.Unmarshal([]byte(r.Metadata), &metadata) == nil && metadata.Title != "" {
		title = metadata.Title
	}
	viewers := r.NumParticipants
	if viewers == 0 {
		viewers = r.NumParticipantsProto
	}
	status := "准备中"
	if r.NumPublishers > 0 || r.NumPublishersProto > 0 {
		status = "直播中"
	}
	return RoomItem{r.Name, title, status, viewers}
}
func (c *Client) ListRooms(ctx context.Context) ([]RoomItem, error) {
	var result struct {
		Rooms []room `json:"rooms"`
	}
	err := c.call(ctx, "RoomService", "ListRooms", map[string]any{"roomList": true}, struct{}{}, &result)
	items := make([]RoomItem, 0, len(result.Rooms))
	for _, r := range result.Rooms {
		items = append(items, r.item())
	}
	return items, err
}
func (c *Client) CreateRoom(ctx context.Context, id, title string) (RoomItem, error) {
	metadata, _ := json.Marshal(map[string]string{"title": title})
	var result room
	err := c.call(ctx, "RoomService", "CreateRoom", map[string]any{"roomCreate": true}, map[string]any{"name": id, "metadata": string(metadata), "maxParticipants": 50, "emptyTimeout": 600}, &result)
	return result.item(), err
}
func (c *Client) DeleteRoom(ctx context.Context, id string) error {
	return c.call(ctx, "RoomService", "DeleteRoom", map[string]any{"roomCreate": true}, map[string]string{"room": id}, nil)
}

type Dispatch struct {
	ID        string `json:"id"`
	Room      string `json:"room"`
	AgentName string `json:"agentName"`
	Metadata  string `json:"metadata"`
}

func (d *Dispatch) UnmarshalJSON(data []byte) error {
	type plain Dispatch
	var wire struct {
		plain
		AgentNameProto string `json:"agent_name"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	*d = Dispatch(wire.plain)
	if d.AgentName == "" {
		d.AgentName = wire.AgentNameProto
	}
	return nil
}
func adminGrant(room string) map[string]any { return map[string]any{"roomAdmin": true, "room": room} }
func (c *Client) CreateDispatch(ctx context.Context, room, agent, metadata string) (Dispatch, error) {
	var result Dispatch
	err := c.call(ctx, "AgentDispatchService", "CreateDispatch", adminGrant(room), map[string]string{"room": room, "agentName": agent, "metadata": metadata}, &result)
	return result, err
}
func (c *Client) ListDispatches(ctx context.Context, room string) ([]Dispatch, error) {
	var result struct {
		Items      []Dispatch `json:"agentDispatches"`
		ProtoItems []Dispatch `json:"agent_dispatches"`
	}
	err := c.call(ctx, "AgentDispatchService", "ListDispatch", adminGrant(room), map[string]string{"room": room}, &result)
	if result.Items == nil {
		result.Items = result.ProtoItems
	}
	if result.Items == nil {
		result.Items = []Dispatch{}
	}
	return result.Items, err
}
func (c *Client) DeleteDispatch(ctx context.Context, room, id string) error {
	return c.call(ctx, "AgentDispatchService", "DeleteDispatch", adminGrant(room), map[string]string{"room": room, "dispatchId": id}, nil)
}
