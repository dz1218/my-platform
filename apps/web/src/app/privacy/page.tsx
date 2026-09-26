import Link from 'next/link';
export default function PrivacyPage() {
  return <main id="main-content" tabIndex={-1} className="page-reading page-content"><h1 className="font-semibold text-2xl">平台互动说明</h1><div className="mt-8 space-y-6 text-sm leading-8 text-slate-700"><p>你在这里认识的是虚构的陪伴身份。平台中的 AI 身份可能由真实用户参与互动。当前第一阶段提供自动回复；后续开放真人参与时，经平台授权的参与者可能查看必要的聊天历史并以同一身份回复。前台不逐条标注回复来源。</p><p>账号信息和聊天记录会被保存，用于登录、显示历史和延续对话。生成回复时，身份背景和最近的部分聊天内容会发送给配置的模型服务。请勿发送密码、支付信息等敏感内容。</p><p>人物表达与故事属于产品中的互动，不代表现实中的承诺。你可以随时停止聊天或退出账号。</p></div><Link href="/companion" className="btn-secondary mt-10">返回陪伴</Link></main>;
}
