# 角色库维护

角色库使用同一个陪伴 Agent：平台配置定义角色身份，数据库保存人设版本，用户与角色的关系和记忆继续属于各自会话。发现页只公开姓名、年龄、城市、职业和简介等资料，完整人设不会随列表下发。

本次测试、本地导入结果和真实模型尚存问题见[验收记录](identity-catalog-verification.md)。

## 文件与数据格式

- `apps/server/config/occupations.json`：100 份职业的初始创作素材，包含最低年龄、工作任务、具体经历、职业目标；需要地域约束的职业还包含 `allowedCities`。
- `apps/server/config/identities.json`：可编辑的完整成品，包含 100 个职业、每职业 10 位女性，共 1,000 人。**日常维护以这个文件为准。** 修改职业模板不会自动修改已经生成的人设。
- `scripts/generate-identities.mjs`：确定性初始生成器，仅由维护者手动运行；启动、部署、聊天均不会自动调用它。

导入文件格式：

```json
{
  "schemaVersion": 1,
  "complete": false,
  "occupations": [
    { "code": "editor", "name": "图书编辑", "minAge": 22 }
  ],
  "identities": [
    {
      "id": "identity_linwan",
      "name": "林晚",
      "age": 27,
      "gender": "FEMALE",
      "city": "上海",
      "background": "在上海生活，愿意慢慢认识一个人。从事图书编辑工作，喜欢沿河散步。",
      "avatarUrl": "",
      "occupationCode": "editor",
      "persona": {
        "personality": "慢热而有主见，熟悉后愿意分享日常。",
        "speakingStyle": "表达自然简短，认真回应对方提到的具体细节。",
        "interests": ["沿河散步", "阅读非虚构作品"],
        "careerStage": "逐渐形成自己的编辑方法，正在积累独立策划经验。",
        "backstory": "参与过一本地方生活随笔集的编辑，喜欢从书稿里发现普通人的日常。",
        "goals": "独立策划一本记录普通人生活的非虚构作品。"
      }
    }
  ]
}
```

上例展示单角色增量更新格式，不是当前林晚人设的完整备份。`complete: true` 要求恰好 100 个职业、每职业 10 人；单次局部维护可以使用 `complete: false`，并列出本次角色引用的职业定义。角色 ID 是关联聊天与继承关系的稳定标识，不应因修改姓名、年龄或职业而换 ID。

生成器保留了以下三位原角色，并计入 1,000 人：

| ID | 姓名 | 年龄 | 城市 | 职业 | 保留的简介基调 |
| --- | --- | --- | --- | --- | --- |
| `identity_linwan` | 林晚 | 27 | 上海 | 图书编辑 | 愿意慢慢认识一个人 |
| `identity_suhe` | 苏禾 | 25 | 杭州 | 花艺师 | 珍惜日常里的小事 |
| `identity_chennian` | 陈念 | 28 | 成都 | 图书管理员 | 喜欢认真听人说话 |

本次全部角色为 18–50 岁成年人，同职业内年龄互异。门槛较高的职业使用较高的起始年龄，例如大学讲师 28 岁、临床医生 26 岁。初始人设不填写未经设定的具体雇主、资质编号、家庭关系或恋爱史；以后需要这些事实时直接补入对应人设，保证可审阅、可追踪。

## 修改与导入

在项目根目录执行：

```sh
# 不访问数据库的完整成品检查与维护工具测试
node scripts/generate-identities.mjs --check
pnpm identities:test
pnpm identities:validate

# 首次使用新表结构时运行增量迁移
pnpm db:migrate

# 读取配置的本地数据库，预览新增、更新与影响会话数
pnpm identities:preview

# 对同一数据库事务导入
pnpm identities:import

# 再次预览应为 created=0、updated=0、unchanged=1000
pnpm identities:preview
```

数据库命令使用 `DATABASE_URL`，按现有后端约定加载 `apps/server/.env` 或根目录 `.env`，已存在的环境变量优先。迁移和导入是独立命令；`-dry-run` 不会自动迁移，也不会修改角色、版本或任务。首次针对只有原三人的数据库导入时，通常会得到 `created=997`、`updated=3`；数据库已有其他数据时，以实际预览为准。

