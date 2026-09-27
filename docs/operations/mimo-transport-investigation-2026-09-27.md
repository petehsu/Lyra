# MiMo 连接失败调查（2026-09-27）

## 结论与验收动作

当前未复现持续连接失败，不能把历史故障定性为 Lyra 网络库故障，也不能排除 VPN / DNS / 上游瞬时异常。确认 Lyra 存在错误详情丢失和无针对性的非流式恢复尝试。此次只调查，未修改产品代码、VPN、模型或凭证设置。

用户可见的复测动作：保持现有 VPN 状态，在 Lyra 使用 `mimo_token_plan_cn / mimo-v2.6-flash` 发送一句简单消息，确认能否开始回复。下面的独立探针只验证连接，不代表真实会话已经恢复或问题已经修复。

## 历史时间线

来源：本地会话 `session-3d8b224e-87b5-4397-8b34-2ea8c6b8885d` 的 `runtime_turns_json.providerMetadata.providerAttempts`。时间为 UTC；桌面当地时间减 4 小时。

| 时间 / 阶段 | 状态 | 证据 |
| --- | --- | --- |
| 12:55–13:07 的前三轮 | 正常完成 | 分别有 4、10、25 次模型请求，记录未见 transport_error |
| 13:07:46–13:13:57 | 中断 | 会话记录为 soft_interrupt，不能算连接故障 |
| 13:13:57–13:15:14 | 异常 | 本轮共 5 次请求，其中 4 次 connect 失败；失败请求约 15.08、10.05、10.06、10.06 秒 |
| 13:15:28–13:16:18 | 异常 | 3 次流式、1 次非流式，全部 connect 失败；各约 10.05 秒，含退避等共 49.964 秒 |
| 13:20:10、13:20:16 | 连通性正常 | 用户提供的两个 curl GET 都收到 HTTP/2 405；时间晚于故障，不能证明故障时链路正常 |

`connect` 表示连接阶段失败；记录没有 HTTP 状态码，也没有底层 source 错误，无法进一步区分 DNS、TCP、TLS。

## 当前对照实验

全部请求发送到同一官方域名 `/v1/chat/completions`，无 API Key，使用固定的 `hi` 测试正文。没有读取或发送真实对话正文、密钥。401 是此测试的预期结果，证明已收到 HTTP 响应，不表示用户保存的密钥有问题。

| 实验 | 状态 | 结果 |
| --- | --- | --- |
| curl POST，默认协议协商 | 正常 | HTTP/2 401，4.417 秒 |
| curl POST，HTTP/1.1 | 正常 | HTTP/1.1 401，2.732 秒 |
| Rust POST，默认解析 | 正常 | HTTP/1.1 401，2.510 秒 |
| Rust POST，固定第一个当前解析 IP | 正常 | HTTP/1.1 401，2.066 秒 |
| Rust POST，固定第二个当前解析 IP | 正常 | HTTP/1.1 401，1.840 秒 |

Rust 探针链接当前 Lyra 构建实际使用的 `reqwest 0.12.28` 和 Tokio 构建产物；使用与 Linux provider 相同的 ClientBuilder 设置（30 秒 connect timeout，探针额外设置 35 秒总上限）。测试运行在独立进程，不等同于在正在运行的 Lyra 会话中发送模型请求。依赖启用 Rustls/ring，未启用 reqwest HTTP/2；curl HTTP/1.1 对照亦成功。

探针源码和二进制保留于 `/home/xu-yuanhao/.cache/lyra-mimo-transport-20260927/`。

## 对网络推断的纠正

- Lyra 三个 `lyrad` 进程与调查终端的网络命名空间相同；cgroup 显示桌面用户应用 scope，没有发现所声称的 Docker 网络差异。
- 本机 `172.18.0.1/30` 属于 `singbox_tun`。`ip route get` 确认 MiMo IP 经 table 2022、该 TUN 网卡路由。这不是仅凭私网地址猜测。
- Lyra 和终端均未发现 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY 环境配置差异。
- `curl --noproxy '*'` 只关闭 curl 的应用层代理选择，不改变系统路由，所以不能据此声称绕过 TUN。参见 [curl 官方说明](https://curl.se/docs/manpage.html#--noproxy)。
- 读取到的 VPN 路由配置没有按 curl / lyrad 分别选路的进程规则；但现有历史日志不足以还原故障时的实际出站错误。

## 已确认的软件问题

1. `provider/model_loop/progress_guard_synthesis.rs` 的 `reqwest_transport_error` 仅保存 `error.to_string()`。Reqwest 把底层错误放在 `Error::source()` 链，当前转换丢掉了它，所以页面上只剩 `error sending request for url`。后续修复应保留经过脱敏的底层分类与原因，不能把含密钥的 URL 或完整请求写入日志。
2. `provider/protocol_io.rs` 的恢复路径把所有未提交内容的 transport 错误都交给流式重试和一次非流式回退；即便是 connect 错误也如此。切换流式标志不会改变 DNS / TCP / TLS 建连过程，因此这次回退只是多一次普通连接尝试，不能称为针对连接故障的修复。最后一轮多花了约 10 秒请求时间及对应退避。

参考项目的实际边界：`參考/opencode/packages/opencode/src/provider/provider.ts` 缓存 SDK，委托 fetch 执行网络请求并设置响应头/流块超时；该路径不通过改 VPN、跳过 TLS 校验或切换 API 地域来证明连接已修复。Lyra 也不应凭一次 curl 成功就进行这些改动。

## 未解决项

- 最初连接失败的具体底层原因：未知。10 秒失败节奏是线索，不能直接当作 DNS 或 TUN 故障证据。
- 用户在 Lyra 中的同模型消息复测：尚未执行，不能以探针通过代替验收。
- 本报告列出的错误诊断和恢复策略问题：已定位，尚未修改。
