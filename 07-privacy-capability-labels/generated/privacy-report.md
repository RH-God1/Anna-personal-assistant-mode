# 隐私能力报告

| 工具 | 风险 | 读取 PII | 外部写入 | 人工确认 | 保留策略 |
| --- | --- | --- | --- | --- | --- |
| 隐私旅行代理 | guarded | 否 | 否 | 是 | memory_only |
| 双语 Focus Flow | low | 否 | 否 | 否 | local_until_deleted |
| Executa-to-MCP Bridge | guarded | 否 | 否 | 是 | local_until_deleted |
| Anna 个人助理模式 | high | 是 | 是 | 是 | session |
| Anna 多模型项目工作区 | guarded | 否 | 否 | 是 | local_until_deleted |

## 隐私旅行代理

- 数据类别：itinerary
- 外部域名：无
- 人工确认点：traveler_info, order_confirmation, payment
- 用户提示：隐私旅行代理：不读取个人信息；不向外部服务写入数据；在 traveler_info, order_confirmation, payment 前暂停。

## 双语 Focus Flow

- 数据类别：focus_topic, focus_history
- 外部域名：无
- 人工确认点：无
- 用户提示：双语 Focus Flow：不读取个人信息；不向外部服务写入数据。

## Executa-to-MCP Bridge

- 数据类别：tool_metadata, audit_metadata
- 外部域名：无
- 人工确认点：host_tool_confirmation
- 用户提示：Executa-to-MCP Bridge：不读取个人信息；不向外部服务写入数据；在 host_tool_confirmation 前暂停。

## Anna 个人助理模式

- 数据类别：approximate_location, health_metrics, conversation_context, attachment_metadata
- 外部域名：api.open-meteo.com, air-quality-api.open-meteo.com
- 人工确认点：location_share, health_data_connection, anna_chat_sync
- 用户提示：Anna 个人助理模式：会读取个人信息；会连接 api.open-meteo.com, air-quality-api.open-meteo.com；在 location_share, health_data_connection, anna_chat_sync 前暂停。

## Anna 多模型项目工作区

- 数据类别：project_metadata, conversation_context, artifact_metadata, model_provenance
- 外部域名：无
- 人工确认点：promote_shared_memory, share_dependency_artifact
- 用户提示：Anna 多模型项目工作区：不读取个人信息；不向外部服务写入数据；在 promote_shared_memory, share_dependency_artifact 前暂停。
