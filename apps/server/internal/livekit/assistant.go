package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"companion/server/internal/auth"
	"companion/server/pkg/database"
	"github.com/gin-gonic/gin"
)

// AssistantState is public room state. Only Go can create a session; LiveKit
// membership confirms it. Neither a browser flag nor a model response is proof.
type AssistantState struct {
	Status     string `json:"status"`
	SessionID  string `json:"sessionId,omitempty"`
	DispatchID string `json:"dispatchId,omitempty"`
	Identity   string `json:"identity,omitempty"`
	Deadline   int64  `json:"deadline,omitempty"`
	Error      string `json:"error,omitempty"`
}

func (r *roomLifecycle) assistantState() AssistantState {
	if r.Assistant.Status == "" {
		return AssistantState{Status: "idle"}
	}
	return r.Assistant
}
func (h Handler) assistantName() string {
	if h.Client.config.AgentName != "" {
		return h.Client.config.AgentName
	}
	return "room-assistant"
}

func assistantParticipant(p voiceParticipant) bool {
	return (string(p.Kind) == "4" || string(p.Kind) == `"AGENT"`) && strings.HasPrefix(p.Identity, "assistant_")
}

// All mutations use the same per-room lock as room observations and closure.
func (h Handler) assistantOwner(c *gin.Context) (*roomLifecycle, func(), bool) {
	if !h.ownsRoom(c, auth.UserID(c)) {
		return nil, nil, false
	}
	ctx, id := c.Request.Context(), c.Param("roomId")
	unlock, err := h.lockVoice(ctx, id)
	if upstreamFailed(c, err) {
		return nil, nil, false
	}
	if !h.ownsRoom(c, auth.UserID(c)) {
		unlock()
		return nil, nil, false
	}
	r, err := h.loadLifecycle(ctx, id)
	if err == nil && r == nil {
		var item *RoomItem
		item, err = h.exactRoom(ctx, id)
		if item != nil {
			r = lifecycleForRoom(*item)
		}
	}
	if upstreamFailed(c, err) {
		unlock()
		return nil, nil, false
	}
	if r == nil {
		missingRoom(c)
		unlock()
		return nil, nil, false
	}
	return r, unlock, true
}

func (h Handler) dispatch(c *gin.Context) {
	b, ok := body(c)
	if !ok {
		return
	}
	// The browser cannot select another worker or forge session metadata.
	if len(b) != 0 {
		fail(c, 400, "Invalid request body")
		return
	}
	r, unlock, ok := h.assistantOwner(c)
	if !ok {
		return
	}
	defer unlock()
	ctx := c.Request.Context()
	a := r.assistantState()
	if a.Status == "stopping" {
		failRoom(c, http.StatusConflict, "assistant_stopping", "助手正在退出，请稍后重试")
		return
	}
	if a.Status == "starting" || a.Status == "online" {
		c.JSON(200, gin.H{"assistant": a, "item": Dispatch{ID: a.DispatchID, Room: r.ID, AgentName: h.assistantName()}})
		return
	}
	// Retire any legacy/untracked dispatch before reserving a new session.
	items, err := h.Client.ListDispatches(ctx, r.ID)
	if upstreamFailed(c, err) {
		return
	}
	for _, item := range items {
		if item.AgentName == h.assistantName() {
			if upstreamFailed(c, h.Client.DeleteDispatch(ctx, r.ID, item.ID)) {
				return
			}
		}
	}
	people, err := h.Client.ListParticipants(ctx, r.ID)
	if upstreamFailed(c, err) {
		return
	}
	for _, p := range people {
		if assistantParticipant(p) && upstreamFailed(c, h.Client.removeParticipant(ctx, r.ID, p.Identity)) {
			return
		}
	}
	session := database.ID()
	r.Assistant = AssistantState{Status: "starting", SessionID: session, Identity: "assistant_" + session, Deadline: h.clock().Add(30 * time.Second).UnixMilli()}
	// Persist before the RPC: a lost response never permits a second dispatch.
	if upstreamFailed(c, h.saveLifecycle(ctx, r)) {
		return
	}
	metadata, _ := json.Marshal(map[string]any{"roomId": r.ID, "roomSid": r.SID, "sessionId": session, "deadline": r.Assistant.Deadline})
	item, err := h.Client.CreateDispatch(ctx, r.ID, h.assistantName(), string(metadata))
	if err != nil {
		// Keep the reservation. The scheduled observation resolves uncertain creates.
		upstreamFailed(c, err)
		return
	}
	r.Assistant.DispatchID = item.ID
	if upstreamFailed(c, h.saveLifecycle(ctx, r)) {
		return
	}
	c.JSON(http.StatusCreated, gin.H{"item": item, "assistant": r.Assistant})
}

