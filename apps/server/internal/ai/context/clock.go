package context

import (
	"time"
	_ "time/tzdata" // Keep IANA zones available in the minimal server image.
)

type clockContext struct {
	Date      string `json:"date"`
	Weekday   string `json:"weekday"`
	TimeZone  string `json:"timeZone"`
	DayPeriod string `json:"dayPeriod"`
}

// The clock is basic conversation context, independent of memory consent.
// Coarse periods avoid changing recovery input hashes on every retry/second.
func conversationClock(now time.Time, timezone string) clockContext {
	if timezone == "" || timezone == "Local" {
		timezone = "Asia/Shanghai"
	}
	zone, err := time.LoadLocation(timezone)
	if err != nil {
		timezone = "Asia/Shanghai"
		zone, _ = time.LoadLocation(timezone)
	}
	local := now.In(zone)
	period := "凌晨"
	switch hour := local.Hour(); {
	case hour >= 18:
		period = "晚上"
	case hour >= 13:
		period = "下午"
	case hour >= 11:
		period = "中午"
	case hour >= 6:
		period = "上午"
	}
	weekdays := [...]string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
	return clockContext{Date: local.Format("2006-01-02"), Weekday: weekdays[local.Weekday()], TimeZone: timezone, DayPeriod: period}
}