导入结果包含 `created`、`updated`、`unchanged`、`affectedConversations` 和 `dryRun`。整份文件校验通过后才连接数据库执行写入；一个事务中任一更新失败即整体回滚。未出现在导入文件中的角色保留，同 ID 相同资料重复导入不改人设版本，也不会取消聊天任务。人设版本由数据库管理，不放入导入 JSON。

导入局部文件时，从 `apps/server` 目录执行：

```sh
go run ./cmd/identities -file /absolute/path/to/partial-catalog.json -validate-only
go run ./cmd/identities -file /absolute/path/to/partial-catalog.json -dry-run
go run ./cmd/identities -file /absolute/path/to/partial-catalog.json
```

Go 校验器拒绝未知字段、重复 ID、未知职业引用、同职业重复年龄、非法文本和超限文件。文件最多 16 MiB；姓名最多 40 字、城市 80 字、简介 500 字；性格和表达方式各 500 字、职业阶段 200 字、背景经历 1,500 字、目标 500 字；兴趣为 1–12 个互异项，每项最多 80 字。文本不得带首尾空格。完整成品的 JavaScript 检查额外确保姓名不重、全部为女性、保留原三位角色及简介基调。

## 人设更新的聊天影响

角色资料实际改变时，导入会递增人设版本，并使关联会话正在生成、等待投递的旧任务失效；旧租约不能提交回复或摘要。系统保留已发送消息、确认的用户记忆、匹配和继承关系，清空派生摘要后由现有上下文流程重新整理。尚未回答的轮次依照当前托管设置重新排队；部分气泡已经发送的批次会取消剩余气泡，不重复发送整轮。

这意味着修改人物经历会影响该角色与所有用户的后续对话。用户个人偏好、双方约定、亲密程度和聊天中发生的事情应当保存到对应会话，不能作为共享人设导入。普通用户与继承者没有这个平台级编辑入口。

## 重新生成初始资料

通常直接编辑成品 JSON。需要调整生成策略或重新创作整库时，先生成到一个新文件审阅：

```sh
node scripts/generate-identities.mjs --output /tmp/identities-review.json
node scripts/generate-identities.mjs --check --output /tmp/identities-review.json
```

默认命令 `pnpm identities:generate` 会拒绝覆盖已存在的成品。确认要放弃成品中的人工修改并重新生成时，才使用：

```sh
node scripts/generate-identities.mjs --force
```

生成器按职业编码排序，因此只调整模板排列顺序不会改变结果；修改职业编码、最低年龄、素材池或生成算法可能影响许多角色。生成后的 ID 需继续保持稳定，尤其不要通过重新编号来删除已经存在的聊天身份。`--check` 只校验，不把人工编辑的成品恢复成生成结果。

初始数据分别组合职业经历、性格、表达方式、兴趣、生活记忆和目标。每个职业内部的 10 人在性格、表达方式、个人经历和目标上均有差异；相同年龄不绑定相同性格。地铁司机使用明确的城市集合，避免职业与城市明显不符。

## 内容与质量核对

自动测试覆盖数量、年龄与专业起点、唯一姓名和 ID、字段长度、职业内差异、原有角色保留、确定性、覆盖保护及 `--check` 不改文件。初始交付逐职业检查了至少一位年轻角色的职业阶段与经历；检查中修正了地铁岗位落在不匹配城市的问题，并消除了等长随机素材池之间的关联。

维护时重点核对：职业与年龄是否相符，职业与所在城市是否匹配，新增经历是否与已有资料矛盾，以及描述是否真的体现这个角色的生活。建议每次涉及整个职业的变更都读一遍其中最年轻、最年长和一位中间年龄的完整资料。

内容校验验证的是设定和导入一致性，不代表模型在多轮聊天中一定不偏离人设；多轮模型评测应独立记录使用的配置版本、实际回复和发现的问题。
