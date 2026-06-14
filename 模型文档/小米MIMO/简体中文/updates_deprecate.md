# 模型下线

[功能更新](</docs/zh-CN/updates/feature>)

[模型发布](</docs/zh-CN/updates/model>)

[模型下线](</docs/zh-CN/updates/deprecate>)

邀请好友得体验金

# 模型下线

随着 MiMo 模型的持续迭代，新版本在效果与性能上已全面超越旧版本。我们将逐步下线历史模型，具体计划会通过短信、邮件及网站公告等方式提前通知，请留意相关消息并及时完成切换。

**时间定义**

  * 系统替换时间：下线模型自动切换为新版本模型的时间。超过这个时间，使用旧版本模型名称的请求将会自动替换成对应的新版模型，并按照新版模型计价。[查看定价](<https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go>)

  * 下线时间：旧版本模型名称失效的时间。超过这个时间，使用旧版本模型名称的请求将会收到报错，务必在此之前完成模型替换。

**操作建议**

  * 访问 [账单明细](<https://platform.xiaomimimo.com/console/usage>) ，检查是否存在待下线模型；

  * 参照下方表格中的系统替换模型，完成您的代码自查跟替换。建议正式切换前，充分测试验证。

  

### 2026.6.30 下线模型

下线模型 | 下线时间 | 系统替换时间 | 系统替换模型 | 替换影响  
---|---|---|---|---  
mimo-v2-pro | 北京时间 2026.6.30 00:00 | 北京时间 2026.6.1 00:00 | mimo-v2.5-pro | API 参数完全适配  
mimo-v2-omni | 北京时间 2026.6.30 00:00 | 北京时间 2026.6.1 00:00 | mimo-v2.5 | API 参数完全适配  
mimo-v2-flash | 北京时间 2026.6.30 00:00 | 北京时间 2026.6.18 00:00 | mimo-v2.5 | 参数值默认值有变，详见下文  
mimo-v2-tts | 北京时间 2026.6.30 00:00 | 北京时间 2026.6.18 00:00 | mimo-v2.5-tts | 音色重新映射，`mimo_default` 在中国集群映射为`冰糖`，在其他集群映射为 `mia`。  
  
**注意：**

自北京时间 2026年6月18日 00:00 起，mimo-v2-flash 的请求将自动路由至 mimo-v2.5。相关参数处理规则如下：

  * mimo-v2.5 在思考模式下不支持`temperature` 和 `top_p` 自定义 ，模型实际传参为 `temperature:1.0` 和 `top_p:0.95`

  * 若在使用 mimo-v2-flash 时自定义了参数，则自动路由至 mimo-v2.5 时会继承 mimo-v2-flash 的传参

  * 若请求中未指定 `thinking`、`temperature` 或 `max_completion_tokens`，系统将自动使用 `mimo-v2.5` 的默认值，如下表：

差异项 | mimo-v2-flash | mimo-v2.5  
---|---|---  
`thinking` 默认值 | `disabled` | `enabled`  
`temperature` 默认值 | `0.3` | `1.0`  
`max_completion_tokens` 默认值 | `65536` | `32768`  
  
更新时间 2026 年 06 月 12 日

[模型发布](</docs/zh-CN/updates/model>)