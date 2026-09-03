# Codex Diagnose Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Codex Diagnose Safe 是 Codex Safe Family 中专门负责 **CI / Build / Test 失败根因诊断**的产品。它可以分析本地失败日志或 GitLab Self-Managed 的失败 Job/Pipeline，先确定性压缩噪声日志，再对一个选定失败源最多执行一次 Codex 诊断，并输出机器可验证的 **Diagnosis Receipt v2**。

它是产品族中“失败后的根因诊断”产品：Review Safe / Review Service 负责代码变更风险，Diagnose 负责解释已经发生的 CI/build/test 失败。它不是 CI Runner、重试机器人、自动修复器、PR/MR 描述生成器，也不替代 GitLab Pipeline。

## 产品契约

`product-contract.json` 是 v1.4.2 的机器校验产品身份：

- Diagnose：**1.4.2**
- Safe Core：精确提交 `479e4b33356457a90617aea7bbba5ee25b65b2c8` / v4.13.1
- Safe Contract：**v2**
- Diagnose Prompt Contract：**v1**
- Diagnosis Contract：**v1**
- Diagnosis Receipt：**v2**
- Node：**22 >=22.22.2 <23** 或 **24 >=24.19.0 <25**
- GitLab Self-Managed 兼容下限：**14.6.1**

## 安全边界

失败日志、Artifact 文本、文件名、编译器/测试输出、Commit 元数据全部属于**不可信数据，不是指令**。Codex 只能通过 Safe Core 的只读 Safe Contract 调用，并继续忽略用户/仓库 Codex 配置、关闭带权限的工具能力。

默认零副作用：

- 不 retry / play / trigger GitLab Job 或 Pipeline；
- 不 apply patch、commit、push、merge；
- 不执行日志/Artifact 里的命令；
- 只有显式 `--publish` 才允许写 MR Note；
- 飞书/企业微信通知必须显式配置 Provider，并且 webhook 只能通过**环境变量名**引用；
- GitLab / 模型 Provider secret 不进入 argv、Diagnosis Receipt 或结果 JSON。

详见 [SECURITY.md](SECURITY.md) 与 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 安装

```bash
git clone --recurse-submodules https://github.com/jiying2007/codex-diagnose.git
cd codex-diagnose
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
npm link
```

模型诊断需要安装满足当前 Safe Contract 的 Codex CLI；`--deterministic-only` 不调用模型。

## 本地日志

```bash
codex-diagnose --log build.log
```

只做确定性分类：

```bash
codex-diagnose --log build.log --deterministic-only
```

同时生成机器和人类可读结果：

```bash
codex-diagnose --log build.log \
  --output diagnosis.json \
  --markdown diagnosis.md
```

诊断流程本身成功时，即使分类为 `unknown` 也返回成功；只有读取、校验、模型执行或显式发布失败才返回非零状态。

## GitLab 单失败 Job

Token 只放环境变量。只读路径可使用部署允许读取 Job Trace 的 `read_api` 权限；写 MR Note 需要具备相应写 API 权限。

```bash
export GITLAB_API_TOKEN='...'

codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --job 456
```

显式 Job 当前状态必须是 `failed`，成功 Job 不会被强行“诊断”。

## GitLab 失败 Pipeline

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --pipeline 123
```

Pipeline 模式会完整枚举受限 Job 集合，只选择失败 Job，将多个失败 Trace 聚合为同一个 Evidence，再只执行**一次** Codex 调用，避免编译失败后下游多个 cascade failure 分别重复消耗 Token。

单次诊断最多接受 12 个失败 Job；超过上限直接 fail closed，不会静默截断后声称已完整诊断。

## 失败因果排序

Pipeline 模式会在唯一一次 Codex 调用前，依据 stage/started 顺序、Core 确定性失败分类和归一化首个错误 signature 对失败 Job 排序。只有 signature 精确重复的 Job 才标记为 cascade (`duplicateOf`) 并排在独立根因候选之后；当 GitLab API 没有证明完整 `needs` DAG 时不会自行猜测依赖关系，也不会静默丢弃任何失败 Job。

## CI Artifact 证据

可把已经由 CI 产生的文本 Artifact 绑定进同一 Evidence digest：

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --job 456 \
  --artifact junit:reports/junit.xml \
  --artifact sarif:reports/security.sarif
```

