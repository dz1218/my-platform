package livekit

type LiveFAQ struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}
type LiveSettings struct {
	Rules          string    `json:"rules"`
	Announcement   string    `json:"announcement"`
	FAQ            []LiveFAQ `json:"faq"`
	BlockedPhrases []string  `json:"blockedPhrases"`
	SlowSeconds    int       `json:"slowSeconds"`
	AutoReply      bool      `json:"autoReply"`
	AutoModeration bool      `json:"autoModeration"`
	Welcome        bool      `json:"welcome"`
}

func defaultLiveSettings() LiveSettings {
	return LiveSettings{FAQ: []LiveFAQ{}, BlockedPhrases: []string{}, AutoReply: true, AutoModeration: true}
}

type LiveRestriction struct {
	ActionID string `json:"actionId"`
	Until    int64  `json:"until"` // zero means the current room incarnation
	Reason   string `json:"reason"`
}
type LiveMember struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Code     string           `json:"code"`
	Role     string           `json:"role"`
	Online   bool             `json:"online"`
	Mute     *LiveRestriction `json:"mute,omitempty"`
	Ban      *LiveRestriction `json:"ban,omitempty"`
	Subjects []string         `json:"subjects,omitempty"` // storage only; scrub before every public response
}
type liveAdmission struct {
	Online         bool   `json:"online"`
	MemberID       string `json:"memberId"`
	JoinedAt       int64  `json:"joinedAt"` // member's first admission in this broadcast; retained on refresh
	ExpiresAt      int64  `json:"expiresAt"`
	UserID         string `json:"userId,omitempty"`
	SessionVersion int64  `json:"sessionVersion,omitempty"`
}
type LiveAction struct {
	ID        string   `json:"id"`
	RequestID string   `json:"requestId"`
	MemberID  string   `json:"memberId"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Actor     string   `json:"actor"`
	Reason    string   `json:"reason"`
	Evidence  []string `json:"evidence"`
	Status    string   `json:"status"` // proposed / pending / applied / failed / revoked / dismissed
	Until     int64    `json:"until"`
	CreatedAt int64    `json:"createdAt"`
	RetryAt   int64    `json:"retryAt,omitempty"`
	Error     string   `json:"error,omitempty"`
}
type liveReceipt struct {
	Hash   string `json:"hash"`
	At     int64  `json:"at"`
	Result []byte `json:"result"`
}
type roomGovernance struct {
	Revision   int64                    `json:"revision"`
	Members    map[string]*LiveMember   `json:"members"`
	Admissions map[string]liveAdmission `json:"admissions"`
	Actions    []*LiveAction            `json:"actions"`
	Settings   LiveSettings             `json:"settings"`
	Receipts   map[string]liveReceipt   `json:"receipts"`
}
type LiveChatMessage struct {
	ID          string `json:"id"`
	Sequence    int64  `json:"sequence"`
	MemberID    string `json:"memberId"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Text        string `json:"text"`
	Time        int64  `json:"time"`
	ReplyTo     string `json:"replyTo,omitempty"`
	Destination string `json:"destination,omitempty"` // member id or host
}
type liveChatBucket struct {
	Sent     []int64            `json:"sent"`
	Texts    map[string][]int64 `json:"texts"`
	WarnedAt int64              `json:"warnedAt"`
	LastAt   int64              `json:"lastAt"`
}
type roomChatBuffer struct {
	pruned           bool
	ArchivedSequence int64                          `json:"archivedSequence"`
	DroppedSequence  int64                          `json:"droppedSequence"`
	DroppedAt        int64                          `json:"droppedAt"`
	Sequence         int64                          `json:"sequence"`
	Messages         []LiveChatMessage              `json:"messages"`
	Buckets          map[string]*liveChatBucket     `json:"buckets"`
	Receipts         map[string]LiveChatMessage     `json:"receipts"`
	AutoReplyAt      int64                          `json:"autoReplyAt"`
	AutoUserAt       map[string]int64               `json:"autoUserAt"`
	WelcomeAt        int64                          `json:"welcomeAt"`
	Rejected         map[string]liveRejectedMessage `json:"rejected"`
}
type liveRejectedMessage struct {
	Hash    string `json:"hash"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"status"`
	At      int64  `json:"at"`
}
type LiveActivity struct {
	Revision int64             `json:"revision"`
	Type     string            `json:"type"`
	RoomID   string            `json:"roomId"`
	RoomSID  string            `json:"roomSid"`
	Sequence int64             `json:"sequence"`
	Members  []LiveMember      `json:"members"`
	Self     *LiveMember       `json:"self,omitempty"`
	Settings LiveSettings      `json:"settings"`
	Actions  []*LiveAction     `json:"actions,omitempty"`
	Messages []LiveChatMessage `json:"messages"`
	Removed  bool              `json:"removed"`
	Gap      bool              `json:"gap"`
}
