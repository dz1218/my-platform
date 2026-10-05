// The old per-conversation assignment command is retired. Identity inheritance
// is a one-time choice made by the account holder through the authenticated API.
package main

import (
	"fmt"
	"log/slog"
	"os"
)

func main() {
	if err := run(); err != nil {
		slog.Error("assignment unavailable", "error", err)
		os.Exit(1)
	}
}
func run() error {
	return fmt.Errorf("按会话分配身份已停用，请用户登录后在身份选择页自行继承；已继承身份不能转让或撤销")
}
