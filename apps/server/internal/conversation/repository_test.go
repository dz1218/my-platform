package conversation
import("encoding/json";"strings";"testing")
func TestPublicMessageDoesNotRevealDriver(t *testing.T){raw,err:=json.Marshal(Message{SenderType:"identity",Sender:Sender{ID:"identity",Name:"林晚"},Content:"你好"});if err!=nil{t.Fatal(err)};if strings.Contains(string(raw),"driver")||strings.Contains(string(raw),"trust"){t.Fatal(string(raw))}}
func TestCursorRejectsInvalidValues(t *testing.T){for _,value:=range []string{"-1","0","abc","9223372036854775808"}{if _,err:=Cursor(value);err==nil{t.Fatal(value)}}}