func (h Handler) dispatches(c *gin.Context) {
	if !h.ownsRoom(c, auth.UserID(c)) {
		return
	}
	items, err := h.Client.ListDispatches(c.Request.Context(), c.Param("roomId"))
	if !upstreamFailed(c, err) {
		c.JSON(200, gin.H{"items": items})
	}
}

func (h Handler) deleteDispatch(c *gin.Context) {
	id := strings.TrimSpace(c.Param("dispatchId"))
	if id == "" {
		fail(c, 400, "Invalid dispatch id")
		return
	}
	r, unlock, ok := h.assistantOwner(c)
	if !ok {
		return
	}
	defer unlock()
	ctx := c.Request.Context()
	// A session ID also cancels a create whose HTTP response was lost.
	if id != r.Assistant.DispatchID && id != r.Assistant.SessionID {
		failRoom(c, 404, "assistant_not_found", "助手会话不存在")
		return
	}
	if r.Assistant.Status == "idle" || r.Assistant.Status == "failed" {
		c.JSON(200, gin.H{"ok": true, "assistant": r.assistantState()})
		return
	}
	r.Assistant.Status, r.Assistant.Error = "stopping", ""
	if upstreamFailed(c, h.saveLifecycle(ctx, r)) {
		return
	}
	if err := h.stopAssistant(ctx, r); err != nil {
		// The durable room-check queue retries cleanup after API restarts too.
		c.JSON(http.StatusAccepted, gin.H{"ok": true, "assistant": r.Assistant})
		return
	}
	c.JSON(200, gin.H{"ok": true, "assistant": r.Assistant})
}

func (h Handler) stopAssistant(ctx context.Context, r *roomLifecycle) error {
	items, err := h.Client.ListDispatches(ctx, r.ID)
	if err == nil {
		for _, item := range items {
			if item.AgentName == h.assistantName() {
				err = errors.Join(err, h.Client.DeleteDispatch(ctx, r.ID, item.ID))
			}
		}
	}
	if err == nil {
		var people []voiceParticipant
		people, err = h.Client.ListParticipants(ctx, r.ID)
		for _, p := range people {
			if assistantParticipant(p) {
				err = errors.Join(err, h.Client.removeParticipant(ctx, r.ID, p.Identity))
			}
		}
	}
	if err != nil {
		r.Assistant.Status = "stopping"
		r.Assistant.Deadline = h.clock().Add(3 * time.Second).UnixMilli()
		return errors.Join(err, h.saveLifecycle(ctx, r))
	}
	r.Assistant.Status, r.Assistant.Deadline = "idle", 0
	if r.Assistant.Error != "" {
		r.Assistant.Status = "failed"
	}
	return h.saveLifecycle(ctx, r)
}

func (h Handler) reconcileAssistant(ctx context.Context, r *roomLifecycle, people []voiceParticipant) error {
	a := &r.Assistant
	found := false
	for _, p := range people {
		if !assistantParticipant(p) || !p.online() {
			continue
		}
		if (a.Status == "starting" && h.clock().UnixMilli() < a.Deadline || a.Status == "online") && p.Identity == a.Identity {
			found = true
		} else if err := h.Client.removeParticipant(ctx, r.ID, p.Identity); err != nil {
			return err
		}
	}
	if a.Status == "stopping" {
		return h.stopAssistant(ctx, r)
	}
	if found {
		a.Status, a.Deadline = "online", 0
		return h.saveLifecycle(ctx, r)
	}
	if a.Status == "online" || a.Status == "starting" && h.clock().UnixMilli() >= a.Deadline {
		a.Status, a.Error = "stopping", "助手未能保持在线，请重新呼叫"
		if err := h.saveLifecycle(ctx, r); err != nil {
			return err
		}
		return h.stopAssistant(ctx, r)
	}
	return nil
}
