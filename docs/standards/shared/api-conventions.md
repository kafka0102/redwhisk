# API 约定

本文档仅保留 Agent 生成和校验 HTTP API 时必须遵守的规则。

当前仓库尚未包含应用运行时代码或 HTTP API 描述文件。以下规则适用于后续新增 API、补充 OpenAPI 描述或审查 API 设计时，不表示当前仓库已经存在可用 API。

## 关键词

- 必须：强制要求
- 推荐：优先采用，除非有明确理由不这么做
- 可以：允许的例外方式

## 1. 命名规范

- URI path 必须使用 `kebab-case`
- query string、请求体、响应体字段必须使用 `camelCase`
- 资源集合推荐使用复数名词
- 错误码 `code` 必须使用 `SCREAMING_SNAKE_CASE`

示例：

```http
POST /admin/repositories/candidate-repositories/search?page=1&size=20
Content-Type: application/json

{
  "query": "openai",
  "sortBy": "starsCount"
}
```

## 2. HTTP 与 URI 规范

- API 应符合 HTTP 语义
- URI 应以资源为中心，优先使用名词，不使用动词
- 每个资源必须有唯一 URI，资源集合应有独立 URI

常见方法约定：

- `GET`：查询
- `POST`：创建，或执行无法自然表达为资源变更的动作
- `PUT`：整体更新
- `PATCH`：部分更新
- `DELETE`：删除

状态码约定：

- `2xx`：成功
- `4xx`：请求错误、认证失败、鉴权失败、资源不存在等客户端问题
- `5xx`：服务端错误

## 3. 请求与响应结构

### 3.1 成功响应

- 成功响应体必须包含 `data`
- 列表接口如有分页，响应体可包含 `pagination`

```json
{
  "data": [
    {
      "id": 1,
      "name": "张三"
    }
  ],
  "pagination": {
    "page": 1,
    "size": 20,
    "total": 100
  }
}
```

### 3.2 错误响应

- 错误响应体必须包含 `code`
- 推荐包含 `message`
- `details` 为可选字段；存在时，数组内每个对象必须包含 `@type`

```json
{
  "code": "INVALID_PARAM_REPOSITORY_URL",
  "message": "请求参数错误",
  "details": [
    {
      "@type": "ValidationError",
      "field": "repositoryUrl",
      "reason": "REQUIRED"
    }
  ]
}
```

### 3.3 分页请求

- 分页参数推荐放在 query string
- 参数名必须为 `page` 和 `size`

## 4. 允许的例外场景

以下场景可以不严格使用纯 RESTful 资源表达，但仍需保持清晰一致。

### 4.1 动作型接口

适用于取消、审批、发布、归档、登录等动作：

```http
POST /orders/123/cancel
POST /login
```

### 4.2 复杂查询

当查询条件复杂且不适合 query string 时，可以使用搜索接口：

```http
POST /users/search
Content-Type: application/json
```

### 4.3 异步任务

长时间运行任务推荐使用异步模式：

```http
POST /jobs/train
GET /jobs/{jobId}/status
GET /jobs/{jobId}/result
```

- 启动任务时推荐返回 `202 Accepted`

## 5. OpenAPI 要求

- 新增 HTTP API 时必须同步提供 OpenAPI 描述文件
- OpenAPI 版本必须大于 `3.0.0`
- 推荐使用当前可用的最新稳定版本
