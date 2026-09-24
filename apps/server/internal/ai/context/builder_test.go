package context
import("testing";"companion/server/internal/conversation")
func TestContextKeepsRecentTurnsInOrderWithinBudget(t *testing.T){
 history:=[]conversation.Message{{SenderType:"user",Content:"旧消息太长了",Status:"complete"},{SenderType:"identity",Content:"你好",Status:"complete"},{SenderType:"user",Content:"失败消息",Status:"failed"},{SenderType:"user",Content:"最近",Status:"pending"}}
 messages:=boundedHistory("identity",history,4)
 if len(messages)!=3||messages[0].Role!="system"||messages[1].Role!="assistant"||messages[1].Content!="你好"||messages[2].Content!="最近"{t.Fatalf("unexpected context: %+v",messages)}
}