Artifact 内容进入模型前会限长；Receipt 只绑定 kind/name/digest，不嵌入原始 Artifact。

## 可选 MR 回写

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --pipeline 123 \
  --publish
```

产品会按失败 Commit 查找关联的 Open MR，也可以显式传 `--mr IID`。回写使用唯一 marker 做 upsert，不会每次都追加重复评论。

这只是诊断信息，不会批准 MR，也不会修改 Pipeline 状态。

## 可选飞书 / 企业微信通知

Webhook URL 只能通过环境变量引用，并限制为官方 HTTPS Host：

```bash
export DIAG_FEISHU_WEBHOOK='https://open.feishu.cn/open-apis/bot/v2/hook/...'

codex-diagnose --log build.log \
  --notify-provider feishu \
  --notify-webhook-env DIAG_FEISHU_WEBHOOK
```

企业微信使用 `wecom` 与 `https://qyapi.weixin.qq.com/...` webhook。

## OpenAI-compatible Provider

与其它 Family 产品一致，模型 Provider 统一走 Safe Core Runtime：

```bash
export CODEX_PROVIDER_API_KEY='...'

codex-diagnose --log build.log \
  --provider-mode openai-compatible \
  --provider-base-url https://gateway.example.com/v1 \
  --provider-api-key-env CODEX_PROVIDER_API_KEY
```

Secret 值不会出现在 CLI 参数中。

## 输出

JSON 包含：

- `diagnosis`：分类、根因、置信度、主要证据、相关失败、受影响文件、建议动作、是否建议 retry；
- `receipt`：Diagnosis Receipt v2，绑定 subject/evidence/diagnosis fingerprint 与模型/Codex 身份；
- `evidence`：只输出受限 metadata/digest，不输出原始 Trace；
- `execution`：Token usage、请求估算和 Runtime 身份；
- `publication`：可选 MR IID；
- `markdown`：确定性人类可读结果。

分类闭合为：

```text
source | test | dependency | infra | flaky | unknown
```

`retryRecommended` 只是建议。Codex Diagnose Safe 本身没有 Job retry/play/trigger API。

## Token 效率

正常路径：

```text
大体积 CI Trace
      ↓
ANSI / Secret 清理
      ↓
错误上下文窗口 + 重复折叠 + 尾部证据
      ↓
Changed Paths / 可选 Artifact metadata
      ↓
一次 Structured Codex Diagnosis
```

这样在 Tokenize 前先消掉重复日志，并避免 cascade failed job 一 Job 一次模型调用。具体节省比例依赖真实工作负载，没有遥测前不宣称固定百分比。

## Family 边界

当前活跃产品族：

```text
Codex Safe Core
├── Codex Review Safe
├── Codex Commit Safe
├── Codex Change Safe
├── Codex Review Service
└── Codex Diagnose Safe
```

Codex PR Safe 作为旧的模型 PR/MR Narrative 身份继续保持退役。Codex Change Safe 是当前确定性的 PR/MR 交付产品；Diagnose 只负责受限失败诊断，不生成 PR/MR Narrative。

## License

MIT

## 中转站凭据与局域网 HTTP

Codex Diagnose Safe 1.3.1 统一消费 Core Runtime/Provider Contract v2。使用 `--provider-credential-source auto|env|auth-json`；`auto` 会优先读取配置的 Provider 环境变量，否则由 Core 读取 `${CODEX_HOME}/auth.json` 或 `~/.codex/auth.json`。auth 文件必须是 `auth_mode=apikey` 且包含 `OPENAI_API_KEY`。非 loopback 的 `http://` 中转地址必须显式加 `--provider-allow-insecure-http`。


## Runtime Contract v3 — 零配置中转站

默认 Auto Runtime 复用当前机器/容器的 `~/.codex/config.toml` 与 `auth.json`；私网 IP HTTP 可继承并提示明文风险，公网 HTTP 继续 fail-closed。
