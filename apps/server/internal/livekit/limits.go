package livekit

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"companion/server/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

var defaultRoomLimits = map[string]int{
	"join_account": 30, "join_guest": 120, "voice_write": 30, "voice_read": 60,
	"socket_account": 60, "socket_guest": 120, "connections_account": 10,
	"connections_guest": 100, "mutation_account": 20, "ip_total": 1200,
}

func (h Handler) limit(name string) int {
	if n := h.Client.config.Limits[name]; n > 0 {
		return n
	}
	return defaultRoomLimits[name]
}
func (h Handler) limitKey(scope, subject string) string {
	sum := sha256.Sum256([]byte(subject))
	return fmt.Sprintf("%s:limit:%s:%x", h.ownerRoomKey(""), scope, sum[:16])
}

var roomRateScript = redis.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return {n,redis.call('PTTL',KEYS[1])}`)

type localRate struct {
	Count int64
	Until int64
}

var localRoomRates = struct {
	sync.Mutex
	items map[string]localRate
}{items: map[string]localRate{}}

func (h Handler) allowRate(c *gin.Context, scope, subject string, limit int) bool {
	key := h.limitKey(scope, subject)
	var count, ttl int64
	if h.RoomCache != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		result, err := roomRateScript.Run(ctx, h.RoomCache, []string{key}).Int64Slice()
		if err != nil {
			failRoom(c, 503, "rate_limit_unavailable", "服务暂时不可用，请稍后重试")
			return false
		}
		count, ttl = result[0], result[1]
	} else {
		localRoomRates.Lock()
		now := h.clock().UnixMilli()
		for k, v := range localRoomRates.items {
			if v.Until <= now {
				delete(localRoomRates.items, k)
			}
		}
		value := localRoomRates.items[key]
		if value.Until <= now {
			value = localRate{Until: now + 60000}
		}
		value.Count++
		localRoomRates.items[key] = value
		count, ttl = value.Count, value.Until-now
		localRoomRates.Unlock()
	}
	if count <= int64(limit) {
		return true
	}
	slog.Info("live room rate limit reached", "scope", scope)
	c.Header("Retry-After", strconv.FormatInt(max(1, (ttl+999)/1000), 10))
	failRoom(c, http.StatusTooManyRequests, "rate_limit", "操作太频繁，请稍后再试")
	return false
}
func (h Handler) allowAccountRate(c *gin.Context, scope, user string) bool {
	subject, name := user, scope+"_account"
	if user == "" {
		subject = "ip:" + c.ClientIP()
		name = scope + "_guest"
	}
	return h.allowRate(c, scope, subject, h.limit(name))
}
func (h Handler) httpRate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.allowRate(c, "ip", c.ClientIP(), h.limit("ip_total")) {
			c.Abort()
			return
		}
		user, err := h.sessionUser(c)
		if err != nil {
			failRoom(c, 401, "unauthorized", "登录已失效，请重新登录")
			c.Abort()
			return
		}
		scope := ""
		if c.Param("roomId") != "" && (c.FullPath() == "/rooms/:roomId/join" || c.FullPath() == "/api/v1/rooms/:roomId/join" || c.FullPath() == "/rooms/:roomId/presence" || c.FullPath() == "/api/v1/rooms/:roomId/presence") {
			scope = "join"
		}
		if (c.Request.Method == "POST" && (c.FullPath() == "/rooms" || c.FullPath() == "/api/v1/rooms")) || (c.Request.Method == "DELETE" && (c.FullPath() == "/rooms/:roomId" || c.FullPath() == "/api/v1/rooms/:roomId")) {
			scope = "mutation"
		}
		if scope != "" && (scope != "mutation" || user != "") && !h.allowAccountRate(c, scope, user) {
			c.Abort()
			return
		}
		c.Next()
	}
}

var leaseScript = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1])
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) then return 0 end
redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); redis.call('PEXPIRE',KEYS[1],90000); return 1`)
var renewLeaseScript = redis.NewScript(`
if not redis.call('ZSCORE',KEYS[1],ARGV[1]) then return 0 end
redis.call('ZADD',KEYS[1],'XX',ARGV[2],ARGV[1]); redis.call('PEXPIRE',KEYS[1],90000); return 1`)
var localRoomLeases = struct {
	sync.Mutex
	items map[string]map[string]int64
}{items: map[string]map[string]int64{}}

type roomLease struct {
	h       Handler
	key, id string
}

func (h Handler) acquireRoomLease(c *gin.Context, user string) (*roomLease, bool) {
	subject, limit := user, h.limit("connections_account")
	if user == "" {
		subject = "ip:" + c.ClientIP()
		limit = h.limit("connections_guest")
	}
	l := &roomLease{h: h, key: h.limitKey("connections", subject), id: database.ID()}
	now := h.clock().UnixMilli()
	allowed := false
	if h.RoomCache != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		n, err := leaseScript.Run(ctx, h.RoomCache, []string{l.key}, now, limit, now+90000, l.id).Int()
		if err != nil {
			failRoom(c, 503, "connections_unavailable", "连接暂时不可用")
			return nil, false
		}
		allowed = n == 1
	} else {
		localRoomLeases.Lock()
		slots := localRoomLeases.items[l.key]
		if slots == nil {
			slots = map[string]int64{}
			localRoomLeases.items[l.key] = slots
		}
		for id, until := range slots {
			if until <= now {
				delete(slots, id)
			}
		}
		if len(slots) < limit {
			slots[l.id] = now + 90000
			allowed = true
		}
		localRoomLeases.Unlock()
	}
	if !allowed {
		c.Header("Retry-After", "20")
		failRoom(c, 429, "connection_limit", "打开的直播页面过多，请关闭部分页面后重试")
		return nil, false
	}
	return l, true
}
func (l *roomLease) renew(ctx context.Context) bool {
	if l.h.RoomCache != nil {
		n, err := renewLeaseScript.Run(ctx, l.h.RoomCache, []string{l.key}, l.id, l.h.clock().Add(90*time.Second).UnixMilli()).Int()
		return err == nil && n == 1
	}
	localRoomLeases.Lock()
	defer localRoomLeases.Unlock()
	slots := localRoomLeases.items[l.key]
	if _, ok := slots[l.id]; !ok {
		return false
	}
	slots[l.id] = l.h.clock().Add(90 * time.Second).UnixMilli()
	return true
}
func (l *roomLease) release() {
	if l.h.RoomCache != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = l.h.RoomCache.ZRem(ctx, l.key, l.id).Err()
		return
	}
	localRoomLeases.Lock()
	defer localRoomLeases.Unlock()
	delete(localRoomLeases.items[l.key], l.id)
	if len(localRoomLeases.items[l.key]) == 0 {
		delete(localRoomLeases.items, l.key)
	}
}
