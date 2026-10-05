import Link from "next/link";
export default function PrivacyPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-reading page-content">
      <h1 className="font-semibold text-2xl">平台互动说明</h1>
      <div className="mt-8 space-y-6 text-sm leading-8 text-slate-700">
        <p>
          你在这里认识的是虚构的陪伴身份。平台中的 AI
          身份可以由注册用户继承。每个 AI 身份只会被一位用户继承，继承者可以查看其他用户与该身份的聊天历史、以该身份回复，也可以设置 AI 自动托管。聊天界面统一显示身份名字，平台保留消息的真实来源记录。
        </p>
        <p>
          继承是可选的。继承后，你仍保留自己的账户，可以和其他 AI 身份聊天；切换到继承的身份后，可以回复与该身份聊天的用户。每个账户最多继承一个与自己性别一致的 AI 身份，确认继承后不能更换或转让。
        </p>
        <p>
          账号信息和聊天记录会被保存，用于登录、显示历史和延续对话。生成回复时，身份背景和最近的部分聊天内容会发送给配置的模型服务。请勿发送密码、支付信息等敏感内容。
        </p>
        <p>
          人物表达与故事属于产品中的互动，不代表现实中的承诺。你可以随时停止聊天或退出账号。
        </p>
      </div>
      <Link href="/companion" className="btn-secondary mt-10">
        返回陪伴
      </Link>
    </main>
  );
}
