# 付费

概述

[欢迎使用](</docs/zh-CN/quick-start/summary/welcome>)

[首次调用 API](</docs/zh-CN/quick-start/summary/first-api-call>)

[模型列表](</docs/zh-CN/quick-start/summary/model>)

使用指南

工具调用

[联网搜索](</docs/zh-CN/quick-start/usage-guide/tool-calling/web-search>)

多模态理解

[图片理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding>)

[音频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/audio-understanding>)

[视频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/video-understanding>)

[语音识别（MiMo-V2.5-ASR）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/Speech-Recognition>)

[语音合成（MiMo-V2.5-TTS 系列）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/speech-synthesis-v2.5>)

[语音合成（MiMo-V2-TTS）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/speech-synthesis>)

其他

[深度思考](</docs/zh-CN/quick-start/usage-guide/other/deep-thinking>)

精彩活动

[邀请有礼](</docs/zh-CN/quick-start/promotions/refer>)

常见问题

[账号与认证](</docs/zh-CN/quick-start/faq/account>)

[付费](</docs/zh-CN/quick-start/faq/payment>)

[API 接入](</docs/zh-CN/quick-start/faq/api-integration>)

[Token Plan](</docs/zh-CN/quick-start/faq/token-plan>)

[活动](</docs/zh-CN/quick-start/faq/promotions>)

[其他](</docs/zh-CN/quick-start/faq/others>)

条款与协议

[服务协议](</docs/quick-start/terms/user-agreement>)

[隐私政策](</docs/quick-start/terms/privacy-policy>)

邀请好友得体验金

# 付费

### 开放平台如何充值？

  * **按量计费 API：** 前往 [账户余额](<https://platform.xiaomimimo.com/#/console/balance>) 页面进行充值，平台对国内用户提供三种充值方式：小米支付、支付宝、微信支付；对海外用户提供 **Apple Pay、Google Pay 、信用卡/借记卡等常用充值方式。** 充值一般实时到账，可在 [账户余额](<https://platform.xiaomimimo.com/#/console/balance>) 中查看余额，在 [充值明细](<https://platform.xiaomimimo.com/#/console/recharge>) 页面查看累计充值金额及充值记录。

  * **Token Plan：** 套餐暂不支持账户余额或赠金抵扣，需要前往 [订阅 Token Plan](<https://platform.xiaomimimo.com/token-plan>) 单独购买。

  

### Token Plan 购买套餐算入累计充值吗？

不算，订阅套餐的订单不计入累计充值。

  

### 支持哪些支付方式？

中国国内支持微信、支付宝、小米支付，海外通过 waffo 收银台支付（以美元 $ 结算）。

  

### 支付有时间限制吗？

有效支付时长以页面显示为准，超时后订单自动关闭，需重新下单。

  

### 如何设置余额预警？

在 [账户余额](<https://platform.xiaomimimo.com/#/console/balance>) 页面，可以开启余额预警设置，开启后，当账号余额低于预警阈值时，我们将向您的注册手机号/邮箱发送通知，请注意查收。

  

### 是否支持申请退款？

  * **按量计费 API：** 账户余额支持全额退款，如您有退款需求，可通过 [充值明细](<https://platform.xiaomimimo.com/#/console/recharge>) 右上角的申请退款按钮打开联系弹窗，选择“退款”选项并说明理由发起退款申请，账户余额将在审核通过后原路退回（已消费金额、已开票金额及平台赠送金额无法退款）。退款申请被受理后，您将无法继续调用模型服务，且无法继续充值。计费可能存在延迟，退款金额以实际到账金额为准。退款一般会在 3-5 个工作日内原路退回。

  * **Token Plan：** 套餐一经支付，无法退款。

  

### 如何开具发票？

  * **中国用户：**

访问 [开具发票](<https://platform.xiaomimimo.com/#/console/invoice>) 页面，选择充值成功的订单，开具电子发票。可开具个人抬头和企业抬头的发票。填写邮箱或手机号码，发票开具完成后将以邮件/短信形式发送。

注意：

  * 可开票金额为实际付款金额，平台优惠券或减免金额、平台赠送金额无法开票。已退款金额无法开票。

  * 按照规定，个人抬头发票只能开具数电普通发票，企业抬头发票可开具数电普通发票或数电专用发票。

  * 一般会在收到申请后的 48 小时内为您开具发票，如遇特殊情况可能会有延迟。

  * 发票支持冲红，若发票已抵扣或入账，需要您登录电子税务局，在 72 小时内确认信息（红字确认单），才能冲红成功。冲红后原订单可重新开具发票。

  * 开票主体是：北京小米移动软件有限公司。

  * **海外用户：**

每一笔充值单都会自动开具发票，当您完成充值时，可在订单页面查看发票。也可进入 [充值明细](<https://platform.xiaomimimo.com/#/console/recharge>) 页面，下载历史发票。

  

### 余额不足还能调用 API 吗？

计费系统上线前，余额为 0 可正常调用模型推理服务。

计费系统上线后，由于存在一定时间的延迟，余额可能 ≤ 0。余额为负后，将无法继续调用模型推理服务，下笔充值单，会优先扣除已欠费部分。

  

### API Key 删除后，还会继续计费吗？

如果 API Key 被删除，则该 API Key 将无法继续调用接口，也不会产生扣费。该 API Key 的历史消费记录仍可在 [账单明细](<https://platform.xiaomimimo.com/#/console/usage>) 中查询。

更新时间 2026 年 06 月 12 日

[账号与认证](</docs/zh-CN/quick-start/faq/account>)[API 接入](</docs/zh-CN/quick-start/faq/api-integration>)